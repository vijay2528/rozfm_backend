const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * Format count into human-friendly string (e.g. 412K, 86K, 2.84M, 18,204)
 */
function formatCount(num) {
  const n = Number(num || 0);
  if (isNaN(n) || n === 0) return '0';
  if (n >= 1000000) {
    const val = (n / 1000000).toFixed(2).replace(/\.?0+$/, '');
    return `${val}M`;
  }
  if (n >= 10000) {
    const val = Math.round(n / 1000);
    return `${val}K`;
  }
  if (n >= 1000) {
    const val = (n / 1000).toFixed(1).replace(/\.0$/, '');
    return `${val}K`;
  }
  return n.toLocaleString('en-IN');
}

/**
 * Format currency into INR string (e.g. ₹212, ₹1,499)
 */
function formatCurrencyINR(amount) {
  const num = Math.round(Number(amount || 0));
  return `₹${num.toLocaleString('en-IN')}`;
}

class AdminPremiumAnalyticsController {
  /**
   * GET /api/v1/admin/premium-analytics
   * Screen: Coins & Premium > Premium Analytics
   * Returns:
   *  - 4 KPI cards: Premium Members, Gold Members, Monthly Churn, ARPU
   *  - Subscriber Growth: 12-month trend line curve (Jan - Dec)
   *  - Plan Mix: Donut chart breakdown (Free, Premium, Gold)
   */
  static async getAnalytics(req, res) {
    try {
      const currentYear = new Date().getFullYear();

      // ── 1. Total User Counts ───────────────────────────────────────────────
      const [[userStats]] = await pool.query(
        `SELECT 
           COUNT(*) AS total_users,
           SUM(CASE WHEN LOWER(subscription_type) IN ('gold') THEN 1 ELSE 0 END) AS gold_users,
           SUM(CASE WHEN LOWER(subscription_type) IN ('vip', 'premium') THEN 1 ELSE 0 END) AS premium_users,
           SUM(CASE WHEN subscription_type IS NULL OR LOWER(subscription_type) IN ('free', 'none', '') THEN 1 ELSE 0 END) AS free_users
         FROM users`
      );

      const totalUsers = Number(userStats.total_users || 0);
      let rawPremiumUsers = Number(userStats.premium_users || 0);
      let rawGoldUsers = Number(userStats.gold_users || 0);

      // ── 2. Active Subscription Counts ──────────────────────────────────────
      const [subRows] = await pool.query(
        `SELECT s.status, p.name AS plan_name, COUNT(*) AS count
         FROM subscriptions s
         LEFT JOIN purchase_plans p ON s.plan_id = p.id
         WHERE s.status = 'active'
         GROUP BY s.status, p.name`
      );

      let activeSubPremium = 0;
      let activeSubGold = 0;
      subRows.forEach((r) => {
        const pName = String(r.plan_name || '').toLowerCase();
        if (pName.includes('gold')) {
          activeSubGold += Number(r.count || 0);
        } else {
          activeSubPremium += Number(r.count || 0);
        }
      });

      const finalPremiumCount = activeSubPremium > 0 ? activeSubPremium : (rawPremiumUsers > 0 ? rawPremiumUsers : 0);
      const finalGoldCount = activeSubGold > 0 ? activeSubGold : (rawGoldUsers > 0 ? rawGoldUsers : 0);

      // ── 3. Churn Rate Calculation ──────────────────────────────────────────
      const [[churnRow]] = await pool.query(
        `SELECT 
           COUNT(*) AS expired_this_month,
           SUM(CASE WHEN s.created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY) AND s.created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS prev_expired
         FROM subscriptions s
         WHERE s.status IN ('expired', 'cancelled')
           AND s.updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
      );

      const expiredThisMonth = Number(churnRow.expired_this_month || 0);
      const totalActiveBaseline = finalPremiumCount + finalGoldCount;
      let monthlyChurn = (expiredThisMonth > 0 && totalActiveBaseline > 0)
        ? parseFloat(((expiredThisMonth / totalActiveBaseline) * 100).toFixed(1))
        : 0;
      let churnChange = '+0%';

      // ── 4. ARPU (Average Revenue Per User) ──────────────────────────────────
      const [[revRow]] = await pool.query(
        `SELECT 
           COALESCE(SUM(amount), 0) AS sub_rev_30d,
           COUNT(DISTINCT user_id) AS paying_users
         FROM coin_transactions
         WHERE (plan_id IS NOT NULL OR LOWER(type) LIKE '%plan%' OR LOWER(type) LIKE '%sub%')
           AND LOWER(payment_status) IN ('paid', 'success', 'completed')
           AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
      );

      const subRev30d = Number(revRow.sub_rev_30d || 0);
      const payingUsers = Number(revRow.paying_users || 0);
      const arpuAmount = payingUsers > 0 ? Math.round(subRev30d / payingUsers) : 0;
      const arpuChange = '+0%';

      // ── 5. Plan Mix Percentages (Free vs Premium vs Gold) ───────────────────
      const combinedPaying = finalPremiumCount + finalGoldCount;
      const computedFree = Math.max(0, totalUsers - combinedPaying);
      const totalMixUsers = totalUsers > 0 ? totalUsers : (computedFree + combinedPaying);

      let freePct = 0;
      let goldPct = 0;
      let premiumPct = 0;

      if (totalMixUsers > 0) {
        freePct = Math.round((computedFree / totalMixUsers) * 100);
        goldPct = Math.round((finalGoldCount / totalMixUsers) * 100);
        premiumPct = Math.max(0, 100 - freePct - goldPct);
      }

      const planMix = {
        free: {
          label: 'Free',
          percentage: freePct,
          count: computedFree,
          color: '#4B5563',
        },
        premium: {
          label: 'Premium',
          percentage: premiumPct,
          count: finalPremiumCount,
          color: '#3B82F6',
        },
        gold: {
          label: 'Gold',
          percentage: goldPct,
          count: finalGoldCount,
          color: '#F59E0B',
        },
        total_percentage: totalMixUsers > 0 ? 100 : 0,
        center_value: totalMixUsers > 0 ? 100 : 0,
      };

      // ── 6. Subscriber Growth (12 Months Trend Curve) ────────────────────────
      const [growthRows] = await pool.query(
        `SELECT 
           MONTH(created_at) AS m,
           YEAR(created_at) AS y,
           COUNT(*) AS count
         FROM subscriptions
         WHERE created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-01-01 00:00:00'), INTERVAL 0 YEAR)
         GROUP BY YEAR(created_at), MONTH(created_at)
         ORDER BY y ASC, m ASC`
      );

      const monthlyMap = {};
      growthRows.forEach((r) => {
        monthlyMap[r.m] = Number(r.count || 0);
      });

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      const subscriberGrowth = monthNames.map((name, idx) => {
        const monthNum = idx + 1;
        const dbCount = monthlyMap[monthNum];
        const count = dbCount !== undefined ? dbCount : 0;

        return {
          month: name,
          month_number: monthNum,
          year: currentYear,
          subscribers: count,
          label: `${name} ${currentYear}`,
        };
      });

      // ── 7. Construct Unified Response ──────────────────────────────────────
      return ApiResponse.success(
        res,
        {
          title: 'Premium Analytics',
          subtitle: 'Subscriber growth, tier mix and churn across Premium and Gold.',
          kpis: {
            premium_members: {
              label: 'Premium Members',
              count: finalPremiumCount,
              value: formatCount(finalPremiumCount),
              icon: 'credit_card',
            },
            gold_members: {
              label: 'Gold Members',
              count: finalGoldCount,
              value: formatCount(finalGoldCount),
              icon: 'gold_card',
            },
            monthly_churn: {
              label: 'Monthly Churn',
              rate: monthlyChurn,
              value: `${monthlyChurn}%`,
              change: churnChange,
              is_positive: false,
              icon: 'trending_down',
            },
            arpu: {
              label: 'ARPU',
              amount: arpuAmount,
              value: formatCurrencyINR(arpuAmount),
              change: arpuChange,
              is_positive: true,
              icon: 'dollar',
            },
          },
          subscriber_growth: {
            title: 'Subscriber growth',
            total_active_subscribers: finalPremiumCount + finalGoldCount,
            points: subscriberGrowth,
          },
          plan_mix: {
            title: 'Plan mix',
            center_label: 'Total',
            center_value: 100,
            breakdown: planMix,
            slices: [
              { label: 'Free', percentage: freePct, color: '#4B5563' },
              { label: 'Premium', percentage: premiumPct, color: '#3B82F6' },
              { label: 'Gold', percentage: goldPct, color: '#F59E0B' },
            ],
          },
        },
        'Premium analytics retrieved successfully.'
      );
    } catch (error) {
      console.error('Admin Premium Analytics Error:', error);
      return ApiResponse.error(res, 'Failed to fetch premium analytics.', 500);
    }
  }
}

module.exports = AdminPremiumAnalyticsController;

