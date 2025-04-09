-- Создаем пользователя и права
DROP USER IF EXISTS 'lohozavrik_app'@'%';
CREATE USER 'lohozavrik_app'@'%' IDENTIFIED BY 'Srvpenis16';
GRANT ALL PRIVILEGES ON loxozavrik_db.* TO 'lohozavrik_app'@'%';
FLUSH PRIVILEGES;

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Таблица статистики пользователей
CREATE TABLE IF NOT EXISTS user_stats (
    user_id INT PRIMARY KEY,
    high_score INT DEFAULT 0,
    coins INT DEFAULT 0,
    games_played INT DEFAULT 0,
    total_time_minutes INT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Таблица персонажей
CREATE TABLE IF NOT EXISTS characters (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    price INT NOT NULL DEFAULT 0,
    is_default BOOLEAN DEFAULT FALSE
);

-- Таблица приобретенных персонажей
CREATE TABLE IF NOT EXISTS user_characters (
    user_id INT,
    character_id VARCHAR(20),
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, character_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- Таблица активных персонажей
CREATE TABLE IF NOT EXISTS active_characters (
    user_id INT PRIMARY KEY,
    character_id VARCHAR(20) NOT NULL,
    set_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- Таблица игровых сессий
CREATE TABLE IF NOT EXISTS game_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    score INT NOT NULL DEFAULT 0,
    coins_collected INT NOT NULL DEFAULT 0,
    duration_seconds INT NOT NULL DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Заполняем таблицу персонажей начальными данными
INSERT INTO characters (id, name, price, is_default) VALUES
('default', 'Лохозаврик', 0, TRUE),
('character1', 'Сиськослав', 10, FALSE),
('character2', 'Калонид', 25, FALSE),
('character3', 'Скуфлик-2', 50, FALSE),
('character4', 'Пидиди', 100, FALSE),
('character5', 'Скибиди Туалет', 200, FALSE);