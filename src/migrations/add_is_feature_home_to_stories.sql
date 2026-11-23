-- Migration: Add is_feature_home column to stories table
ALTER TABLE `stories` ADD COLUMN IF NOT EXISTS `is_feature_home` ENUM('yes', 'no') DEFAULT 'no';
