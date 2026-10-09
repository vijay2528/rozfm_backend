-- Seed Payment Keys into settings table
INSERT INTO `settings` (`key`, `value`) VALUES
('payment_key_razorpay_name', 'Razorpay'),
('payment_key_razorpay_key_id', 'rzp_live_987654321092ac'),
('payment_key_razorpay_key_secret', 'rzp_sec_9876543210'),
('payment_key_razorpay_mode', 'Live'),
('payment_key_razorpay_status', 'active'),

('payment_key_google_play_name', 'Google Play'),
('payment_key_google_play_key_id', 'gpa_332198765410df'),
('payment_key_google_play_key_secret', 'gpa_sec_3321987654'),
('payment_key_google_play_mode', 'Live'),
('payment_key_google_play_status', 'active'),

('payment_key_apple_storekit_name', 'Apple StoreKit'),
('payment_key_apple_storekit_key_id', 'app_112233445566e1'),
('payment_key_apple_storekit_key_secret', 'app_sec_1122334455'),
('payment_key_apple_storekit_mode', 'Live'),
('payment_key_apple_storekit_status', 'active')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `updated_at` = NOW();
