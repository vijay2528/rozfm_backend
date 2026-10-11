-- Add key_permissions column if it doesn't already exist
ALTER TABLE `roles` ADD COLUMN IF NOT EXISTS `key_permissions` VARCHAR(255) NULL AFTER `permissions`;

-- Update or insert Super Admin role
INSERT INTO `roles` (`id`, `name`, `display_name`, `description`, `permissions`, `key_permissions`, `is_system`, `status`)
VALUES (1, 'admin', 'Super Admin', 'Full access to all system features, administration tools, and security controls.', '["*"]', 'Full access', 1, 1)
ON DUPLICATE KEY UPDATE 
  `display_name` = 'Super Admin',
  `description` = 'Full access to all system features, administration tools, and security controls.',
  `permissions` = '["*"]',
  `key_permissions` = 'Full access',
  `is_system` = 1,
  `status` = 1;

-- Update or insert Content Moderator role
INSERT INTO `roles` (`id`, `name`, `display_name`, `description`, `permissions`, `key_permissions`, `is_system`, `status`)
VALUES (2, 'moderator', 'Content Moderator', 'Access to moderate stories, episodes, user reviews, and reported comments.', '["stories.view","stories.edit","episodes.manage","moderation.view","moderation.manage","reviews.manage","comments.manage"]', 'Stories, Moderation', 1, 1)
ON DUPLICATE KEY UPDATE 
  `display_name` = 'Content Moderator',
  `description` = 'Access to moderate stories, episodes, user reviews, and reported comments.',
  `permissions` = '["stories.view","stories.edit","episodes.manage","moderation.view","moderation.manage","reviews.manage","comments.manage"]',
  `key_permissions` = 'Stories, Moderation',
  `is_system` = 1,
  `status` = 1;

-- Insert or update Finance role
INSERT INTO `roles` (`name`, `display_name`, `description`, `permissions`, `key_permissions`, `is_system`, `status`)
VALUES ('finance', 'Finance', 'Financial management: transactions, withdrawals, revenue share, and earnings reports.', '["payments.view","withdrawals.manage","creators.revshare","reports.export","coin_packs.manage","memberships.manage"]', 'Payments, Withdrawals, Reports', 1, 1)
ON DUPLICATE KEY UPDATE 
  `display_name` = 'Finance',
  `description` = 'Financial management: transactions, withdrawals, revenue share, and earnings reports.',
  `permissions` = '["payments.view","withdrawals.manage","creators.revshare","reports.export","coin_packs.manage","memberships.manage"]',
  `key_permissions` = 'Payments, Withdrawals, Reports',
  `is_system` = 1,
  `status` = 1;

-- Insert or update Support role
INSERT INTO `roles` (`name`, `display_name`, `description`, `permissions`, `key_permissions`, `is_system`, `status`)
VALUES ('support', 'Support', 'Customer care operations with read-only access to users, tickets, and FAQ resources.', '["users.view","tickets.read","faqs.manage","reports.manage"]', 'Users, Tickets (read-only)', 1, 1)
ON DUPLICATE KEY UPDATE 
  `display_name` = 'Support',
  `description` = 'Customer care operations with read-only access to users, tickets, and FAQ resources.',
  `permissions` = '["users.view","tickets.read","faqs.manage","reports.manage"]',
  `key_permissions` = 'Users, Tickets (read-only)',
  `is_system` = 1,
  `status` = 1;
