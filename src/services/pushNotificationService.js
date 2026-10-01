/**
 * Push Notification Service
 * Sends real FCM push notifications via Firebase Admin SDK.
 * Device tokens are stored in the `device_token` column of the `users` table.
 */
const { getMessaging } = require('../config/firebase');
const { pool } = require('../config/db');

class PushNotificationService {
  /**
   * Send a push notification to a single FCM device token.
   *
   * @param {string} deviceToken   - FCM registration token
   * @param {string} title         - Notification title
   * @param {string} body          - Notification body/message
   * @param {object} data          - Optional key-value data payload
   * @returns {string|null}        - FCM message ID on success, null on failure
   */
  static async sendToToken(deviceToken, title, body, data = {}) {
    if (!deviceToken || !title || !body) return null;

    const message = {
      token: deviceToken,
      notification: {
        title: String(title),
        body: String(body),
      },
      data: PushNotificationService._sanitizeData(data),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'rozfm_default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    try {
      const messageId = await getMessaging().send(message);
      return messageId;
    } catch (error) {
      // Log but don't throw — invalid/expired tokens are common; don't break app flow
      if (error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/invalid-registration-token') {
        console.warn('[FCM] Stale token detected, clearing:', deviceToken.substring(0, 20) + '...');
        await PushNotificationService._clearStaleToken(deviceToken);
      } else {
        console.error('[FCM] Send error:', error.code || error.message);
      }
      return null;
    }
  }

  /**
   * Send a push notification to multiple FCM tokens (batch, max 500 per FCM call).
   *
   * @param {string[]} tokens  - Array of FCM registration tokens
   * @param {string}   title   - Notification title
   * @param {string}   body    - Notification body/message
   * @param {object}   data    - Optional key-value data payload
   * @returns {{ successCount: number, failureCount: number }}
   */
  static async sendToMultipleTokens(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) return { successCount: 0, failureCount: 0 };

    const sanitizedData = PushNotificationService._sanitizeData(data);

    // FCM allows max 500 tokens per multicast message
    const BATCH_SIZE = 500;
    let totalSuccess = 0;
    let totalFailure = 0;
    const staleTokens = [];

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);

      const message = {
        tokens: batch,
        notification: {
          title: String(title),
          body: String(body),
        },
        data: sanitizedData,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'rozfm_default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      try {
        const response = await getMessaging().sendEachForMulticast(message);
        totalSuccess += response.successCount;
        totalFailure += response.failureCount;

        // Collect stale/invalid tokens to clear from DB
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error && resp.error.code;
            if (
              errCode === 'messaging/registration-token-not-registered' ||
              errCode === 'messaging/invalid-registration-token'
            ) {
              staleTokens.push(batch[idx]);
            }
          }
        });
      } catch (error) {
        console.error('[FCM] Batch send error:', error.message);
        totalFailure += batch.length;
      }
    }

    // Clear stale tokens from DB asynchronously (fire-and-forget)
    if (staleTokens.length > 0) {
      PushNotificationService._clearStaleTokens(staleTokens).catch(console.error);
    }

    return { successCount: totalSuccess, failureCount: totalFailure };
  }

  /**
   * Send a push notification to a single user by their user ID.
   * Fetches the device_token from the users table.
   *
   * @param {number} userId   - User ID
   * @param {string} title    - Notification title
   * @param {string} body     - Notification body/message
   * @param {object} data     - Optional key-value data payload
   * @returns {string|null}   - FCM message ID or null
   */
  static async sendToUser(userId, title, body, data = {}) {
    if (!userId) return null;

    const [rows] = await pool.query(
      'SELECT device_token FROM users WHERE id = ? AND device_token IS NOT NULL AND device_token != "" LIMIT 1',
      [userId]
    );

    if (!rows.length || !rows[0].device_token) return null;

    return PushNotificationService.sendToToken(rows[0].device_token, title, body, data);
  }

  /**
   * Broadcast a push notification to ALL active (non-blocked) users.
   * Users without a device_token are skipped.
   *
   * @param {string} title  - Notification title
   * @param {string} body   - Notification body/message
   * @param {object} data   - Optional key-value data payload
   * @returns {{ successCount: number, failureCount: number }}
   */
  static async sendToAllUsers(title, body, data = {}) {
    const [rows] = await pool.query(
      `SELECT device_token FROM users
       WHERE is_blocked = 0
         AND device_token IS NOT NULL
         AND device_token != ''`
    );

    if (!rows.length) return { successCount: 0, failureCount: 0 };

    const tokens = rows.map((r) => r.device_token);
    return PushNotificationService.sendToMultipleTokens(tokens, title, body, data);
  }

  /**
   * Broadcast a push notification to a list of specific user IDs.
   *
   * @param {number[]} userIds - Array of user IDs
   * @param {string}   title   - Notification title
   * @param {string}   body    - Notification body/message
   * @param {object}   data    - Optional key-value data payload
   * @returns {{ successCount: number, failureCount: number }}
   */
  static async sendToUserIds(userIds, title, body, data = {}) {
    if (!userIds || userIds.length === 0) return { successCount: 0, failureCount: 0 };

    const placeholders = userIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT device_token FROM users
       WHERE id IN (${placeholders})
         AND device_token IS NOT NULL
         AND device_token != ''`,
      userIds
    );

    if (!rows.length) return { successCount: 0, failureCount: 0 };

    const tokens = rows.map((r) => r.device_token);
    return PushNotificationService.sendToMultipleTokens(tokens, title, body, data);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Ensure all data payload values are strings (FCM requirement).
   */
  static _sanitizeData(data = {}) {
    const sanitized = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) {
        sanitized[k] = String(v);
      }
    }
    return sanitized;
  }

  /**
   * Clear a single stale/invalid token from the users table.
   */
  static async _clearStaleToken(token) {
    try {
      await pool.query(
        'UPDATE users SET device_token = NULL WHERE device_token = ?',
        [token]
      );
    } catch (err) {
      console.error('[FCM] Failed to clear stale token:', err.message);
    }
  }

  /**
   * Clear multiple stale/invalid tokens from the users table.
   */
  static async _clearStaleTokens(tokens) {
    if (!tokens.length) return;
    const placeholders = tokens.map(() => '?').join(',');
    try {
      await pool.query(
        `UPDATE users SET device_token = NULL WHERE device_token IN (${placeholders})`,
        tokens
      );
      console.log(`[FCM] Cleared ${tokens.length} stale token(s).`);
    } catch (err) {
      console.error('[FCM] Failed to clear stale tokens:', err.message);
    }
  }
}

module.exports = PushNotificationService;
