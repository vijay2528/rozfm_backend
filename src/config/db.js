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

/**
 * Auto-ensure banners schema on startup
 */
async function ensureBannerColumns() {
  try {
    const alterQueries = [
      "ALTER TABLE `banners` ADD COLUMN IF NOT EXISTS `link_action` VARCHAR(512) NULL",
      "ALTER TABLE `banners` ADD COLUMN IF NOT EXISTS `starts_at` DATETIME NULL",
      "ALTER TABLE `banners` ADD COLUMN IF NOT EXISTS `ends_at` DATETIME NULL",
      "ALTER TABLE `banners` ADD COLUMN IF NOT EXISTS `sort_order` INT DEFAULT 0",
      "ALTER TABLE `banners` MODIFY COLUMN `position` VARCHAR(50) DEFAULT 'Home'",
      "ALTER TABLE `stories` ADD COLUMN IF NOT EXISTS `is_feature_home` ENUM('yes', 'no') DEFAULT 'no'",
      "ALTER TABLE `subscriptions` ADD COLUMN IF NOT EXISTS `razorpay_subscription_id` VARCHAR(100) NULL",
      "ALTER TABLE `subscriptions` ADD COLUMN IF NOT EXISTS `billing_cycle` VARCHAR(20) DEFAULT 'monthly'",
      "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `instagram_link` VARCHAR(512) NULL",
      "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `youtube_link` VARCHAR(512) NULL",
      "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `facebook_link` VARCHAR(512) NULL",
      `CREATE TABLE IF NOT EXISTS \`review_replies\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`review_id\` BIGINT UNSIGNED NOT NULL,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`reply\` TEXT NOT NULL,
        \`created_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_review_replies_review_id\` (\`review_id\`),
        INDEX \`idx_review_replies_user_id\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ];
    for (const sql of alterQueries) {
      await pool.query(sql).catch(() => {});
    }
  } catch (err) {
    console.warn('Schema sync warning:', err.message);
  }
}

/**
 * Verify database connectivity on server startup
 */
async function checkConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ Connected to MySQL database successfully.');

    // Ensure banner table columns exist automatically
    await ensureBannerColumns();

    // Run full table migrations automatically if explicitly enabled in .env (e.g. RUN_MIGRATIONS=true)
    if (process.env.RUN_MIGRATIONS === 'true') {
      const runMigrations = require('./migrate');
      await runMigrations();
    }
  } catch (error) {
    console.error('❌ Failed to connect to MySQL database:', error.message);
    throw error;
  }
}

module.exports = {
  pool,
  checkConnection,
  initDb: checkConnection,
};
