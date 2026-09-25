-- ============================================================
-- Migration: Seed default ad reward settings
-- File: seed_ad_reward_settings.sql
-- Date: 2026-09-25
-- Description:
--   Inserts the default ad reward configuration keys into
--   the settings table (INSERT IGNORE — safe to run multiple
--   times; existing values are preserved).
--
--   Keys seeded:
--     coins_per_ad        – coins awarded per single ad watch
--     max_ads_per_day     – daily cap per user
--     daily_reset_hour    – UTC hour for daily counter reset
--     ad_reward_enabled   – master on/off switch (1 = on)
--     instant_reward      – coins credited instantly (1 = yes)
--     no_limit_mode       – bypass daily cap (0 = off)
--     ad_reward_tiers     – JSON array of tier configurations
-- ============================================================

-- Ensure settings table has an updated_at column (non-destructive add)
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Seed default values (INSERT IGNORE keeps existing rows intact)
INSERT IGNORE INTO settings (`key`, `value`) VALUES
  ('coins_per_ad',      '1'),
  ('max_ads_per_day',   '10'),
  ('daily_reset_hour',  '0'),
  ('ad_reward_enabled', '1'),
  ('instant_reward',    '1'),
  ('no_limit_mode',     '0'),
  ('ad_reward_tiers',   '[{"ads_count":1,"coins":1,"label":"1 Coin","subtitle":"Per Ad"},{"ads_count":3,"coins":3,"label":"3 Coins","subtitle":"Watch 3 ads"},{"ads_count":5,"coins":5,"label":"5 Coins","subtitle":"Watch 5 ads"},{"ads_count":10,"coins":10,"label":"10 Coins","subtitle":"Watch 10 ads"}]');
