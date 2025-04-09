const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Создаем пул соединений с базой данных
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'lohozavrik_app',
  password: process.env.DB_PASSWORD || 'Srvpenis16',
  database: process.env.DB_NAME || 'lohozavrik_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Проверка соединения с базой данных
pool.getConnection()
  .then(conn => {
    console.log('Connected to MySQL database!');
    conn.release();
  })
  .catch(err => {
    console.error('Database connection error:', err);
  });

// Middleware для проверки токенов авторизации
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Маршрут для регистрации
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }
    
    // Проверяем, существует ли пользователь
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    
    if (existingUsers.length > 0) {
      return res.status(409).json({ success: false, message: 'Username already exists' });
    }
    
    // Хешируем пароль
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Создаем транзакцию для добавления пользователя и его статистики
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Добавляем пользователя
      const [result] = await connection.query(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        [username, passwordHash]
      );
      
      const userId = result.insertId;
      
      // Добавляем запись в статистику
      await connection.query(
        'INSERT INTO user_stats (user_id) VALUES (?)',
        [userId]
      );
      
      // Добавляем стартового персонажа
      await connection.query(
        'INSERT INTO user_characters (user_id, character_id) VALUES (?, ?)',
        [userId, 'default']
      );
      
      // Устанавливаем активного персонажа
      await connection.query(
        'INSERT INTO active_characters (user_id, character_id) VALUES (?, ?)',
        [userId, 'default']
      );
      
      await connection.commit();
      
      // Создаем JWT токен
      const token = jwt.sign({ id: userId, username }, process.env.JWT_SECRET, { expiresIn: '7d' });
      
      // Получаем данные пользователя для ответа
      const [userData] = await pool.query(`
        SELECT u.id, u.username, us.high_score, us.coins, us.games_played, us.total_time_minutes,
               ac.character_id as active_character
        FROM users u
        JOIN user_stats us ON u.id = us.user_id
        JOIN active_characters ac ON u.id = ac.user_id
        WHERE u.id = ?
      `, [userId]);
      
      // Получаем список персонажей пользователя
      const [characters] = await pool.query(`
        SELECT character_id FROM user_characters WHERE user_id = ?
      `, [userId]);
      
      const userCharacters = characters.map(c => c.character_id);
      
      res.status(201).json({
        success: true,
        message: 'Registration successful',
        token,
        user: {
          ...userData[0],
          characters: userCharacters
        }
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});

// Маршрут для авторизации
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Получаем пользователя из базы
    const [users] = await pool.query(`
      SELECT u.id, u.username, u.password_hash, us.high_score, us.coins, 
             us.games_played, us.total_time_minutes, ac.character_id as active_character
      FROM users u
      JOIN user_stats us ON u.id = us.user_id
      JOIN active_characters ac ON u.id = ac.user_id
      WHERE u.username = ?
    `, [username]);
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const user = users[0];
    
    // Проверяем пароль
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }
    
    // Обновляем время последнего входа
    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    
    // Получаем список персонажей пользователя
    const [characters] = await pool.query(`
      SELECT character_id FROM user_characters WHERE user_id = ?
    `, [user.id]);
    
    const userCharacters = characters.map(c => c.character_id);
    
    // Создаем JWT токен
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    // Отправляем токен и данные пользователя
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        highScore: user.high_score,
        coins: user.coins,
        gamesPlayed: user.games_played,
        totalTimeMinutes: user.total_time_minutes,
        activeCharacter: user.active_character,
        characters: userCharacters
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// Маршрут для проверки токена
app.get('/verify-token', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Получаем данные пользователя
    const [userData] = await pool.query(`
      SELECT u.id, u.username, us.high_score, us.coins, us.games_played, 
             us.total_time_minutes, ac.character_id as active_character
      FROM users u
      JOIN user_stats us ON u.id = us.user_id
      JOIN active_characters ac ON u.id = ac.user_id
      WHERE u.id = ?
    `, [userId]);
    
    if (userData.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Получаем список персонажей пользователя
    const [characters] = await pool.query(`
      SELECT character_id FROM user_characters WHERE user_id = ?
    `, [userId]);
    
    const userCharacters = characters.map(c => c.character_id);
    
    res.json({
      success: true,
      user: {
        id: userData[0].id,
        username: userData[0].username,
        highScore: userData[0].high_score,
        coins: userData[0].coins,
        gamesPlayed: userData[0].games_played,
        totalTimeMinutes: userData[0].total_time_minutes,
        activeCharacter: userData[0].active_character,
        characters: userCharacters
      }
    });
  } catch (err) {
    console.error('Token verification error:', err);
    res.status(500).json({ success: false, message: 'Server error during token verification' });
  }
});

