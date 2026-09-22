-- ============================================================
-- Migration: Add is_approved + admin_remarks to stories table
-- Default: 'Pending' — admin must explicitly approve a story
-- Allowed values: 'Pending' | 'Approved' | 'Rejected'
-- ============================================================

-- 1. Approval status field
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS is_approved ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending'
  AFTER status;

-- 2. Admin remarks / rejection reason — stored on every approve or reject action
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS admin_remarks TEXT NULL DEFAULT NULL
  AFTER is_approved;

-- 3. Index for fast filtering by approval status
CREATE INDEX IF NOT EXISTS idx_stories_is_approved ON stories (is_approved);

-- ============================================================
-- Verify
-- ============================================================
-- SELECT id, title, status, is_approved, admin_remarks FROM stories LIMIT 10;
