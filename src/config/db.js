const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'rozfm_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function initDb() {
  try {
    const connection = await pool.getConnection();

    // Ensure database exists
    const dbName = process.env.DB_DATABASE || 'rozfm_db';
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await connection.query(`USE \`${dbName}\`;`);

    // Users table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(120) NOT NULL,
        \`email\` VARCHAR(255) NULL UNIQUE,
        \`phone\` VARCHAR(20) NULL UNIQUE,
        \`password\` VARCHAR(255) NULL,
        \`country\` VARCHAR(100) NULL,
        \`state\` VARCHAR(100) NULL,
        \`city\` VARCHAR(100) NULL,
        \`age_group\` VARCHAR(50) NULL,
        \`gender\` VARCHAR(50) NULL,
        \`avatar_path\` VARCHAR(512) NULL,
        \`locale\` VARCHAR(10) NULL,
        \`subscription_type\` VARCHAR(50) DEFAULT 'free',
        \`wallet_balance\` DECIMAL(10, 2) DEFAULT 0.00,
        \`login_method\` VARCHAR(50) NULL,
        \`platform\` VARCHAR(50) DEFAULT 'android',
        \`device_token\` VARCHAR(512) NULL,
        \`device_type\` VARCHAR(50) DEFAULT 'android',
        \`is_blocked\` TINYINT(1) DEFAULT 0,
        \`blocked_at\` DATETIME NULL,
        \`last_login_at\` DATETIME NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // OtpVerifications table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`otp_verifications\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`phone\` VARCHAR(20) NOT NULL,
        \`otp\` VARCHAR(10) NOT NULL,
        \`device_token\` VARCHAR(512) NULL,
        \`device_type\` VARCHAR(50) NULL,
        \`expires_at\` DATETIME NOT NULL,
        \`verified_at\` DATETIME NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    connection.release();
    console.log('MySQL Database & Tables initialized successfully.');
  } catch (error) {
    console.error('Error initializing MySQL database:', error);
    throw error;
  }
}

module.exports = {
  pool,
  initDb,
};
