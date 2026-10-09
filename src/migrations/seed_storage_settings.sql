-- Seed Storage Settings (Cloudflare R2, AWS S3, Firebase) into settings table
INSERT INTO `settings` (`key`, `value`) VALUES
('r2_bucket_name', 'rozfm-audio-prod'),
('r2_region', 'auto'),
('r2_enabled', 'true'),
('s3_bucket_name', 'rozfm-assets-backup'),
('firebase_project_id', 'rozfm-prod'),
('firebase_storage_enabled', 'true')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `updated_at` = NOW();
