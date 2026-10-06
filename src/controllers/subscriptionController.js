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
        `SELECT s.*, 
                p.name AS plan_name, 
                p.slug AS plan_slug, 
                p.description AS plan_description, 
                p.monthly_amount, 
                p.yearly_amount
         FROM subscriptions s
         LEFT JOIN purchase_plans p ON s.plan_id = p.id
         WHERE s.user_id = ? AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > NOW())
         ORDER BY s.expires_at DESC
         LIMIT 1`,
        [userId]
      );

      const activeSub = rows && rows.length > 0 ? rows[0] : null;

      const monthlyAmount = activeSub && activeSub.monthly_amount !== undefined && activeSub.monthly_amount !== null
        ? Number(activeSub.monthly_amount)
        : null;

      const yearlyAmount = activeSub && activeSub.yearly_amount !== undefined && activeSub.yearly_amount !== null
        ? Number(activeSub.yearly_amount)
        : null;

      const effectiveAmount = monthlyAmount ?? yearlyAmount ?? null;

      const activeSubscription = activeSub
        ? {
            id: Number(activeSub.id),
            plan_id: activeSub.plan_id ? Number(activeSub.plan_id) : null,
            plan_name: activeSub.plan_name || 'VIP Subscription',
            plan_slug: activeSub.plan_slug || null,
            plan_description: activeSub.plan_description || null,
            monthly_amount: monthlyAmount,
            yearly_amount: yearlyAmount,
            amount: effectiveAmount,
            status: activeSub.status || 'active',
            is_active: activeSub.status === 'active',
            starts_at: activeSub.starts_at ? new Date(activeSub.starts_at).toISOString() : null,
            expires_at: activeSub.expires_at ? new Date(activeSub.expires_at).toISOString() : null,
            created_at: activeSub.created_at ? new Date(activeSub.created_at).toISOString() : null,
            updated_at: activeSub.updated_at ? new Date(activeSub.updated_at).toISOString() : null,
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
            monthlyAmount = p.monthly_amount !== undefined && p.monthly_amount !== null ? Number(p.monthly_amount) : null;
            yearlyAmount = p.yearly_amount !== undefined && p.yearly_amount !== null ? Number(p.yearly_amount) : null;
            planAmount = durationDaysNum > 60 ? (yearlyAmount ?? monthlyAmount) : (monthlyAmount ?? yearlyAmount);
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

  /**
   * GET /api/v1/subscriptions/history
   * GET /api/v1/user/subscriptions/history
   * List all subscription plan purchase history for the authenticated user.
   */
  static async history(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated.', 401);
      }

      // Auto-expire past active subscriptions
      try {
        await pool.query(
          "UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= NOW()",
          [userId]
        );
      } catch (_) {}

      // Query all subscriptions for user with actual purchase_plans columns
      const [subRows] = await pool.query(
        `SELECT s.*, 
                p.name AS plan_name, 
                p.slug AS plan_slug,
                p.description AS plan_description,
                p.monthly_amount, 
                p.yearly_amount,
                p.is_active AS plan_is_active,
                p.sort_order AS plan_sort_order
         FROM subscriptions s
         LEFT JOIN purchase_plans p ON s.plan_id = p.id
         WHERE s.user_id = ?
         ORDER BY s.created_at DESC, s.id DESC`,
        [userId]
      );

      // Query plan transactions from coin_transactions (purchased via Razorpay / Wallet)
      const [txnRows] = await pool.query(
        `SELECT ct.*, 
                p.name AS plan_name, 
                p.slug AS plan_slug,
                p.description AS plan_description,
                p.monthly_amount, 
                p.yearly_amount
         FROM coin_transactions ct
         LEFT JOIN purchase_plans p ON ct.plan_id = p.id
         WHERE ct.user_id = ? AND (ct.type = 'plan_purchase' OR ct.plan_id IS NOT NULL)
         ORDER BY ct.created_at DESC, ct.id DESC`,
        [userId]
      );

      // Build combined history
      const historyList = [];
      const matchedTxnIds = new Set();

      for (const s of subRows) {
        // Find matching transaction by plan_id
        const matchingTxn = txnRows.find(
          (t) => !matchedTxnIds.has(t.id) && Number(t.plan_id) === Number(s.plan_id)
        );
        if (matchingTxn) {
          matchedTxnIds.add(matchingTxn.id);
        }

        const monthlyAmount = s.monthly_amount !== undefined && s.monthly_amount !== null ? Number(s.monthly_amount) : null;
        const yearlyAmount = s.yearly_amount !== undefined && s.yearly_amount !== null ? Number(s.yearly_amount) : null;

        const startsAtDate = s.starts_at ? new Date(s.starts_at) : (s.created_at ? new Date(s.created_at) : new Date());
        const expiresAtDate = s.expires_at ? new Date(s.expires_at) : null;
        const isActive = s.status === 'active' && (!expiresAtDate || expiresAtDate > new Date());
        const durationDays = expiresAtDate && startsAtDate 
          ? Math.max(1, Math.round((expiresAtDate.getTime() - startsAtDate.getTime()) / (1000 * 60 * 60 * 24)))
          : 30;

        const effectiveAmount = durationDays > 60
          ? (yearlyAmount ?? monthlyAmount ?? (matchingTxn ? Number(matchingTxn.amount || 0) : 0))
          : (monthlyAmount ?? yearlyAmount ?? (matchingTxn ? Number(matchingTxn.amount || 0) : 0));

        historyList.push({
          id: Number(s.id),
          subscription_id: Number(s.id),
          transaction_id: matchingTxn ? Number(matchingTxn.id) : null,
          plan_id: s.plan_id ? Number(s.plan_id) : null,
          plan_name: s.plan_name || 'VIP Subscription',
          plan_slug: s.plan_slug || null,
          plan_description: s.plan_description || null,
          monthly_amount: monthlyAmount,
          yearly_amount: yearlyAmount,
          amount: effectiveAmount,
          status: isActive ? 'active' : (s.status || 'expired'),
          is_active: isActive,
          payment_status: matchingTxn ? (matchingTxn.payment_status || 'paid') : 'paid',
          reference_id: matchingTxn ? matchingTxn.reference_id : null,
          starts_at: s.starts_at ? new Date(s.starts_at).toISOString() : null,
          expires_at: s.expires_at ? new Date(s.expires_at).toISOString() : null,
          duration_days: durationDays,
          created_at: s.created_at ? new Date(s.created_at).toISOString() : null,
          updated_at: s.updated_at ? new Date(s.updated_at).toISOString() : null,
        });
      }

      // Include standalone plan transactions from coin_transactions that were not matched
      for (const t of txnRows) {
        if (!matchedTxnIds.has(t.id)) {
          const monthlyAmount = t.monthly_amount !== undefined && t.monthly_amount !== null ? Number(t.monthly_amount) : null;
          const yearlyAmount = t.yearly_amount !== undefined && t.yearly_amount !== null ? Number(t.yearly_amount) : null;
          const priceVal = t.amount !== undefined && t.amount !== null 
            ? Number(t.amount) 
            : (monthlyAmount ?? yearlyAmount ?? 0);

          historyList.push({
            id: Number(t.id),
            subscription_id: null,
            transaction_id: Number(t.id),
            plan_id: t.plan_id ? Number(t.plan_id) : null,
            plan_name: t.plan_name || 'VIP Plan',
            plan_slug: t.plan_slug || null,
            plan_description: t.plan_description || null,
            monthly_amount: monthlyAmount,
            yearly_amount: yearlyAmount,
            amount: priceVal,
            status: String(t.payment_status).toLowerCase() === 'failed' ? 'failed' : 'completed',
            is_active: false,
            payment_status: t.payment_status || 'paid',
            reference_id: t.reference_id || null,
            starts_at: t.created_at ? new Date(t.created_at).toISOString() : null,
            expires_at: null,
            duration_days: 30,
            created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
            updated_at: null,
          });
        }
      }

      // Sort newest first
      historyList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // Optional status filtering (?status=active | ?status=expired | ?status=failed)
      let filteredHistory = historyList;
      if (req.query.status && req.query.status !== 'all') {
        const filterStatus = String(req.query.status).toLowerCase();
        if (filterStatus === 'active') {
          filteredHistory = historyList.filter((h) => h.is_active);
        } else if (filterStatus === 'expired') {
          filteredHistory = historyList.filter((h) => !h.is_active && h.status !== 'failed');
        } else if (filterStatus === 'failed') {
          filteredHistory = historyList.filter((h) => h.status === 'failed' || h.payment_status === 'failed');
        }
      }

      // Pagination support
      const totalCount = filteredHistory.length;
      let paginatedHistory = filteredHistory;
      let pagination = null;

      if (req.query.page || req.query.limit) {
        const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
        const offset = (pageNum - 1) * limitNum;
        paginatedHistory = filteredHistory.slice(offset, offset + limitNum);
        pagination = {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(totalCount / limitNum),
        };
      }

      const activeSub = historyList.find((h) => h.is_active) || null;

      const responsePayload = {
        total_plans_purchased: totalCount,
        active_subscription: activeSub,
        history: paginatedHistory,
        subscriptions: paginatedHistory,
      };

      if (pagination) {
        responsePayload.pagination = pagination;
      }

      return ApiResponse.success(res, responsePayload, 'Subscription plan history fetched successfully.');
    } catch (error) {
      console.error('Get Subscription History Error:', error);
      return ApiResponse.error(res, 'Failed to fetch subscription plan history.', 500);
    }
  }
}

module.exports = SubscriptionController;
