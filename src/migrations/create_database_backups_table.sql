CREATE TABLE IF NOT EXISTS `database_backups` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `backup_code` VARCHAR(50) NOT NULL UNIQUE,
  `file_name` VARCHAR(255) NULL,
  `file_path` VARCHAR(512) NULL,
  `file_size_bytes` BIGINT DEFAULT 0,
  `size_formatted` VARCHAR(50) DEFAULT '0 MB',
  `status` ENUM('pending', 'in_progress', 'success', 'failed') DEFAULT 'success',
  `backup_type` VARCHAR(50) DEFAULT 'automated',
  `created_by` INT NULL,
  `notes` TEXT NULL,
  `restored_at` DATETIME NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default backup restore points matching admin console
INSERT INTO `database_backups` (`backup_code`, `file_name`, `file_size_bytes`, `size_formatted`, `status`, `backup_type`, `created_at`)
VALUES
  ('BKP-9201', 'rozfm_backup_9201.sql.gz', 5153960755, '4.8 GB', 'success', 'automated', '2026-07-27 03:00:00'),
  ('BKP-9202', 'rozfm_backup_9202.sql.gz', 5798205850, '5.4 GB', 'success', 'automated', '2026-07-26 03:00:00'),
  ('BKP-9203', 'rozfm_backup_9203.sql.gz', 6442450944, '6.0 GB', 'success', 'automated', '2026-07-25 03:00:00'),
  ('BKP-9204', 'rozfm_backup_9204.sql.gz', 7086696038, '6.6 GB', 'success', 'automated', '2026-07-24 03:00:00'),
  ('BKP-9205', 'rozfm_backup_9205.sql.gz', 7730941133, '7.2 GB', 'success', 'automated', '2026-07-22 03:00:00')
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`), `size_formatted` = VALUES(`size_formatted`);
