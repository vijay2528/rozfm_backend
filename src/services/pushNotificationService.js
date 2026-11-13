/**
 * Push Notification Service
 * Sends real FCM push notifications via Firebase Admin SDK.
 * Device tokens are stored in the `device_token` column of the `users` table.
 * 
 * Payload structure strictly matches send_notification_payload.txt specs:
 *  - android: priority high, channel_id: high_importance_channel, icon: @mipmap/ic_launcher, sound: default
 *  - apns: apns-priority 10, alert { title, body }, sound: default, badge: 1, content-available: 1
 *  - data: click_action: FLUTTER_NOTIFICATION_CLICK, type, action_type, action_id, entity IDs
 */
const { getMessaging } = require('../config/firebase');
const { pool } = require('../config/db');

class PushNotificationService {
  /**
   * Internal builder to construct normalized FCM v1 message payload
   * conforming to Flutter FCM client and send_notification_payload.txt specs.
   */
  static _buildMessage({ token, tokens, title, body, data = {} }) {
    const sanitizedData = PushNotificationService._sanitizeData(data);

    // Ensure FLUTTER_NOTIFICATION_CLICK is always present for Flutter foreground/background click handling
    if (!sanitizedData.click_action) {
      sanitizedData.click_action = 'FLUTTER_NOTIFICATION_CLICK';
    }

    // Harmonize type and action_type
    if (sanitizedData.type && !sanitizedData.action_type) {
      sanitizedData.action_type = sanitizedData.type;
    }
    if (sanitizedData.action_type && !sanitizedData.type) {
      sanitizedData.type = sanitizedData.action_type;
    }

    // Map entity specific keys matching send_notification_payload.txt
    const targetType = (sanitizedData.type || sanitizedData.action_type || '').toLowerCase();
    const actionId = sanitizedData.action_id || sanitizedData.story_id || sanitizedData.episode_id || sanitizedData.comment_id;

    if (actionId && !sanitizedData.action_id) {
      sanitizedData.action_id = String(actionId);
    }

    if (targetType === 'story') {
      if (actionId && !sanitizedData.story_id) sanitizedData.story_id = String(actionId);
    } else if (targetType === 'episode') {
      if (actionId && !sanitizedData.episode_id) sanitizedData.episode_id = String(actionId);
      if (!sanitizedData.auto_unlock) sanitizedData.auto_unlock = 'true';
    } else if (targetType === 'comment') {
      if (actionId && !sanitizedData.comment_id) sanitizedData.comment_id = String(actionId);
      if (!sanitizedData.open_comments) sanitizedData.open_comments = 'true';
    } else if (targetType === 'review') {
      if (actionId && !sanitizedData.story_id) sanitizedData.story_id = String(actionId);
    }

    const titleStr = String(title || '');
    const bodyStr = String(body || '');

    const message = {
      notification: {
        title: titleStr,
        body: bodyStr,
      },
      data: sanitizedData,
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          channel_id: 'high_importance_channel',
          icon: '@mipmap/ic_launcher',
          sound: 'default',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            alert: {
              title: titleStr,
              body: bodyStr,
            },
            sound: 'default',
            badge: 1,
            contentAvailable: true,
            'content-available': 1,
          },
        },
      },
    };

    if (token) message.token = token;
    if (tokens) message.tokens = tokens;

    return message;
  }

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

    const message = PushNotificationService._buildMessage({
      token: deviceToken,
      title,
      body,
      data,
    });

    try {
      const messageId = await getMessaging().send(message);
      return messageId;
    } catch (error) {
      if (
        error.code === 'messaging/registration-token-not-registered' ||
        error.code === 'messaging/invalid-registration-token'
      ) {
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

    const BATCH_SIZE = 500;
    let totalSuccess = 0;
    let totalFailure = 0;
    const staleTokens = [];

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const message = PushNotificationService._buildMessage({
        tokens: batch,
        title,
        body,
        data,
      });

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

    // Clear stale tokens from DB asynchronously
    if (staleTokens.length > 0) {
      PushNotificationService._clearStaleTokens(staleTokens).catch(console.error);
    }

    return { successCount: totalSuccess, failureCount: totalFailure };
  }

  /**
   * Send a push notification to a single user by their user ID.
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

  // ─── Specialized Payload Helpers from send_notification_payload.txt ──────────

  /**
   * 1. New Story Notification Payload
   * Redirects to: View Story Screen (/view-story?id={story_id})
   */
  static async sendStoryNotification({
    recipientUserIds = null,
    storyId,
    storyTitle = '',
    authorName = 'Roz FM',
    title = 'New Story Released! 📚',
    body = null,
  }) {
    const finalBody = body || `Check out '${storyTitle}' by ${authorName}, now live on Roz FM.`;
    const payloadData = {
      type: 'story',
      action_type: 'story',
      action_id: String(storyId),
      story_id: String(storyId),
      title: String(storyTitle),
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };

    if (Array.isArray(recipientUserIds) && recipientUserIds.length > 0) {
      return PushNotificationService.sendToUserIds(recipientUserIds, title, finalBody, payloadData);
    }
    return PushNotificationService.sendToAllUsers(title, finalBody, payloadData);
  }

  /**
   * 2. New Episode Notification Payload
   * Redirects to: Play Episode Screen (/play-episode?episodeId={episode_id}&storyId={story_id})
   */
  static async sendEpisodeNotification({
    recipientUserIds = null,
    episodeId,
    storyId,
    episodeNumber = '',
    episodeTitle = '',
    title = 'New Episode Available! 🎙️',
    body = null,
  }) {
    const prefix = episodeNumber ? `Ep ${episodeNumber} - ` : '';
    const finalBody = body || `${prefix}'${episodeTitle || 'New Episode'}' is now available to listen.`;
    const payloadData = {
      type: 'episode',
      action_type: 'episode',
      action_id: String(episodeId),
      episode_id: String(episodeId),
      story_id: String(storyId || ''),
      auto_unlock: 'true',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };

    if (Array.isArray(recipientUserIds) && recipientUserIds.length > 0) {
      return PushNotificationService.sendToUserIds(recipientUserIds, title, finalBody, payloadData);
    }
    return PushNotificationService.sendToAllUsers(title, finalBody, payloadData);
  }

  /**
   * 3. New Comment / Reply Notification Payload
   * Redirects to: Play Episode / Open Comments Sheet
   */
  static async sendCommentNotification({
    recipientUserId,
    commentId,
    episodeId = null,
    storyId = null,
    commenterName = 'Someone',
    commentText = '',
    title = null,
    body = null,
  }) {
    if (!recipientUserId) return null;
    const finalTitle = title || (episodeId ? 'New Comment on your Episode 💬' : 'New Comment on your Story 💬');
    const snippet = commentText ? (commentText.length > 60 ? commentText.substring(0, 57) + '...' : commentText) : 'Great episode!';
    const finalBody = body || `${commenterName} commented: '${snippet}'`;

    const payloadData = {
      type: 'comment',
      action_type: 'comment',
      action_id: String(commentId || episodeId || storyId || ''),
      comment_id: String(commentId || ''),
      episode_id: episodeId ? String(episodeId) : '',
      story_id: storyId ? String(storyId) : '',
      open_comments: 'true',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };

    return PushNotificationService.sendToUser(recipientUserId, finalTitle, finalBody, payloadData);
  }

  /**
   * 4. New Review Notification Payload
   * Redirects to: Story Reviews Screen (/review?storyId={story_id})
   */
  static async sendReviewNotification({
    recipientUserId,
    storyId,
    storyTitle = 'Story',
    reviewerName = 'Someone',
    rating = 5,
    title = null,
    body = null,
  }) {
    if (!recipientUserId) return null;
    const stars = Math.min(5, Math.max(1, Math.round(Number(rating) || 5)));
    const finalTitle = title || `New ${stars}-Star Review! ⭐`;
    const finalBody = body || `${reviewerName} left a ${stars}-star review for '${storyTitle}'.`;

    const payloadData = {
      type: 'review',
      action_type: 'review',
      action_id: String(storyId),
      story_id: String(storyId),
      rating: String(stars),
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };

    return PushNotificationService.sendToUser(recipientUserId, finalTitle, finalBody, payloadData);
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
