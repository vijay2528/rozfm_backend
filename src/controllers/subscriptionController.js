const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class SubscriptionController {
  static async index(req, res) {
    try {
      const userId = req.user.id;
      const [rows] = await pool.query(
        `SELECT s.*, p.name as plan_name, p.price
         FROM subscriptions s
         LEFT JOIN purchase_plans p ON s.plan_id = p.id
         WHERE s.user_id = ? AND s.status = 'active'
         ORDER BY s.expires_at DESC`,
        [userId]
      );

      const activeSubscription = rows[0]
        ? {
            id: Number(rows[0].id),
            plan_name: rows[0].plan_name || 'VIP Subscription',
            status: rows[0].status,
            starts_at: rows[0].starts_at,
            expires_at: rows[0].expires_at,
          }
        : null;

      return ApiResponse.success(res, { subscription: activeSubscription });
    } catch (error) {
      console.error('Get Subscription Error:', error);
      return ApiResponse.error(res, 'Failed to fetch subscription status.', 500);
    }
  }

  static async store(req, res) {
    try {
      const userId = req.user.id;
      const { plan_id, duration_days = 30 } = req.body;

      const startsAt = new Date();
      const expiresAt = new Date(Date.now() + duration_days * 24 * 60 * 60 * 1000);

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Deactivate previous active subscriptions
        await connection.query("UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'", [userId]);

        // Insert new subscription
        const [result] = await connection.query(
          'INSERT INTO subscriptions (user_id, plan_id, status, starts_at, expires_at) VALUES (?, ?, ?, ?, ?)',
          [userId, plan_id || null, 'active', startsAt, expiresAt]
        );

        // Update user VIP subscription_type
        await connection.query("UPDATE users SET subscription_type = 'vip' WHERE id = ?", [userId]);

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      return ApiResponse.success(
        res,
        { status: 'active', expires_at: expiresAt },
        'Subscription activated successfully.'
      );
    } catch (error) {
      console.error('Activate Subscription Error:', error);
      return ApiResponse.error(res, 'Failed to activate subscription.', 500);
    }
  }
}

module.exports = SubscriptionController;
