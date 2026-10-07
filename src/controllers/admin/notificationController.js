const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const PushNotificationService = require('../../services/pushNotificationService');

/**
 * Notifications sent from the admin panel are stored in the existing
 * `notifications` table with this type, so they show up in each user's
 * in-app inbox AND can be grouped back into a campaign history.
 */
const ADMIN_PUSH_TYPE = 'admin_push';

const SEGMENTS = {
  all: 'All Users',
  free: 'Free Users',
  premium: 'Premium Users',
  users: 'Selected Users',
};

/**
 * Build the WHERE clause that selects target users for a segment.
 * Blocked users are always excluded.
 */
function buildSegmentWhere(segment, userIds = []) {
  const where = ['is_blocked = 0'];
  const params = [];

  if (segment === 'free') {
    where.push("(subscription_type IS NULL OR LOWER(subscription_type) = 'free')");
  } else if (segment === 'premium') {
    where.push("(subscription_type IS NOT NULL AND LOWER(subscription_type) != 'free')");
  } else if (segment === 'users') {
    where.push(`id IN (${userIds.map(() => '?').join(',')})`);
    params.push(...userIds);
  }

  return { whereSql: where.join(' AND '), params };
}

function normalizeUserIds(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(list.map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0))];
}

function formatCount(n) {
  const num = Number(n || 0);
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

class AdminNotificationController {
  /**
   * POST /api/v1/admin/notifications/send
   * POST /api/v1/admin/notifications/push
   *
   * Body:
   *  - title        (required)
   *  - body | message (required)
   *  - segment      all | free | premium | users   (default: all)
   *  - user_ids     array or comma list (required when segment = users)
   *  - action_type  story | link | coins | none    (default: none)
   *  - action_value target story ID / URL
   */
  static async sendPush(req, res) {
    try {
      const title = String(req.body.title || '').trim();
      const message = String(req.body.body || req.body.message || '').trim();
      const segment = String(req.body.segment || 'all').toLowerCase();
      const actionType = String(req.body.action_type || 'none').toLowerCase();
      const actionValue = req.body.action_value ?? req.body.action_id ?? null;
      const userIds = normalizeUserIds(req.body.user_ids);

      if (!title || !message) {
        return ApiResponse.error(res, 'Title and message are required', 422);
      }
      if (title.length > 255) {
        return ApiResponse.error(res, 'Title must be 255 characters or less', 422);
      }
      if (!SEGMENTS[segment]) {
        return ApiResponse.error(res, `Invalid segment. Allowed: ${Object.keys(SEGMENTS).join(', ')}`, 422);
      }
      if (segment === 'users' && userIds.length === 0) {
        return ApiResponse.error(res, 'user_ids is required when segment is "users"', 422);
      }

      // 1. Resolve target users
      const { whereSql, params } = buildSegmentWhere(segment, userIds);
      const [targets] = await pool.query(`SELECT id FROM users WHERE ${whereSql}`, params);

      if (!targets.length) {
        return ApiResponse.error(res, 'No users match the selected segment', 404);
      }
      const targetIds = targets.map((u) => u.id);
      const actionId = actionValue !== null && actionValue !== '' ? String(actionValue) : null;

      // 2. Save to in-app inbox (bulk insert into existing notifications table)
      const CHUNK = 1000;
      for (let i = 0; i < targetIds.length; i += CHUNK) {
        const chunk = targetIds.slice(i, i + CHUNK);
        const values = chunk.map((uid) => [uid, ADMIN_PUSH_TYPE, title, message, null, 'bell', actionType, actionId, 0]);
        await pool.query(
          `INSERT INTO notifications
             (user_id, type, title, message, avatar_path, icon_type, action_type, action_id, is_read)
           VALUES ?`,
          [values]
        );
      }

      // 3. Fire FCM push through the global PushNotificationService
      const fcmData = {
        type: ADMIN_PUSH_TYPE,
        action_type: actionType,
        action_id: actionId || '',
      };

      let pushResult = { successCount: 0, failureCount: 0 };
      try {
        pushResult = segment === 'all'
          ? await PushNotificationService.sendToAllUsers(title, message, fcmData)
          : await PushNotificationService.sendToUserIds(targetIds, title, message, fcmData);
      } catch (pushErr) {
        console.error('[Admin Push] FCM dispatch failed:', pushErr.message);
      }

      return ApiResponse.success(
        res,
        {
          title,
          message,
          segment,
          segment_label: SEGMENTS[segment],
          action_type: actionType,
          action_value: actionId,
          recipients: targetIds.length,
          push_delivered: pushResult.successCount,
          push_failed: pushResult.failureCount,
        },
        `Notification sent to ${targetIds.length} user(s)`
      );
    } catch (err) {
      console.error('Error in admin send push API:', err);
      return ApiResponse.error(res, err.message || 'Failed to send notification', 500);
    }
  }

  /**
   * GET /api/v1/admin/notifications/reach?segment=all&user_ids=1,2
   * Live reach estimate for the composer.
   */
  static async reach(req, res) {
    try {
      const segment = String(req.query.segment || 'all').toLowerCase();
      if (!SEGMENTS[segment]) {
        return ApiResponse.error(res, `Invalid segment. Allowed: ${Object.keys(SEGMENTS).join(', ')}`, 422);
      }
      const userIds = normalizeUserIds(req.query.user_ids);
      if (segment === 'users' && userIds.length === 0) {
        return ApiResponse.success(res, { segment, total_users: 0, push_reachable: 0, matching_users: 0, percentage: 0 }, 'Reach estimate');
      }

      const { whereSql, params } = buildSegmentWhere(segment, userIds);
      const [[match]] = await pool.query(
        `SELECT COUNT(*) AS matching,
                SUM(device_token IS NOT NULL AND device_token != '') AS reachable
         FROM users WHERE ${whereSql}`,
        params
      );
      const [[all]] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE is_blocked = 0');

      const total = Number(all.total || 0);
      const matching = Number(match.matching || 0);
      const reachable = Number(match.reachable || 0);

      return ApiResponse.success(
        res,
        {
          segment,
          segment_label: SEGMENTS[segment],
          total_users: total,
          matching_users: matching,
          push_reachable: reachable,
          percentage: total > 0 ? Math.round((matching / total) * 100) : 0,
        },
        'Reach estimate retrieved successfully'
      );
    } catch (err) {
      console.error('Error in admin push reach API:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch reach estimate', 500);
    }
  }

  /**
   * GET /api/v1/admin/notifications/history?page=1&limit=20
   * Campaign history, grouped from the notifications table
   * (same title + message + action sent in the same minute = one campaign).
   */
  static async history(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      const types = req.query.type
        ? [String(req.query.type).trim()]
        : ['admin_push', 'system'];

      const typePlaceholders = types.map(() => '?').join(',');

      const groupSql = `
        FROM notifications n
        LEFT JOIN users u ON u.id = n.user_id
        WHERE n.type IN (${typePlaceholders})
        GROUP BY n.title, n.message, n.action_type, n.action_id, DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i')`;

      const [rows] = await pool.query(
        `SELECT n.title, n.message, n.action_type, n.action_id,
                MIN(n.created_at) AS sent_at,
                COUNT(*) AS recipients,
                SUM(n.is_read) AS opened,
                SUM(u.subscription_type IS NULL OR LOWER(u.subscription_type) = 'free') AS free_cnt
         ${groupSql}
         ORDER BY sent_at DESC
         LIMIT ? OFFSET ?`,
        [...types, limit, offset]
      );

      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM (SELECT 1 ${groupSql}) t`,
        types
      );
      const [[activeRow]] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE is_blocked = 0');
      const activeUsers = Number(activeRow.total || 0);

      const data = rows.map((r) => {
        const recipients = Number(r.recipients || 0);
        const opened = Number(r.opened || 0);
        const freeCnt = Number(r.free_cnt || 0);

        // Segment isn't stored separately, so infer it from who received it
        let segment = 'Selected Users';
        if (recipients >= activeUsers && activeUsers > 0) segment = 'All Users';
        else if (freeCnt === recipients) segment = 'Free Users';
        else if (freeCnt === 0) segment = 'Premium Users';

        return {
          title: r.title,
          message: r.message,
          action_type: r.action_type,
          action_value: r.action_id,
          segment,
          recipients,
          sent: formatCount(recipients),
          opened,
          openRate: recipients > 0 ? `${((opened / recipients) * 100).toFixed(1)}%` : '0%',
          sent_at: r.sent_at,
        };
      });

      const total = Number(countRow.total || 0);
      return ApiResponse.success(
        res,
        {
          data,
          pagination: {
            total,
            page,
            limit,
            total_pages: Math.ceil(total / limit),
          },
        },
        'Notification history retrieved successfully'
      );
    } catch (err) {
      console.error('Error in admin push history API:', err);
      return ApiResponse.error(res, err.message || 'Failed to fetch notification history', 500);
    }
  }
}

module.exports = AdminNotificationController;
