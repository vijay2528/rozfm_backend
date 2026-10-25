-- Migration: Create episode_reports table for user-submitted episode reports
-- Run this once against your database.

CREATE TABLE IF NOT EXISTS `episode_reports` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `episode_id` INT NOT NULL,
  `story_id` INT NULL DEFAULT NULL,
  `reason` VARCHAR(100) NULL DEFAULT NULL,
  `message` TEXT NULL,
  `status` ENUM('pending', 'reviewed', 'resolved', 'rejected') NOT NULL DEFAULT 'pending',
  `admin_note` TEXT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_episode_reports_user_id` (`user_id`),
  INDEX `idx_episode_reports_episode_id` (`episode_id`),
  INDEX `idx_episode_reports_story_id` (`story_id`),
  INDEX `idx_episode_reports_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
