-- Push Notification Global Settings Seed
-- Run once to insert default values (all enabled).
-- Admin can toggle them OFF via POST /api/v1/admin/settings

INSERT INTO settings (`key`, `value`, created_at, updated_at)
VALUES
  ('push_notify_new_follower',     '1', NOW(), NOW()),
  ('push_notify_new_episode',      '1', NOW(), NOW()),
  ('push_notify_new_comment',      '1', NOW(), NOW()),
  ('push_notify_story_liked',      '1', NOW(), NOW()),
  ('push_notify_badge_earned',     '1', NOW(), NOW()),
  ('push_notify_streak_milestone', '1', NOW(), NOW()),
  ('push_notify_withdrawal',       '1', NOW(), NOW()),
  ('push_notify_story_approval',   '1', NOW(), NOW())
ON DUPLICATE KEY UPDATE updated_at = NOW();
