const { pool } = require('../config/db');

class NotificationService {
  /**
   * Format Javascript Date or SQL Timestamp to human readable time_ago string (e.g. "2m ago", "10m ago", "1h ago", "2d ago")
   */
  static formatTimeAgo(dateInput) {
    if (!dateInput) return 'just now';
    const date = new Date(dateInput);
    const now = new Date();
    const diffSeconds = Math.max(0, Math.floor((now - date) / 1000));

    if (diffSeconds < 60) return 'just now';
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    const diffYears = Math.floor(diffMonths / 12);
    return `${diffYears}y ago`;
  }

  /**
   * Helper to insert a notification into database
   */
  static async createNotification({
    userId,
    type = 'system',
    title,
    message,
    avatarPath = null,
    iconType = 'bell',
    actionType = 'none',
    actionId = null,
  }) {
    if (!userId || !title || !message) return null;

    const [result] = await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, avatar_path, icon_type, action_type, action_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
      [userId, type, title, message, avatarPath, iconType, actionType, actionId ? String(actionId) : null]
    );

    return result.insertId;
  }

  /**
   * Fetch paginated notifications for a user with unread count
   */
  static async getUserNotifications(userId, limit = 20, offset = 0) {
    const lim = Math.max(1, parseInt(limit, 10) || 20);
    const off = Math.max(0, parseInt(offset, 10) || 0);

    const [[{ unreadCount }]] = await pool.query(
      'SELECT COUNT(*) as unreadCount FROM notifications WHERE user_id = ? AND is_read = 0',
      [userId]
    );

    const [[{ totalCount }]] = await pool.query(
      'SELECT COUNT(*) as totalCount FROM notifications WHERE user_id = ?',
      [userId]
    );

    const [rows] = await pool.query(
      `SELECT * FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, lim, off]
    );

    const notifications = rows.map((n) => ({
      id: Number(n.id),
      user_id: Number(n.user_id),
      type: n.type || 'system',
      title: n.title,
      message: n.message,
      avatar_path: n.avatar_path || null,
      icon_type: n.icon_type || 'bell',
      action_type: n.action_type || 'none',
      action_id: n.action_id || null,
      is_read: Boolean(n.is_read),
      time_ago: this.formatTimeAgo(n.created_at),
      created_at: n.created_at ? new Date(n.created_at).toISOString() : null,
    }));

    return {
      unread_count: Number(unreadCount || 0),
      total_count: Number(totalCount || 0),
      notifications: notifications,
    };
  }

  /**
   * Get unread notifications count for a user
   */
  static async getUnreadCount(userId) {
    const [[{ unreadCount }]] = await pool.query(
      'SELECT COUNT(*) as unreadCount FROM notifications WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    return Number(unreadCount || 0);
  }

  /**
   * Mark a single notification as read
   */
  static async markAsRead(userId, notificationId) {
    await pool.query(
      'UPDATE notifications SET is_read = 1, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [notificationId, userId]
    );
  }

  /**
   * Mark all notifications for a user as read
   */
  static async markAllAsRead(userId) {
    const [result] = await pool.query(
      'UPDATE notifications SET is_read = 1, updated_at = NOW() WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    return result.affectedRows;
  }

  /**
   * Delete a single notification
   */
  static async deleteNotification(userId, notificationId) {
    const [result] = await pool.query(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?',
      [notificationId, userId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Clear all notifications for a user
   */
  static async clearAllNotifications(userId) {
    const [result] = await pool.query('DELETE FROM notifications WHERE user_id = ?', [userId]);
    return result.affectedRows;
  }
}

module.exports = NotificationService;
