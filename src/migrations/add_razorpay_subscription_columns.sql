-- Migration: Add Razorpay Subscription columns
-- Run this on your database to support auto-pay subscriptions
-- Date: 2026-10-24

-- 1. Add razorpay_subscription_id + billing columns to subscriptions table
ALTER TABLE `subscriptions`
  ADD COLUMN IF NOT EXISTS `razorpay_subscription_id` VARCHAR(100) NULL DEFAULT NULL COMMENT 'Razorpay subscription ID (sub_xxx)' AFTER `expires_at`,
  ADD COLUMN IF NOT EXISTS `billing_cycle`            VARCHAR(20) NOT NULL DEFAULT 'monthly' COMMENT 'trial | monthly | quarterly | yearly' AFTER `razorpay_subscription_id`,
  ADD INDEX IF NOT EXISTS `idx_subscriptions_rzp_sub_id` (`razorpay_subscription_id`);

-- If billing_cycle was already created as ENUM by an earlier run, widen it:
ALTER TABLE `subscriptions` MODIFY COLUMN `billing_cycle` VARCHAR(20) NOT NULL DEFAULT 'monthly';

-- 2. Add razorpay_plan_id to purchase_plans (caches the Razorpay Plan ID so it is created only once per plan)
ALTER TABLE `purchase_plans`
  ADD COLUMN IF NOT EXISTS `razorpay_plan_id` VARCHAR(100) NULL DEFAULT NULL COMMENT 'Cached Razorpay Plan ID (plan_xxx)' AFTER `yearly_amount`;

-- 3. Index coin_transactions.reference_id (payment id) — used to prevent double-processing a payment
ALTER TABLE `coin_transactions`
  ADD INDEX IF NOT EXISTS `idx_coin_transactions_reference_id` (`reference_id`);
