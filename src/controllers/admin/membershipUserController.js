const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');
const SubscriptionService = require('../../services/subscriptionService');

class MembershipUserController {
  /**
   * GET /api/v1/admin/membership-users
   * Lists all users with a membership plan or active/past subscription record
   */
  static async index(req, res) {
    try {
      const { search, status, plan_id, page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const offset = (pageNum - 1) * limitNum;

      // Auto-update expired subscriptions
      try {
        await pool.query(
          "UPDATE subscriptions SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < NOW()"
        );
      } catch (_) {}

      // Build WHERE clauses
      let whereClauses = [
        "(s.id IS NOT NULL OR (LOWER(COALESCE(u.subscription_type, 'free')) NOT IN ('free', 'listener', 'creator', 'admin', 'writer', '')))"
      ];
      let queryParams = [];

      if (search && String(search).trim()) {
        const s = `%${String(search).trim()}%`;
        whereClauses.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR p.name LIKE ? OR u.subscription_type LIKE ?)');
        queryParams.push(s, s, s, s, s);
      }

      if (status && status.toLowerCase() !== 'all') {
        const st = status.toLowerCase();
        if (st === 'active') {
          whereClauses.push("(COALESCE(s.status, 'active') = 'active' AND (s.expires_at IS NULL OR s.expires_at >= NOW()))");
        } else if (st === 'expired') {
          whereClauses.push("(s.status = 'expired' OR (s.expires_at IS NOT NULL AND s.expires_at < NOW()))");
        } else if (st === 'cancelled' || st === 'canceled') {
          whereClauses.push("s.status = 'cancelled'");
        } else if (st === 'trial') {
          whereClauses.push("(s.status = 'trial' OR s.billing_cycle = 'trial')");
        } else {
          whereClauses.push("LOWER(COALESCE(s.status, 'active')) = ?");
          queryParams.push(st);
        }
      }

      if (plan_id && plan_id !== 'All' && plan_id !== 'all') {
        const pNum = parseInt(plan_id, 10);
        if (!isNaN(pNum)) {
          whereClauses.push('(s.plan_id = ? OR p.id = ?)');
          queryParams.push(pNum, pNum);
        } else {
          whereClauses.push('(LOWER(p.name) LIKE ? OR LOWER(u.subscription_type) LIKE ?)');
          queryParams.push(`%${plan_id.toLowerCase()}%`, `%${plan_id.toLowerCase()}%`);
        }
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      // Count total
      const countSql = `
        SELECT COUNT(DISTINCT u.id) as count
        FROM users u
        LEFT JOIN (
          SELECT s1.*
          FROM subscriptions s1
          INNER JOIN (
            SELECT user_id, MAX(id) as max_id
            FROM subscriptions
            GROUP BY user_id
          ) s2 ON s1.id = s2.max_id
        ) s ON u.id = s.user_id
        LEFT JOIN purchase_plans p ON s.plan_id = p.id
        ${whereSql}
      `;
      const [[{ count }]] = await pool.query(countSql, queryParams);

      // Data query
      const dataSql = `
        SELECT 
          u.id AS user_id,
          u.name AS user_name,
          u.email AS user_email,
          u.phone AS user_phone,
          u.avatar_path,
          u.subscription_type AS user_subscription_type,
          u.wallet_balance,
          u.is_blocked,
          u.created_at AS user_joined_at,
          s.id AS subscription_id,
          s.plan_id,
          s.starts_at,
          s.expires_at,
          s.billing_cycle,
          s.razorpay_subscription_id,
          s.created_at AS subscribed_at,
          COALESCE(s.status, 'active') AS subscription_status,
          COALESCE(p.name, u.subscription_type, 'Premium') AS plan_name,
          COALESCE(p.price, 0) AS plan_price,
          p.monthly_amount,
          p.yearly_amount
        FROM users u
        LEFT JOIN (
          SELECT s1.*
          FROM subscriptions s1
          INNER JOIN (
            SELECT user_id, MAX(id) as max_id
            FROM subscriptions
            GROUP BY user_id
          ) s2 ON s1.id = s2.max_id
        ) s ON u.id = s.user_id
        LEFT JOIN purchase_plans p ON s.plan_id = p.id
        ${whereSql}
        ORDER BY COALESCE(s.created_at, u.created_at) DESC
        LIMIT ? OFFSET ?
      `;

      const [rows] = await pool.query(dataSql, [...queryParams, limitNum, offset]);

      // Calculate stats
      let totalSubs = Number(count || 0);
      let activeSubs = 0;
      let expiredSubs = 0;
      let trialSubs = 0;
      let expiringSoon = 0;

      try {
        const [[statsRow]] = await pool.query(`
          SELECT 
            COUNT(DISTINCT u.id) AS total_subscribers,
            COUNT(DISTINCT CASE WHEN (s.id IS NOT NULL AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at >= NOW())) OR (s.id IS NULL AND LOWER(COALESCE(u.subscription_type, 'free')) NOT IN ('free', 'listener', 'creator', 'admin', 'writer', '')) THEN u.id END) AS active_subscribers,
            COUNT(DISTINCT CASE WHEN s.status = 'expired' OR (s.expires_at IS NOT NULL AND s.expires_at < NOW()) THEN u.id END) AS expired_subscribers,
            COUNT(DISTINCT CASE WHEN s.status = 'trial' OR s.billing_cycle = 'trial' THEN u.id END) AS trial_subscribers,
            COUNT(DISTINCT CASE WHEN s.expires_at IS NOT NULL AND s.expires_at >= NOW() AND s.expires_at <= DATE_ADD(NOW(), INTERVAL 7 DAY) THEN u.id END) AS expiring_soon
          FROM users u
          LEFT JOIN (
            SELECT s1.*
            FROM subscriptions s1
            INNER JOIN (
              SELECT user_id, MAX(id) as max_id
              FROM subscriptions
              GROUP BY user_id
            ) s2 ON s1.id = s2.max_id
          ) s ON u.id = s.user_id
          WHERE (s.id IS NOT NULL OR (LOWER(COALESCE(u.subscription_type, 'free')) NOT IN ('free', 'listener', 'creator', 'admin', 'writer', '')))
        `);

        if (statsRow) {
          totalSubs = Number(statsRow.total_subscribers || count || 0);
          activeSubs = Number(statsRow.active_subscribers || 0);
          expiredSubs = Number(statsRow.expired_subscribers || 0);
          trialSubs = Number(statsRow.trial_subscribers || 0);
          expiringSoon = Number(statsRow.expiring_soon || 0);
        }
      } catch (_) {}

      const formatted = rows.map((r) => {
        const expiresAtDate = r.expires_at ? new Date(r.expires_at) : null;
        const now = new Date();
        const daysLeft = expiresAtDate ? Math.max(0, Math.ceil((expiresAtDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : null;

        let displayStatus = r.subscription_status || 'active';
        if (expiresAtDate && expiresAtDate < now && displayStatus === 'active') {
          displayStatus = 'expired';
        }

        const planPrice = Number(r.plan_price || r.monthly_amount || 0);

        const rawCycle = r.billing_cycle;
        const safeCycle = (!rawCycle || String(rawCycle).toLowerCase() === 'null') ? 'monthly' : rawCycle;

        return {
          id: r.subscription_id || `SUB-${r.user_id}`,
          subscription_id: r.subscription_id || null,
          user_id: r.user_id,
          user_name: r.user_name || 'Anonymous User',
          user_email: r.user_email || '',
          user_phone: r.user_phone || '',
          avatar_path: r.avatar_path || null,
          wallet_balance: Number(r.wallet_balance || 0),
          is_blocked: Boolean(r.is_blocked),
          user_joined_at: r.user_joined_at,
          plan_id: r.plan_id || null,
          plan_name: r.plan_name || 'Premium',
          price: planPrice,
          monthly_amount: r.monthly_amount ? Number(r.monthly_amount) : null,
          yearly_amount: r.yearly_amount ? Number(r.yearly_amount) : null,
          billing_cycle: safeCycle,
          subscription_status: displayStatus,
          status: displayStatus,
          starts_at: r.starts_at || r.subscribed_at || r.user_joined_at,
          expires_at: r.expires_at,
          renews_on: r.expires_at,
          days_left: daysLeft,
          days_remaining: daysLeft,
          razorpay_subscription_id: r.razorpay_subscription_id || null,
          subscribed_at: r.subscribed_at || r.user_joined_at,
          created_at: r.subscribed_at || r.user_joined_at,
          user: {
            id: r.user_id,
            name: r.user_name || 'Anonymous User',
            email: r.user_email || '',
            phone: r.user_phone || '',
            avatar: r.avatar_path || null,
            coins: Number(r.wallet_balance || 0),
            is_blocked: Boolean(r.is_blocked),
            joined_at: r.user_joined_at,
          },
          plan: {
            id: r.plan_id || null,
            name: r.plan_name || 'Premium',
            price: planPrice,
            billing_cycle: safeCycle,
          },
        };
      });

      return ApiResponse.success(res, {
        membership_users: formatted,
        subscriptions: formatted,
        data: formatted,
        stats: {
          total: totalSubs,
          active: activeSubs,
          expired: expiredSubs,
          trial: trialSubs,
          expiring_soon: expiringSoon,
        },
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      }, 'Membership users fetched successfully.');
    } catch (error) {
      console.error('Admin List Membership Users Error:', error);
      return ApiResponse.error(res, 'Failed to fetch membership users.', 500);
    }
  }

  /**
   * POST /api/v1/admin/membership-users
   * Assign or Grant a membership plan to a user
   */
  static async grant(req, res) {
    try {
      const { user_id, plan_id, duration_days, notes } = req.body;
      if (!user_id) {
        return ApiResponse.error(res, 'User ID is required.', 422);
      }
      if (!plan_id) {
        return ApiResponse.error(res, 'Plan ID is required.', 422);
      }

      const result = await SubscriptionService.assignPlan({
        userId: user_id,
        planId: plan_id,
        durationDays: duration_days,
        assignedBy: 'admin',
        isManual: true,
        notes: notes || 'Manually assigned by Admin',
      });

      return ApiResponse.success(
        res,
        result,
        `Membership "${result.plan_name}" successfully granted to ${result.user_name || 'user'}.`
      );
    } catch (error) {
      console.error('Admin Grant Membership Error:', error);
      return ApiResponse.error(res, error.message || 'Failed to grant membership.', 500);
    }
  }

  /**
   * POST /api/v1/admin/membership-users/:id/cancel
   * Cancel an active user subscription
   */
  static async cancel(req, res) {
    try {
      const subId = req.params.id;
      const [rows] = await pool.query('SELECT * FROM subscriptions WHERE id = ? LIMIT 1', [subId]);
      if (rows.length === 0) {
        // If not found by subscription ID, check if subId is user_id
        const [userSubs] = await pool.query(
          "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
          [subId]
        );
        if (userSubs.length > 0) {
          await pool.query("UPDATE subscriptions SET status = 'cancelled' WHERE id = ?", [userSubs[0].id]);
          await pool.query("UPDATE users SET subscription_type = 'free' WHERE id = ?", [subId]);
          return ApiResponse.success(res, { subscription_id: userSubs[0].id, status: 'cancelled' }, 'Subscription cancelled successfully.');
        }
        return ApiResponse.error(res, 'Subscription not found.', 404);
      }

      await pool.query("UPDATE subscriptions SET status = 'cancelled' WHERE id = ?", [subId]);
      if (rows[0].user_id) {
        await pool.query("UPDATE users SET subscription_type = 'free' WHERE id = ?", [rows[0].user_id]);
      }

      return ApiResponse.success(res, { subscription_id: Number(subId), status: 'cancelled' }, 'Subscription cancelled successfully.');
    } catch (error) {
      console.error('Admin Cancel Membership Error:', error);
      return ApiResponse.error(res, 'Failed to cancel membership.', 500);
    }
  }
}

module.exports = MembershipUserController;
