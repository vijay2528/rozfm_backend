const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class SubscriptionController {
  /**
   * GET /api/v1/subscriptions
   * GET /api/v1/subscription
   * Returns current active subscription status for the authenticated user.
   */
  static async index(req, res) {
    try {
      const userId = req.user?.id || null;

      if (!userId) {
        return ApiResponse.success(
          res,
          {
            is_subscribed: false,
            subscription: null,
          },
          'Subscription status fetched successfully.'
        );
      }

      // Auto-expire past active subscriptions
      try {
        await pool.query(
          "UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= NOW()",
          [userId]
        );
      } catch (e) {
        // Table or query warning ignored
      }

      // Query active subscription
      const [rows] = await pool.query(
        `SELECT s.*, p.name as plan_name, p.amount
         FROM subscriptions s
         LEFT JOIN purchase_plans p ON s.plan_id = p.id
         WHERE s.user_id = ? AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > NOW())
         ORDER BY s.expires_at DESC
         LIMIT 1`,
        [userId]
      );

      const activeSub = rows && rows.length > 0 ? rows[0] : null;

      const activeSubscription = activeSub
        ? {
          id: Number(activeSub.id),
          plan_id: activeSub.plan_id ? Number(activeSub.plan_id) : null,
          plan_name: activeSub.plan_name || 'VIP Subscription',
          price: activeSub.price ? Number(activeSub.price) : null,
          status: activeSub.status || 'active',
          is_active: activeSub.status === 'active',
          starts_at: activeSub.starts_at ? new Date(activeSub.starts_at).toISOString() : null,
          expires_at: activeSub.expires_at ? new Date(activeSub.expires_at).toISOString() : null,
        }
        : null;

      return ApiResponse.success(
        res,
        {
          is_subscribed: !!activeSubscription,
          subscription: activeSubscription,
        },
        'Subscription status fetched successfully.'
      );
    } catch (error) {
      console.error('Get Subscription Error:', error);
      return ApiResponse.error(res, 'Failed to fetch subscription status.', 500);
    }
  }

  /**
   * POST /api/v1/subscriptions
   * Activate or purchase a subscription pack.
   */
  static async store(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated.', 401);
      }

      const { plan_id, duration_days = 30 } = req.body;
      const durationDaysNum = parseInt(duration_days, 10) || 30;

      let planName = 'VIP Subscription';
      let planPrice = null;

      if (plan_id) {
        try {
          const [planRows] = await pool.query(
            'SELECT * FROM purchase_plans WHERE id = ? LIMIT 1',
            [plan_id]
          );
          if (planRows && planRows[0]) {
            planName = planRows[0].name || planName;
            planPrice = planRows[0].price ? Number(planRows[0].price) : null;
          }
        } catch (_) { }
      }

      const startsAt = new Date();
      const expiresAt = new Date(Date.now() + durationDaysNum * 24 * 60 * 60 * 1000);

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Deactivate previous active subscriptions
        await connection.query(
          "UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'",
          [userId]
        );

        // Insert new subscription
        const [result] = await connection.query(
          'INSERT INTO subscriptions (user_id, plan_id, status, starts_at, expires_at) VALUES (?, ?, ?, ?, ?)',
          [userId, plan_id || null, 'active', startsAt, expiresAt]
        );

        // Update user VIP subscription_type
        await connection.query(
          "UPDATE users SET subscription_type = 'vip' WHERE id = ?",
          [userId]
        );

        await connection.commit();

        return ApiResponse.success(
          res,
          {
            id: result.insertId,
            plan_id: plan_id ? Number(plan_id) : null,
            plan_name: planName,
            price: planPrice,
            status: 'active',
            is_active: true,
            starts_at: startsAt.toISOString(),
            expires_at: expiresAt.toISOString(),
          },
          'Subscription activated successfully.'
        );
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Activate Subscription Error:', error);
      return ApiResponse.error(res, 'Failed to activate subscription.', 500);
    }
  }
}

module.exports = SubscriptionController;