// Маршрут для обновления статистики после игры
app.post('/update-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { score, coinsCollected, duration } = req.body;
    
    // Получаем текущую статистику пользователя
    const [userData] = await pool.query('SELECT high_score, coins FROM user_stats WHERE user_id = ?', [userId]);
    
    if (userData.length === 0) {
      return res.status(404).json({ success: false, message: 'User stats not found' });
    }
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Записываем игровую сессию
      await connection.query(`
        INSERT INTO game_sessions (user_id, score, coins_collected, duration_seconds)
        VALUES (?, ?, ?, ?)
      `, [userId, score, coinsCollected, duration || 0]);
      
      // Обновляем статистику пользователя
      const newHighScore = Math.max(userData[0].high_score, score);
      const newCoins = userData[0].coins + coinsCollected;
      
      await connection.query(`
        UPDATE user_stats
        SET high_score = ?, coins = coins + ?, games_played = games_played + 1
        WHERE user_id = ?
      `, [newHighScore, coinsCollected, userId]);
      
      await connection.commit();
      
      // Получаем обновленные данные пользователя
      const [updatedUserData] = await pool.query(`
        SELECT u.id, u.username, us.high_score, us.coins, us.games_played, 
               us.total_time_minutes, ac.character_id as active_character
        FROM users u
        JOIN user_stats us ON u.id = us.user_id
        JOIN active_characters ac ON u.id = ac.user_id
        WHERE u.id = ?
      `, [userId]);
      
      // Получаем список персонажей пользователя
      const [characters] = await pool.query(`
        SELECT character_id FROM user_characters WHERE user_id = ?
      `, [userId]);
      
      const userCharacters = characters.map(c => c.character_id);
      
      res.json({
        success: true,
        message: 'Stats updated successfully',
        user: {
          id: updatedUserData[0].id,
          username: updatedUserData[0].username,
          highScore: updatedUserData[0].high_score,
          coins: updatedUserData[0].coins,
          gamesPlayed: updatedUserData[0].games_played,
          totalTimeMinutes: updatedUserData[0].total_time_minutes,
          activeCharacter: updatedUserData[0].active_character,
          characters: userCharacters
        }
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Stats update error:', err);
    res.status(500).json({ success: false, message: 'Server error during stats update' });
  }
});

