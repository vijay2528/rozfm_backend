/**
 * Push Notification Settings Service
 *
 * Reads per-event push notification toggles from the `settings` table.
 * Admin can enable/disable each event type via the existing settings API:
 *   POST /api/v1/admin/settings
 *   { "push_notify_new_follower": "1", "push_notify_new_episode": "0", ... }
 *
 * Available keys (value "1" = enabled, "0" = disabled):
 *   push_notify_new_follower      — someone follows a user
 *   push_notify_new_episode       — new episode on followed story
 *   push_notify_new_comment       — comment on story
 *   push_notify_story_liked       — someone likes your story
 *   push_notify_badge_earned      — badge earned / claimed
 *   push_notify_streak_milestone  — streak milestone reward
 *   push_notify_withdrawal        — withdrawal approved/rejected/paid
 *   push_notify_story_approval    — story approved/rejected by admin
 *
 * All flags default to ENABLED (1) when not explicitly set in settings table.
 */
const { pool } = require('../config/db');

// In-memory cache: refreshed every 60 seconds
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 60 * 1000;

const PUSH_SETTING_KEYS = [
  'push_notify_new_follower',
  'push_notify_new_episode',
  'push_notify_new_comment',
  'push_notify_story_liked',
  'push_notify_badge_earned',
  'push_notify_streak_milestone',
  'push_notify_withdrawal',
  'push_notify_story_approval',
];

class PushNotificationSettings {
  /**
   * Load push notification settings from DB (cached 60s).
   * @returns {Promise<object>} map of key → boolean
   */
  static async getAll() {
    const now = Date.now();
    if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;

    try {
      const placeholders = PUSH_SETTING_KEYS.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT \`key\`, \`value\` FROM settings WHERE \`key\` IN (${placeholders})`,
        PUSH_SETTING_KEYS
      );

      const map = {};
      PUSH_SETTING_KEYS.forEach((k) => { map[k] = true; }); // default ON
      rows.forEach((r) => { map[r.key] = r.value !== '0' && r.value !== 'false'; });

      _cache = map;
      _cacheAt = now;
      return map;
    } catch {
      // On DB error, default everything to enabled
      const map = {};
      PUSH_SETTING_KEYS.forEach((k) => { map[k] = true; });
      return map;
    }
  }

  /**
   * Check if a specific push event is enabled.
   * @param {string} key - one of the PUSH_SETTING_KEYS
   * @returns {Promise<boolean>}
   */
  static async isEnabled(key) {
    const settings = await PushNotificationSettings.getAll();
    return settings[key] !== false;
  }

  /** Invalidate the in-memory cache (call after settings update) */
  static invalidateCache() {
    _cache = null;
    _cacheAt = 0;
  }
}

module.exports = PushNotificationSettings;
