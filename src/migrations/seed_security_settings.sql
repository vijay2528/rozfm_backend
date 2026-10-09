-- Seed Security Settings into settings table
INSERT INTO `settings` (`key`, `value`) VALUES
('require_2fa_for_admins', 'false'),
('session_timeout', '15 minutes'),
('max_login_attempts', '3'),
('ip_allowlist_enforced', 'false')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `updated_at` = NOW();
