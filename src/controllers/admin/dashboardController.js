const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const { formatNumber } = require('../../utils/storyPresenter');

class DashboardController {
  /**
   * GET /api/v1/admin/dashboard
   * Fetch overview statistics, top metrics, recent users & transactions
   */
  static async index(req, res) {
    try {
      // 1. Total & recent users count
      const [[{ total_users }]] = await pool.query('SELECT COUNT(*) as total_users FROM users');
      const [[{ new_users_this_month }]] = await pool.query(
        "SELECT COUNT(*) as new_users_this_month FROM users WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')"
      );

      // 2. Stories & Episodes stats
      const [[{ total_stories }]] = await pool.query('SELECT COUNT(*) as total_stories FROM stories');
      const [[{ active_stories }]] = await pool.query(
        "SELECT COUNT(*) as active_stories FROM stories WHERE status IN ('ongoing', 'published')"
      );
      const [[{ total_episodes }]] = await pool.query('SELECT COUNT(*) as total_episodes FROM episodes');

      // 3. Plays & Listeners stats
      const [[{ total_plays }]] = await pool.query('SELECT SUM(plays_count) as total_plays FROM episodes');
      const [[{ total_listeners }]] = await pool.query('SELECT SUM(listeners_count) as total_listeners FROM stories');

      // 4. Revenue & Financial stats
      const [[{ total_coin_sales_amount }]] = await pool.query(
        'SELECT COALESCE(SUM(coins), 0) as total_coin_sales_amount FROM coin_transactions WHERE type = "credit"'
      );
      const [[{ total_active_subscriptions }]] = await pool.query(
        'SELECT COUNT(*) as total_active_subscriptions FROM subscriptions WHERE status = "active"'
      );

      // 5. Recent 5 user registrations
      const [recentUsers] = await pool.query(
        'SELECT id, name, email, phone, subscription_type, created_at FROM users ORDER BY created_at DESC LIMIT 5'
      );

      // 6. Recent 5 coin transactions
      const [recentTransactions] = await pool.query(
        `SELECT ct.*, u.name as user_name, u.email as user_email
         FROM coin_transactions ct
         LEFT JOIN users u ON ct.user_id = u.id
         ORDER BY ct.created_at DESC LIMIT 5`
      );

      // 7. Top 5 popular stories
      const [topStories] = await pool.query(
        `SELECT s.id, s.title, s.cover_image_path, s.listeners_count, s.total_views, c.category_name
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         ORDER BY s.total_views DESC LIMIT 5`
      );

      const overview = {
        users: {
          total: Number(total_users || 0),
          new_this_month: Number(new_users_this_month || 0),
          formatted_total: formatNumber(total_users || 0),
        },
        stories: {
          total: Number(total_stories || 0),
          active: Number(active_stories || 0),
        },
        episodes: {
          total: Number(total_episodes || 0),
        },
        engagement: {
          total_plays: Number(total_plays || 0),
          total_plays_formatted: formatNumber(total_plays || 0),
          total_listeners: Number(total_listeners || 0),
          total_listeners_formatted: formatNumber(total_listeners || 0),
        },
        financials: {
          total_coins_distributed: Number(total_coin_sales_amount || 0),
          active_subscriptions: Number(total_active_subscriptions || 0),
        },
      };

      return ApiResponse.success(res, {
        overview,
        recent_users: recentUsers,
        recent_transactions: recentTransactions,
        top_stories: topStories,
      });
    } catch (error) {
      console.error('Admin Dashboard Error:', error);
      return ApiResponse.error(res, 'Failed to load admin dashboard statistics.', 500);
    }
  }
}

module.exports = DashboardController;
