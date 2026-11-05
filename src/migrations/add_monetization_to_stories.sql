-- Migration: Add monetization settings columns to stories table
ALTER TABLE `stories`
  ADD COLUMN IF NOT EXISTS `free_episodes_count` INT(11) DEFAULT 0 AFTER `is_premium`,
  ADD COLUMN IF NOT EXISTS `coin_price_per_episode` INT(11) DEFAULT 25 AFTER `free_episodes_count`,
  ADD COLUMN IF NOT EXISTS `is_monetized` TINYINT(1) DEFAULT 0 AFTER `coin_price_per_episode`;

