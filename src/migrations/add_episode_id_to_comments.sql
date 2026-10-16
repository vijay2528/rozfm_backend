-- Migration: Add episode_id to comments table for episode-level comments
-- Run this once against your database.

ALTER TABLE `comments`
  ADD COLUMN IF NOT EXISTS `episode_id` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `story_id`,
  ADD INDEX IF NOT EXISTS `idx_comments_episode_id` (`episode_id`);

-- Make story_id nullable so a comment can belong to either a story OR an episode
ALTER TABLE `comments`
  MODIFY COLUMN `story_id` BIGINT UNSIGNED NULL DEFAULT NULL;
