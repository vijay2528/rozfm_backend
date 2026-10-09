-- Seed General Settings into settings table
INSERT INTO `settings` (`key`, `value`) VALUES
('platform_name', 'Roz FM'),
('support_email', 'support@rozfm.com'),
('default_language', 'English'),
('app_version', '1.0.0'),
('platform_tagline', 'Stories that stay with you.'),
('social_instagram', 'instagram.com/rozfm'),
('social_twitter', 'x.com/rozfm'),
('maintenance_mode', 'false'),
('allow_new_signups', 'true'),
('guest_mode_access', 'true')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `updated_at` = NOW();