// Маршрут для покупки персонажа
app.post('/buy-character', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { characterId } = req.body;
    
    // Проверяем существование персонажа
    const [characterData] = await pool.query('SELECT id, price FROM characters WHERE id = ?', [characterId]);
    
    if (characterData.length === 0) {
      return res.status(404).json({ success: false, message: 'Character not found' });
    }
    
    // Проверяем, есть ли у пользователя уже этот персонаж
    const [ownedCharacter] = await pool.query(
      'SELECT character_id FROM user_characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );
    
    if (ownedCharacter.length > 0) {
      return res.status(409).json({ success: false, message: 'You already own this character' });
    }
    
    // Проверяем, достаточно ли монет
    const [userData] = await pool.query('SELECT coins FROM user_stats WHERE user_id = ?', [userId]);
    
    if (userData[0].coins < characterData[0].price) {
      return res.status(400).json({ success: false, message: 'Not enough coins' });
    }
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Вычитаем монеты
      await connection.query(
        'UPDATE user_stats SET coins = coins - ? WHERE user_id = ?',
        [characterData[0].price, userId]
      );
      
      // Добавляем персонажа пользователю
      await connection.query(
        'INSERT INTO user_characters (user_id, character_id) VALUES (?, ?)',
        [userId, characterId]
      );
      
      await connection.commit();
      
      // Получаем обновленные данные пользователя
      const [updatedUserData] = await pool.query(`
        SELECT u.id, u.username, us.high_score, us.coins, us.games_played, 
               us.total_time_minutes, ac.character_id as active_character
        FROM users u
        JOIN user_stats us ON u.id = us.user_id
        JOIN active_characters ac ON u.id = ac.user_id
        WHERE u.id = ?
      `, [userId]);
      
      // Получаем обновленный список персонажей пользователя
      const [characters] = await pool.query(`
        SELECT character_id FROM user_characters WHERE user_id = ?
      `, [userId]);
      
      const userCharacters = characters.map(c => c.character_id);
      
      res.json({
        success: true,
        message: 'Character purchased successfully',
        user: {
          id: updatedUserData[0].id,
          username: updatedUserData[0].username,
          highScore: updatedUserData[0].high_score,
          coins: updatedUserData[0].coins,
          gamesPlayed: updatedUserData[0].games_played,
          totalTimeMinutes: updatedUserData[0].total_time_minutes,
          activeCharacter: updatedUserData[0].active_character,
          characters: userCharacters
        }
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Character purchase error:', err);
    res.status(500).json({ success: false, message: 'Server error during character purchase' });
  }
});

// Маршрут для установки активного персонажа
app.post('/set-active-character', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { characterId } = req.body;
    
    // Проверяем, владеет ли пользователь этим персонажем
    const [ownedCharacter] = await pool.query(
      'SELECT character_id FROM user_characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );
    
    if (ownedCharacter.length === 0) {
      return res.status(403).json({ success: false, message: 'You do not own this character' });
    }
    
    // Обновляем активного персонажа
    await pool.query(
      'UPDATE active_characters SET character_id = ? WHERE user_id = ?',
      [characterId, userId]
    );
    
    // Получаем обновленные данные пользователя
    const [updatedUserData] = await pool.query(`
      SELECT u.id, u.username, us.high_score, us.coins, us.games_played, 
             us.total_time_minutes, ac.character_id as active_character
      FROM users u
      JOIN user_stats us ON u.id = us.user_id
      JOIN active_characters ac ON u.id = ac.user_id
      WHERE u.id = ?
    `, [userId]);
    
    // Получаем список персонажей пользователя
    const [characters] = await pool.query(`
      SELECT character_id FROM user_characters WHERE user_id = ?
    `, [userId]);
    
    const userCharacters = characters.map(c => c.character_id);
    
    res.json({
      success: true,
      message: 'Active character set successfully',
      user: {
        id: updatedUserData[0].id,
        username: updatedUserData[0].username,
        highScore: updatedUserData[0].high_score,
        coins: updatedUserData[0].coins,
        gamesPlayed: updatedUserData[0].games_played,
        totalTimeMinutes: updatedUserData[0].total_time_minutes,
        activeCharacter: updatedUserData[0].active_character,
        characters: userCharacters
      }
    });
  } catch (err) {
    console.error('Set active character error:', err);
    res.status(500).json({ success: false, message: 'Server error during character activation' });
  }
});

// Маршрут для обновления времени, проведенного на сайте
app.post('/update-time', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { minutesSpent } = req.body;
    
    if (!minutesSpent || minutesSpent <= 0) {
      return res.status(400).json({ success: false, message: 'Valid minutesSpent value required' });
    }
    
    // Обновляем время
    await pool.query(
      'UPDATE user_stats SET total_time_minutes = total_time_minutes + ? WHERE user_id = ?',
      [minutesSpent, userId]
    );
    
    res.json({ success: true, message: 'Time updated successfully' });
  } catch (err) {
    console.error('Time update error:', err);
    res.status(500).json({ success: false, message: 'Server error during time update' });
  }
});

// Маршрут для получения таблицы рекордов
app.get('/leaderboard', async (req, res) => {
  try {
    // Получаем таблицу рекордов
    const [leaderboardData] = await pool.query(`
      SELECT u.username, us.high_score, us.games_played, u.last_login
      FROM users u
      JOIN user_stats us ON u.id = us.user_id
      ORDER BY us.high_score DESC
      LIMIT 50
    `);
    
    // Форматируем данные для отправки клиенту
    const leaderboard = leaderboardData.map((entry, index) => ({
      rank: index + 1,
      username: entry.username,
      highScore: entry.high_score,
      gamesPlayed: entry.games_played,
      date: new Date(entry.last_login).toLocaleDateString()
    }));
    
    res.json({ success: true, leaderboard });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ success: false, message: 'Server error while fetching leaderboard' });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});