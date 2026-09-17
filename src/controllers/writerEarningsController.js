const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

function formatCurrencyINR(amount) {
  const val = Number(amount) || 0;
  return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyINRNoDecimals(amount) {
  const val = Number(amount) || 0;
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function calculateGrowth(current, previous) {
  const curr = Number(current) || 0;
  const prev = Number(previous) || 0;

  if (prev === 0) {
    if (curr > 0) return { percentage: 100, is_positive: true, text: '+100% vs last month' };
    return { percentage: 0, is_positive: true, text: '+0% vs last month' };
  }

  const diff = curr - prev;
  const pct = parseFloat(((diff / prev) * 100).toFixed(1));
  const isPositive = pct >= 0;
  const sign = isPositive ? '+' : '';
  return {
    percentage: Math.abs(pct),
    is_positive: isPositive,
    text: `${sign}${pct}% vs last month`,
  };
}

class WriterEarningsController {
  /**
   * GET /api/v1/writer/earnings or /api/v1/writer/earnings/overview
   * Returns complete earnings overview matching UI:
   * - Total Earnings + % vs last month
   * - This Month, Last Month, This Week, Pending Payout
   * - Earnings Breakdown (Story Revenue, Listener Gifts, Promotions)
   */
  static async getOverview(req, res) {
    try {
      // Authenticated user ID or query parameter fallback for testing
      let userId = req.user ? req.user.id : null;
      if (!userId && req.query && req.query.user_id) {
        userId = Number(req.query.user_id);
      }

      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated user.', 401);
      }

      const userIdNum = Number(userId);

      // 1. Total Earnings
      const [[{ total_earnings }]] = await pool.query(
        'SELECT COALESCE(SUM(amount), 0) as total_earnings FROM writer_earnings WHERE user_id = ?',
        [userIdNum]
      );

      // 2. This Month Earnings
      const [[{ this_month_earnings }]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as this_month_earnings 
         FROM writer_earnings 
         WHERE user_id = ? AND MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`,
        [userIdNum]
      );

      // 3. Last Month Earnings
      const [[{ last_month_earnings }]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as last_month_earnings 
         FROM writer_earnings 
         WHERE user_id = ? 
           AND MONTH(created_at) = MONTH(CURRENT_DATE() - INTERVAL 1 MONTH) 
           AND YEAR(created_at) = YEAR(CURRENT_DATE() - INTERVAL 1 MONTH)`,
        [userIdNum]
      );

      // 4. This Week Earnings
      const [[{ this_week_earnings }]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as this_week_earnings 
         FROM writer_earnings 
         WHERE user_id = ? AND YEARWEEK(created_at, 1) = YEARWEEK(CURRENT_DATE(), 1)`,
        [userIdNum]
      );

      // 5. Pending Payout (from writer_withdrawals where status = 'pending')
      const [[{ pending_payout }]] = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) as pending_payout FROM writer_withdrawals WHERE user_id = ? AND status = 'pending'",
        [userIdNum]
      );

      let totalAmt = Number(total_earnings || 0);
      let thisMonthAmt = Number(this_month_earnings || 0);
      let lastMonthAmt = Number(last_month_earnings || 0);
      let thisWeekAmt = Number(this_week_earnings || 0);
      let pendingPayoutAmt = Number(pending_payout || 0);

      // 6. Breakdown by Source Type (Story Revenue, Listener Gifts, Promotions)
      const [breakdownRows] = await pool.query(
        `SELECT source_type, COALESCE(SUM(amount), 0) as amount 
         FROM writer_earnings 
         WHERE user_id = ? 
         GROUP BY source_type`,
        [userIdNum]
      );

      let storyRevenueAmt = 0;
      let listenerGiftsAmt = 0;
      let promotionsAmt = 0;

      breakdownRows.forEach((r) => {
        const type = (r.source_type || '').toLowerCase();
        const amt = Number(r.amount || 0);
        if (type.includes('story') || type.includes('unlock') || type.includes('episode')) {
          storyRevenueAmt += amt;
        } else if (type.includes('gift') || type.includes('listener') || type.includes('tip')) {
          listenerGiftsAmt += amt;
        } else if (type.includes('promo') || type.includes('bonus') || type.includes('event')) {
          promotionsAmt += amt;
        } else {
          storyRevenueAmt += amt; // default to story revenue
        }
      });

      // Fallback calculation if writer_earnings is empty (e.g., brand new creator)
      if (totalAmt === 0) {
        try {
          const [unlockRows] = await pool.query(
            `SELECT ueu.coins_spent, ueu.unlocked_at
             FROM user_episode_unlocks ueu
             JOIN episodes e ON ueu.episode_id = e.id
             JOIN stories s ON e.story_id = s.id
             WHERE s.user_id = ?`,
            [userIdNum]
          );

          if (unlockRows.length > 0) {
            let sharePct = 70.0;
            let coinsPerRupee = 10.0;

            try {
              const [settingRows] = await pool.query(
                "SELECT `key`, `value` FROM settings WHERE `key` IN ('writer_revenue_share_percentage', 'coins_per_rupee')"
              );
              settingRows.forEach((s) => {
                if (s.key === 'writer_revenue_share_percentage' && s.value) {
                  const val = parseFloat(s.value);
                  if (!isNaN(val) && val >= 0) sharePct = val;
                }
                if (s.key === 'coins_per_rupee' && s.value) {
                  const val = parseFloat(s.value);
                  if (!isNaN(val) && val > 0) coinsPerRupee = val;
                }
              });
            } catch (_) {}

            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();
            const lastMonthObj = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lmMonth = lastMonthObj.getMonth();
            const lmYear = lastMonthObj.getFullYear();

            unlockRows.forEach((r) => {
              const coins = Number(r.coins_spent || 0);
              const writerCoins = (coins * sharePct) / 100;
              const inr = writerCoins / coinsPerRupee;

              totalAmt += inr;
              storyRevenueAmt += inr;

              const uObj = new Date(r.unlocked_at || Date.now());
              if (uObj.getMonth() === currentMonth && uObj.getFullYear() === currentYear) {
                thisMonthAmt += inr;
              }
              if (uObj.getMonth() === lmMonth && uObj.getFullYear() === lmYear) {
                lastMonthAmt += inr;
              }
            });
          }
        } catch (_) {}
      }

      // Calculate MoM growth vs last month
      const growth = calculateGrowth(thisMonthAmt, lastMonthAmt);

      const totalBreakdownAmt = storyRevenueAmt + listenerGiftsAmt + promotionsAmt;
      const calcPct = (amt) => (totalBreakdownAmt > 0 ? parseFloat(((amt / totalBreakdownAmt) * 100).toFixed(1)) : 0);

      const responsePayload = {
        total_earnings: parseFloat(totalAmt.toFixed(2)),
        formatted_total_earnings: formatCurrencyINR(totalAmt),
        all_time_earnings: parseFloat(totalAmt.toFixed(2)),
        formatted_all_time_earnings: formatCurrencyINR(totalAmt),
        vs_last_month: growth.text,
        vs_last_month_percentage: growth.percentage,
        is_positive: growth.is_positive,
        this_month: {
          amount: parseFloat(thisMonthAmt.toFixed(2)),
          formatted: formatCurrencyINR(thisMonthAmt),
        },
        last_month: {
          amount: parseFloat(lastMonthAmt.toFixed(2)),
          formatted: formatCurrencyINR(lastMonthAmt),
        },
        this_week: {
          amount: parseFloat(thisWeekAmt.toFixed(2)),
          formatted: formatCurrencyINR(thisWeekAmt),
        },
        pending_payout: {
          amount: parseFloat(pendingPayoutAmt.toFixed(2)),
          formatted: formatCurrencyINR(pendingPayoutAmt),
        },
        earnings_breakdown: {
          total: parseFloat(totalBreakdownAmt.toFixed(2)),
          formatted_total: formatCurrencyINRNoDecimals(totalBreakdownAmt),
          story_revenue: {
            label: 'Story Revenue',
            amount: parseFloat(storyRevenueAmt.toFixed(2)),
            formatted: formatCurrencyINRNoDecimals(storyRevenueAmt),
            percentage: calcPct(storyRevenueAmt),
          },
          listener_gifts: {
            label: 'Listener Gifts',
            amount: parseFloat(listenerGiftsAmt.toFixed(2)),
            formatted: formatCurrencyINRNoDecimals(listenerGiftsAmt),
            percentage: calcPct(listenerGiftsAmt),
          },
          promotions: {
            label: 'Promotions',
            amount: parseFloat(promotionsAmt.toFixed(2)),
            formatted: formatCurrencyINRNoDecimals(promotionsAmt),
            percentage: calcPct(promotionsAmt),
          },
          breakdown_items: [
            {
              key: 'story_revenue',
              label: 'Story Revenue',
              amount: parseFloat(storyRevenueAmt.toFixed(2)),
              formatted: formatCurrencyINRNoDecimals(storyRevenueAmt),
              percentage: calcPct(storyRevenueAmt),
            },
            {
              key: 'listener_gifts',
              label: 'Listener Gifts',
              amount: parseFloat(listenerGiftsAmt.toFixed(2)),
              formatted: formatCurrencyINRNoDecimals(listenerGiftsAmt),
              percentage: calcPct(listenerGiftsAmt),
            },
            {
              key: 'promotions',
              label: 'Promotions',
              amount: parseFloat(promotionsAmt.toFixed(2)),
              formatted: formatCurrencyINRNoDecimals(promotionsAmt),
              percentage: calcPct(promotionsAmt),
            },
          ],
        },
      };

      return ApiResponse.success(res, responsePayload, 'Writer earnings overview fetched successfully.');
    } catch (error) {
      console.error('Writer Earnings Overview Error:', error);
      return ApiResponse.error(res, 'Failed to fetch writer earnings overview.', 500);
    }
  }

  /**
   * GET /api/v1/writer/earnings/transactions
   * Lists earning transaction history for the writer
   */
  static async getTransactions(req, res) {
    try {
      let userId = req.user ? req.user.id : null;
      if (!userId && req.query && req.query.user_id) {
        userId = Number(req.query.user_id);
      }

      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated user.', 401);
      }

      const userIdNum = Number(userId);

      const [rows] = await pool.query(
        `SELECT id, user_id, story_id, episode_id, amount, coins, source_type, description, created_at
         FROM writer_earnings
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [userIdNum]
      );

      const transactions = rows.map((t) => {
        const amt = Number(t.amount || 0);
        return {
          id: t.id,
          amount: amt,
          formatted_amount: formatCurrencyINR(amt),
          coins: Number(t.coins || 0),
          source_type: t.source_type || 'story_revenue',
          description: t.description || 'Earnings payout',
          created_at: t.created_at,
        };
      });

      return ApiResponse.success(res, { transactions, data: transactions }, 'Writer earnings transactions fetched successfully.');
    } catch (error) {
      console.error('Writer Earnings Transactions Error:', error);
      return ApiResponse.error(res, 'Failed to fetch earnings transactions.', 500);
    }
  }
}

module.exports = WriterEarningsController;
