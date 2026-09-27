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
      let rows = [];
      try {
        const [queryRows] = await pool.query(
          `SELECT s.*, p.name as plan_name, p.monthly_amount, p.yearly_amount, p.amount, p.price
           FROM subscriptions s
           LEFT JOIN purchase_plans p ON s.plan_id = p.id
           WHERE s.user_id = ? AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > NOW())
           ORDER BY s.expires_at DESC
           LIMIT 1`,
          [userId]
        );
        rows = queryRows;
      } catch (err) {
        const [queryRows] = await pool.query(
          `SELECT s.*, p.name as plan_name
           FROM subscriptions s
           LEFT JOIN purchase_plans p ON s.plan_id = p.id
           WHERE s.user_id = ? AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > NOW())
           ORDER BY s.expires_at DESC
           LIMIT 1`,
          [userId]
        );
        rows = queryRows;
      }

      const activeSub = rows && rows.length > 0 ? rows[0] : null;

      const monthlyAmount = activeSub && activeSub.monthly_amount !== undefined && activeSub.monthly_amount !== null
        ? Number(activeSub.monthly_amount)
        : (activeSub && activeSub.monthly_price !== undefined && activeSub.monthly_price !== null ? Number(activeSub.monthly_price) : null);

      const yearlyAmount = activeSub && activeSub.yearly_amount !== undefined && activeSub.yearly_amount !== null
        ? Number(activeSub.yearly_amount)
        : (activeSub && activeSub.yearly_price !== undefined && activeSub.yearly_price !== null ? Number(activeSub.yearly_price) : null);

      const fallbackAmount = activeSub
        ? (activeSub.amount !== undefined && activeSub.amount !== null ? Number(activeSub.amount) : (activeSub.price !== undefined && activeSub.price !== null ? Number(activeSub.price) : null))
        : null;

      const effectiveAmount = monthlyAmount ?? yearlyAmount ?? fallbackAmount;

      const activeSubscription = activeSub
        ? {
            id: Number(activeSub.id),
            plan_id: activeSub.plan_id ? Number(activeSub.plan_id) : null,
            plan_name: activeSub.plan_name || 'VIP Subscription',
            monthly_amount: monthlyAmount,
            yearly_amount: yearlyAmount,
            amount: effectiveAmount,
            price: effectiveAmount,
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
      let monthlyAmount = null;
      let yearlyAmount = null;
      let planAmount = null;

      if (plan_id) {
        try {
          const [planRows] = await pool.query(
            'SELECT * FROM purchase_plans WHERE id = ? LIMIT 1',
            [plan_id]
          );
          if (planRows && planRows[0]) {
            const p = planRows[0];
            planName = p.name || planName;
            monthlyAmount = p.monthly_amount !== undefined && p.monthly_amount !== null ? Number(p.monthly_amount) : (p.monthly_price ? Number(p.monthly_price) : null);
            yearlyAmount = p.yearly_amount !== undefined && p.yearly_amount !== null ? Number(p.yearly_amount) : (p.yearly_price ? Number(p.yearly_price) : null);
            const pVal = monthlyAmount ?? yearlyAmount ?? (p.amount !== undefined && p.amount !== null ? Number(p.amount) : (p.price !== undefined && p.price !== null ? Number(p.price) : null));
            planAmount = pVal;
          }
        } catch (_) {}
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
            monthly_amount: monthlyAmount,
            yearly_amount: yearlyAmount,
            amount: planAmount,
            price: planAmount,
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
