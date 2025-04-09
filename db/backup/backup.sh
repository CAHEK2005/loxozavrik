#!/bin/bash

# Настройка переменных
BACKUP_DIR="/backup"
MYSQL_USER="root"
MYSQL_PASSWORD="$MYSQL_ROOT_PASSWORD"
MYSQL_HOST="db"
DATABASE="lohozavrik_db"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/$DATABASE-$DATE.sql"

# Создаем директорию для бэкапов, если её нет
mkdir -p $BACKUP_DIR

# Создаем бэкап
mysqldump -h$MYSQL_HOST -u$MYSQL_USER -p$MYSQL_PASSWORD $DATABASE > $BACKUP_FILE

# Сжимаем бэкап
gzip $BACKUP_FILE

# Удаляем старые бэкапы (старше 30 дней)
find $BACKUP_DIR -name "*.gz" -type f -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE.gz"