-- Seed Maintenance Mode Settings into settings table
INSERT INTO `settings` (`key`, `value`) VALUES
('maintenance_mode_active', 'false'),
('maintenance_message', 'We''re upgrading Roz FM for you. Back shortly!'),
('scheduled_start', '02 Aug 2026, 2:00 AM IST'),
('scheduled_end', '02 Aug 2026, 4:00 AM IST')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `updated_at` = NOW();
