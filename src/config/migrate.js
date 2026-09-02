const { pool } = require('./db');
require('dotenv').config();

async function runMigrations() {
  let connection;
  try {
    console.log('🔄 Running Comprehensive Database Migrations...');
    connection = await pool.getConnection();

    const dbName = process.env.DB_DATABASE || 'rozfm_db';
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await connection.query(`USE \`${dbName}\`;`);

    // 1. Users table
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

    // 2. OtpVerifications table
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

    // 3. Categories table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`categories\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`category_name\` VARCHAR(255) NOT NULL,
        \`category_image_path\` VARCHAR(512) NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Seed default categories if empty
    const [catCount] = await connection.query('SELECT COUNT(*) AS count FROM categories');
    if (catCount[0].count === 0) {
      await connection.query(`
        INSERT INTO categories (id, category_name) VALUES
        (1, 'Romance'),
        (2, 'Drama'),
        (3, 'Thriller'),
        (4, 'Horror'),
        (5, 'Fantasy'),
        (6, 'Mystery')
      `);
      console.log('🌱 Default categories seeded!');
    }

    // 4. User Categories pivot table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`user_categories\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`category_id\` INT NOT NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY \`user_category_unique\` (\`user_id\`,\`category_id\`),
        CONSTRAINT \`fk_user_categories_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_user_categories_category\` FOREIGN KEY (\`category_id\`) REFERENCES \`categories\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Banners table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`banners\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`title\` VARCHAR(255) NULL,
        \`image_path\` VARCHAR(512) NOT NULL,
        \`link_action\` VARCHAR(512) NULL,
        \`position\` VARCHAR(50) DEFAULT 'Home',
        \`starts_at\` DATETIME NULL,
        \`ends_at\` DATETIME NULL,
        \`is_active\` TINYINT(1) DEFAULT 1,
        \`sort_order\` INT DEFAULT 0,
        \`action_type\` VARCHAR(50) DEFAULT 'none',
        \`action_value\` VARCHAR(255) NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Stories (formerly Series) table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`stories\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NULL,
        \`title\` VARCHAR(255) NOT NULL,
        \`slug\` VARCHAR(255) NULL,
        \`description\` TEXT NULL,
        \`category_id\` INT NULL,
        \`cover_image_path\` VARCHAR(512) NULL,
        \`banner_image_path\` VARCHAR(512) NULL,
        \`language\` VARCHAR(50) DEFAULT 'en',
        \`tags\` VARCHAR(512) NULL,
        \`status\` VARCHAR(50) DEFAULT 'published',
        \`episodes_count\` INT DEFAULT 0,
        \`listeners_count\` INT DEFAULT 0,
        \`total_views\` INT DEFAULT 0,
        \`shares_count\` INT DEFAULT 0,
        \`rating\` DECIMAL(3, 1) DEFAULT 0.0,
        \`is_premium\` TINYINT(1) DEFAULT 0,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_stories_category\` FOREIGN KEY (\`category_id\`) REFERENCES \`categories\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 7. Episodes table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`episodes\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`story_id\` INT NOT NULL,
        \`created_by\` INT NULL,
        \`episode_number\` INT NOT NULL,
        \`title\` VARCHAR(255) NOT NULL,
        \`description\` TEXT NULL,
        \`audio_path\` VARCHAR(512) NOT NULL,
        \`audio_title\` VARCHAR(255) NULL,
        \`duration\` INT DEFAULT 0,
        \`is_free\` TINYINT(1) DEFAULT 0,
        \`coins\` INT DEFAULT 25,
        \`publish_as\` VARCHAR(50) DEFAULT 'publish_now',
        \`scheduled_at\` DATETIME NULL,
        \`tags\` VARCHAR(512) NULL,
        \`plays_count\` INT DEFAULT 0,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_episodes_story\` FOREIGN KEY (\`story_id\`) REFERENCES \`stories\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_episodes_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Safe Alter Table for existing installations
    const alterQueries = [
      "ALTER TABLE `stories` ADD COLUMN IF NOT EXISTS `tags` VARCHAR(512) NULL",
      "ALTER TABLE `stories` ADD COLUMN IF NOT EXISTS `shares_count` INT DEFAULT 0",
      "ALTER TABLE `episodes` ADD COLUMN IF NOT EXISTS `created_by` INT NULL",
      "ALTER TABLE `episodes` ADD COLUMN IF NOT EXISTS `description` TEXT NULL",
      "ALTER TABLE `episodes` ADD COLUMN IF NOT EXISTS `publish_as` VARCHAR(50) DEFAULT 'publish_now'",
      "ALTER TABLE `episodes` ADD COLUMN IF NOT EXISTS `scheduled_at` DATETIME NULL",
      "ALTER TABLE `episodes` ADD COLUMN IF NOT EXISTS `tags` VARCHAR(512) NULL",
      "ALTER TABLE `episodes` ADD COLUMN IF NOT EXISTS `audio_title` VARCHAR(255) NULL",
      "ALTER TABLE `episodes` ALTER COLUMN `coins` SET DEFAULT 25",
      "ALTER TABLE `languages` ADD COLUMN IF NOT EXISTS `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
      "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `role_id` INT NULL",
      "ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `role` VARCHAR(50) DEFAULT 'user'",
      "ALTER TABLE `banners` ADD COLUMN IF NOT EXISTS `link_action` VARCHAR(512) NULL",
      "ALTER TABLE `banners` ADD COLUMN IF NOT EXISTS `starts_at` DATETIME NULL",
      "ALTER TABLE `banners` ADD COLUMN IF NOT EXISTS `ends_at` DATETIME NULL",
      "ALTER TABLE `banners` ADD COLUMN IF NOT EXISTS `sort_order` INT DEFAULT 0",
      "ALTER TABLE `banners` MODIFY COLUMN `position` VARCHAR(50) DEFAULT 'Home'",
    ];

    for (const alterSql of alterQueries) {
      try {
        await connection.query(alterSql);
      } catch (_) {
        // Ignore if column already exists in older MySQL versions
      }
    }

    // 8. Reviews table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`reviews\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`story_id\` INT NOT NULL,
        \`rating\` INT NOT NULL,
        \`review\` TEXT NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY \`user_story_review_unique\` (\`user_id\`,\`story_id\`),
        CONSTRAINT \`fk_reviews_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_reviews_story\` FOREIGN KEY (\`story_id\`) REFERENCES \`stories\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 9. Comments table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`comments\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`story_id\` INT NOT NULL,
        \`parent_id\` INT NULL,
        \`comment\` TEXT NOT NULL,
        \`likes_count\` INT DEFAULT 0,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_comments_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_comments_story\` FOREIGN KEY (\`story_id\`) REFERENCES \`stories\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 10. Comment Likes table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`comment_likes\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`comment_id\` INT NOT NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`user_comment_like_unique\` (\`user_id\`,\`comment_id\`),
        CONSTRAINT \`fk_comment_likes_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_comment_likes_comment\` FOREIGN KEY (\`comment_id\`) REFERENCES \`comments\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 11. Story Likes table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`story_likes\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`story_id\` INT NOT NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`user_story_like_unique\` (\`user_id\`,\`story_id\`),
        CONSTRAINT \`fk_story_likes_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_story_likes_story\` FOREIGN KEY (\`story_id\`) REFERENCES \`stories\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 12. Bookmarks table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`bookmarks\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`story_id\` INT NOT NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`user_bookmark_unique\` (\`user_id\`,\`story_id\`),
        CONSTRAINT \`fk_bookmarks_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_bookmarks_story\` FOREIGN KEY (\`story_id\`) REFERENCES \`stories\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 13. Watch History table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`watch_histories\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`story_id\` INT NOT NULL,
        \`episode_id\` INT NULL,
        \`progress_seconds\` INT DEFAULT 0,
        \`completed\` TINYINT(1) DEFAULT 0,
        \`last_watched_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_watch_histories_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_watch_histories_story\` FOREIGN KEY (\`story_id\`) REFERENCES \`stories\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 14. Purchase Plans table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`purchase_plans\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(255) NOT NULL,
        \`coins\` INT DEFAULT 0,
        \`bonus_coins\` INT DEFAULT 0,
        \`price\` DECIMAL(10, 2) NOT NULL,
        \`currency\` VARCHAR(10) DEFAULT 'INR',
        \`badge_text\` VARCHAR(100) NULL,
        \`is_popular\` TINYINT(1) DEFAULT 0,
        \`status\` TINYINT(1) DEFAULT 1,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 15. Coin Sales table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`coin_sales\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`pack_name\` VARCHAR(255) NOT NULL,
        \`coins\` INT DEFAULT 0,
        \`amount\` DECIMAL(10, 2) NOT NULL,
        \`is_best_value\` TINYINT(1) DEFAULT 0,
        \`status\` TINYINT(1) DEFAULT 1,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 16. Coin Transactions table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`coin_transactions\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`type\` VARCHAR(50) NOT NULL,
        \`coins\` INT NOT NULL,
        \`description\` VARCHAR(255) NULL,
        \`reference_id\` VARCHAR(255) NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_coin_transactions_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 17. Subscriptions table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`subscriptions\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`plan_id\` INT NULL,
        \`status\` VARCHAR(50) DEFAULT 'active',
        \`starts_at\` DATETIME NULL,
        \`expires_at\` DATETIME NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_subscriptions_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 18. User Episode Unlocks table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`user_episode_unlocks\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`episode_id\` INT NOT NULL,
        \`coins_spent\` INT DEFAULT 0,
        \`unlocked_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`user_episode_unlock_unique\` (\`user_id\`,\`episode_id\`),
        CONSTRAINT \`fk_unlocks_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_unlocks_episode\` FOREIGN KEY (\`episode_id\`) REFERENCES \`episodes\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 19. User Notification Settings table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`user_notification_settings\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL UNIQUE,
        \`new_episodes\` TINYINT(1) DEFAULT 1,
        \`promotions\` TINYINT(1) DEFAULT 1,
        \`recommendations\` TINYINT(1) DEFAULT 1,
        \`account_activity\` TINYINT(1) DEFAULT 1,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_notif_settings_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 20. Settings table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`settings\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(100) NOT NULL UNIQUE,
        \`value\` TEXT NULL,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 21. Languages table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`languages\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(100) NOT NULL,
        \`code\` VARCHAR(10) NOT NULL UNIQUE,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 22. Roles table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`roles\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(100) NOT NULL UNIQUE,
        \`display_name\` VARCHAR(100) NOT NULL,
        \`description\` TEXT NULL,
        \`permissions\` JSON NULL,
        \`is_system\` TINYINT(1) DEFAULT 0,
        \`status\` TINYINT(1) DEFAULT 1,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 23. FAQs table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`faqs\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`question\` TEXT NOT NULL,
        \`answer\` TEXT NOT NULL,
        \`position\` INT DEFAULT 0,
        \`status\` TINYINT(1) DEFAULT 1,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 24. Support FAQ Menus table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`support_faq_menus\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`title\` VARCHAR(255) NOT NULL,
        \`position\` INT DEFAULT 0,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 25. Support FAQ Questions table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`support_faq_questions\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`menu_id\` INT NOT NULL,
        \`question\` TEXT NOT NULL,
        \`answer\` TEXT NOT NULL,
        \`position\` INT DEFAULT 0,
        \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_support_faq_menu\` FOREIGN KEY (\`menu_id\`) REFERENCES \`support_faq_menus\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Seed default roles if empty
    const [[{ roleCount }]] = await connection.query('SELECT COUNT(*) as roleCount FROM \`roles\`');
    if (roleCount === 0) {
      const defaultRoles = [
        {
          name: 'admin',
          display_name: 'Administrator',
          description: 'Full administrative access to all backend resources and system settings.',
          permissions: JSON.stringify(['*']),
          is_system: 1,
          status: 1
        },
        {
          name: 'moderator',
          display_name: 'Content Moderator',
          description: 'Access to moderate user reviews, comments, and reported content.',
          permissions: JSON.stringify(['content.read', 'moderation.read', 'moderation.manage', 'users.read']),
          is_system: 1,
          status: 1
        },
        {
          name: 'creator',
          display_name: 'Content Creator',
          description: 'Access to upload and manage audio stories and episodes.',
          permissions: JSON.stringify(['content.read', 'content.manage']),
          is_system: 1,
          status: 1
        },
        {
          name: 'user',
          display_name: 'Standard User',
          description: 'Regular app end-user role.',
          permissions: JSON.stringify([]),
          is_system: 1,
          status: 1
        }
      ];

      for (const r of defaultRoles) {
        await connection.query(
          `INSERT INTO \`roles\` (\`name\`, \`display_name\`, \`description\`, \`permissions\`, \`is_system\`, \`status\`) VALUES (?, ?, ?, ?, ?, ?)`,
          [r.name, r.display_name, r.description, r.permissions, r.is_system, r.status]
        );
      }
    }

    // Seed default languages if empty
    const [[{ langCount }]] = await connection.query('SELECT COUNT(*) as langCount FROM \`languages\`');
    if (langCount === 0) {
      const defaultLanguages = [
        { name: 'Hindi', code: 'hi' },
        { name: 'English', code: 'en' },
        { name: 'Tamil', code: 'ta' },
        { name: 'Telugu', code: 'te' },
        { name: 'Kannada', code: 'kn' },
        { name: 'Malayalam', code: 'ml' },
        { name: 'Bengali', code: 'bn' },
        { name: 'Marathi', code: 'mr' }
      ];

      for (const l of defaultLanguages) {
        await connection.query(
          `INSERT INTO \`languages\` (\`name\`, \`code\`) VALUES (?, ?)`,
          [l.name, l.code]
        );
      }
    }

    console.log('✅ Database migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;
