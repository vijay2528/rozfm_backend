-- Migration: Create membership_plans table
-- Created: 2026-10-01
-- Description: Stores subscription membership plans with monthly and yearly pricing options

CREATE TABLE IF NOT EXISTS `membership_plans` (
  `id`             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(100)    NOT NULL,
  `slug`           VARCHAR(120)    NOT NULL UNIQUE,
  `description`    TEXT            NULL,
  `monthly_amount` DECIMAL(10, 2)  NOT NULL DEFAULT 0.00 COMMENT 'Monthly subscription price in INR',
  `yearly_amount`  DECIMAL(10, 2)  NOT NULL DEFAULT 0.00 COMMENT 'Yearly subscription price in INR',
  `currency`       VARCHAR(10)     NOT NULL DEFAULT 'INR',
  `sort_order`     INT             NOT NULL DEFAULT 0,
  `is_active`      TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '1 = active (available for new subscriptions), 0 = inactive',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_membership_plans_is_active`  (`is_active`),
  KEY `idx_membership_plans_sort_order` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default plans
INSERT IGNORE INTO `membership_plans` (`name`, `slug`, `description`, `monthly_amount`, `yearly_amount`, `sort_order`, `is_active`)
VALUES
  ('Free',    'free',    'Basic access with limited features.',              0.00,   0.00,  0, 1),
  ('Premium', 'premium', 'Full access to all premium content and features.', 399.00, 3999.00, 1, 1),
  ('Gold',    'gold',    'All Premium benefits plus exclusive Gold perks.',  799.00, 7999.00, 2, 1);
