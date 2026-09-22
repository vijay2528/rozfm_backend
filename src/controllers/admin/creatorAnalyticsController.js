const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrencyINR(amount) {
  const num = Number(amount) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

/**
 * Calculate month-over-month growth percentage.
 * Returns { percentage, is_positive, direction, text }
 */
function calcMoMGrowth(current, previous) {
  const curr = Number(current) || 0;
  const prev = Number(previous) || 0;

  if (prev === 0) {
    if (curr > 0) {
      return { percentage: 100, is_positive: true, direction: 'up', text: '+100% vs last month' };
    }
    return { percentage: 0, is_positive: true, direction: 'neutral', text: '0% vs last month' };
  }

  const diff = curr - prev;
  const pct = parseFloat(((diff / prev) * 100).toFixed(1));
  const isPositive = pct >= 0;
  const sign = isPositive ? '+' : '';

  return {
    percentage: Math.abs(pct),
    is_positive: isPositive,
    direction: isPositive ? 'up' : 'down',
    text: `${sign}${pct}% vs last month`,
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

class CreatorAnalyticsController {
  /**
   * GET /api/v1/admin/creators/analytics
   *
   * Returns:
   *  - active_creators          { count, last_month_count, mom_change }
   *  - avg_earnings_per_creator { amount, formatted }
   *  - new_creators             { count, last_month_count, mom_change }
   *  - earnings_paid_out_chart  [ { month, month_label, amount, formatted_amount, payout_count } ]
   *
   * Query params:
   *  - months  (default 12, max 24) — how many months of chart data to return
   */
  static async getAnalytics(req, res) {
    try {
      const monthsParam = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));

      // ── 1. Active Creators (current vs last month) ────────────────────────
      //    "Active" = role creator/Creator AND is_blocked = 0
      //    Last month baseline = still active today but existed before 1st of this month

      const [[{ active_creators_now }]] = await pool.query(
        `SELECT COUNT(*) AS active_creators_now
         FROM users
         WHERE (role = 'creator' OR role = 'Creator')
           AND is_blocked = 0`
      );

      const [[{ active_creators_last_month }]] = await pool.query(
        `SELECT COUNT(*) AS active_creators_last_month
         FROM users
         WHERE (role = 'creator' OR role = 'Creator')
           AND is_blocked = 0
           AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')`
      );

      const activeMoM = calcMoMGrowth(active_creators_now, active_creators_last_month);

      // ── 2. Average Earnings Per Creator ──────────────────────────────────
      //    avg = total paid withdrawals / total active creators
      //    Falls back to gross writer_earnings if no withdrawals exist

      const [[{ total_paid_earnings }]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total_paid_earnings
         FROM writer_withdrawals
         WHERE status = 'paid'`
      );

      const [[{ total_active_creators }]] = await pool.query(
        `SELECT COUNT(*) AS total_active_creators
         FROM users
         WHERE (role = 'creator' OR role = 'Creator')
           AND is_blocked = 0`
      );

      let avgEarnings = 0;
      const totalPaid = Number(total_paid_earnings || 0);
      const totalActive = Number(total_active_creators || 0);

      if (totalActive > 0 && totalPaid > 0) {
        avgEarnings = Math.round(totalPaid / totalActive);
      } else if (totalActive > 0) {
        // Fallback: gross earnings (accrued but not yet withdrawn)
        const [[{ total_gross_earnings }]] = await pool.query(
          `SELECT COALESCE(SUM(we.amount), 0) AS total_gross_earnings
           FROM writer_earnings we
           INNER JOIN users u ON we.user_id = u.id
           WHERE (u.role = 'creator' OR u.role = 'Creator')
             AND u.is_blocked = 0`
        );
        const totalGross = Number(total_gross_earnings || 0);
        avgEarnings = totalGross > 0 ? Math.round(totalGross / totalActive) : 0;
      }

      // ── 3. New Creators (current 30 days vs previous 30 days) ────────────

      const [[{ new_creators_this_month }]] = await pool.query(
        `SELECT COUNT(*) AS new_creators_this_month
         FROM users
         WHERE (role = 'creator' OR role = 'Creator')
           AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')`
      );

      const [[{ new_creators_last_month }]] = await pool.query(
        `SELECT COUNT(*) AS new_creators_last_month
         FROM users
         WHERE (role = 'creator' OR role = 'Creator')
           AND created_at >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01 00:00:00')
           AND created_at <  DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')`
      );

      const newMoM = calcMoMGrowth(new_creators_this_month, new_creators_last_month);

      // ── 4. Earnings Paid Out — Monthly Chart Data ─────────────────────────
      //    Sum of paid withdrawal amounts grouped by calendar month.
      //    Months with no data are zero-filled below.

      const [chartRows] = await pool.query(
        `SELECT
           DATE_FORMAT(processed_at, '%Y-%m')    AS month,
           DATE_FORMAT(processed_at, '%b %Y')    AS month_label,
           COALESCE(SUM(amount), 0)              AS amount,
           COUNT(*)                              AS payout_count
         FROM writer_withdrawals
         WHERE status = 'paid'
           AND processed_at >= DATE_FORMAT(
               DATE_SUB(NOW(), INTERVAL ? MONTH),
               '%Y-%m-01 00:00:00'
           )
         GROUP BY DATE_FORMAT(processed_at, '%Y-%m')
         ORDER BY month ASC`,
        [monthsParam]
      );

      // Map DB results then zero-fill missing months
      const chartMap = {};
      chartRows.forEach((r) => {
        chartMap[r.month] = {
          amount: Number(r.amount || 0),
          payout_count: Number(r.payout_count || 0),
        };
      });

      const earningsPaidOutChart = [];
      for (let i = monthsParam - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
        const entry = chartMap[monthKey] || { amount: 0, payout_count: 0 };

        earningsPaidOutChart.push({
          month: monthKey,
          month_label: monthLabel,
          amount: entry.amount,
          formatted_amount: formatCurrencyINR(entry.amount),
          payout_count: entry.payout_count,
        });
      }

      // ── Response ──────────────────────────────────────────────────────────

      return ApiResponse.success(
        res,
        {
          active_creators: {
            count: Number(active_creators_now || 0),
            last_month_count: Number(active_creators_last_month || 0),
            mom_change: activeMoM,
          },
          avg_earnings_per_creator: {
            amount: avgEarnings,
            formatted: formatCurrencyINR(avgEarnings),
          },
          new_creators: {
            count: Number(new_creators_this_month || 0),
            last_month_count: Number(new_creators_last_month || 0),
            mom_change: newMoM,
          },
          earnings_paid_out_chart: earningsPaidOutChart,
          chart_config: {
            months_range: monthsParam,
            x_axis_key: 'month_label',
            y_axis_key: 'amount',
          },
        },
        'Creator analytics fetched successfully.'
      );
    } catch (error) {
      console.error('Admin Creator Analytics Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creator analytics.', 500);
    }
  }
}

module.exports = CreatorAnalyticsController;
