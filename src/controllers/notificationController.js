const ApiResponse = require('../utils/apiResponse');
const NotificationService = require('../services/notificationService');

class NotificationController {
  /**
   * GET /api/v1/notifications
   * List notifications for authenticated user
   */
  static async index(req, res) {
    try {
      const userId = req.user.id;
      const limit = parseInt(req.query.limit || '20', 10);
      const page = parseInt(req.query.page || '1', 10);
      const offset = (page - 1) * limit;

      const data = await NotificationService.getUserNotifications(userId, limit, offset);

      return ApiResponse.success(res, {
        unread_count: data.unread_count,
        total_count: data.total_count,
        page: page,
        limit: limit,
        notifications: data.notifications,
      });
    } catch (error) {
      console.error('List Notifications Error:', error);
      return ApiResponse.error(res, 'Failed to fetch notifications.', 500);
    }
  }

  /**
   * GET /api/v1/notifications/unread-count
   * Fetch unread notification count badge number
   */
  static async unreadCount(req, res) {
    try {
      const userId = req.user.id;
      const unreadCount = await NotificationService.getUnreadCount(userId);
      return ApiResponse.success(res, { unread_count: unreadCount });
    } catch (error) {
      console.error('Unread Count Error:', error);
      return ApiResponse.error(res, 'Failed to fetch unread count.', 500);
    }
  }

  /**
   * POST /api/v1/notifications/:id/read or PUT /api/v1/notifications/:id/read
   * Mark a single notification as read
   */
  static async markRead(req, res) {
    try {
      const userId = req.user.id;
      const notificationId = req.params.id;

      await NotificationService.markAsRead(userId, notificationId);
      const unreadCount = await NotificationService.getUnreadCount(userId);

      return ApiResponse.success(
        res,
        { notification_id: Number(notificationId), is_read: true, unread_count: unreadCount },
        'Notification marked as read.'
      );
    } catch (error) {
      console.error('Mark Read Error:', error);
      return ApiResponse.error(res, 'Failed to mark notification as read.', 500);
    }
  }

  /**
   * POST /api/v1/notifications/mark-all-read or PUT /api/v1/notifications/mark-all-read
   * Mark all notifications for current user as read
   */
  static async markAllRead(req, res) {
    try {
      const userId = req.user.id;
      const affectedRows = await NotificationService.markAllAsRead(userId);

      return ApiResponse.success(
        res,
        { marked_count: affectedRows, unread_count: 0 },
        'All notifications marked as read.'
      );
    } catch (error) {
      console.error('Mark All Read Error:', error);
      return ApiResponse.error(res, 'Failed to mark all notifications as read.', 500);
    }
  }

  /**
   * DELETE /api/v1/notifications/:id
   * Delete a notification
   */
  static async destroy(req, res) {
    try {
      const userId = req.user.id;
      const notificationId = req.params.id;

      const deleted = await NotificationService.deleteNotification(userId, notificationId);
      if (!deleted) {
        return ApiResponse.error(res, 'Notification not found.', 404);
      }

      const unreadCount = await NotificationService.getUnreadCount(userId);
      return ApiResponse.success(
        res,
        { notification_id: Number(notificationId), unread_count: unreadCount },
        'Notification deleted successfully.'
      );
    } catch (error) {
      console.error('Delete Notification Error:', error);
      return ApiResponse.error(res, 'Failed to delete notification.', 500);
    }
  }

  /**
   * DELETE /api/v1/notifications
   * Clear all notifications for current user
   */
  static async clearAll(req, res) {
    try {
      const userId = req.user.id;
      const clearedCount = await NotificationService.clearAllNotifications(userId);

      return ApiResponse.success(
        res,
        { cleared_count: clearedCount, unread_count: 0 },
        'All notifications cleared successfully.'
      );
    } catch (error) {
      console.error('Clear All Notifications Error:', error);
      return ApiResponse.error(res, 'Failed to clear notifications.', 500);
    }
  }
}

module.exports = NotificationController;
