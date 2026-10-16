const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

/**
 * CoinHistoryController
 * Provides a detailed, paginated coin transaction history for the authenticated user.
 * Source table: coin_transactions
 *
 * GET /api/v1/coins/history
 * Query params:
 *   - page        (default: 1)
 *   - limit       (default: 20, max: 100)
 *   - type        filter by transaction type: 'credit' | 'debit' | 'earn' | 'spend' | 'purchase'
 *   - from_date   (YYYY-MM-DD)
 *   - to_date     (YYYY-MM-DD)
 */
class CoinHistoryController {
  static async index(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, type, from_date, to_date } = req.query;

      const pageNum  = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset   = (pageNum - 1) * limitNum;

      // ── Classify helpers ────────────────────────────────────────────────────
      const debitTypes    = ['spend', 'debit', 'unlock', 'withdrawal', 'spent', 'admin_debit'];
      const purchaseTypes = ['coin_pack', 'plan_purchase', 'coin', 'purchase', 'coin_purchase', 'buy', 'pack'];

      // ── Build WHERE clauses ─────────────────────────────────────────────────
      let whereClauses = ['ct.user_id = ?'];
      let queryParams  = [userId];

      // Date range filter
      if (from_date) {
        whereClauses.push('DATE(ct.created_at) >= ?');
        queryParams.push(from_date);
      }
      if (to_date) {
        whereClauses.push('DATE(ct.created_at) <= ?');
        queryParams.push(to_date);
      }

      // Type filter: map incoming simple values to DB column semantics
      if (type) {
        const t = String(type).toLowerCase().trim();
        if (t === 'credit' || t === 'earn') {
          // non-debit & not a real-money purchase
          whereClauses.push(
            "(LOWER(COALESCE(ct.transaction_type,'')) = 'credit' OR (ct.transaction_type IS NULL AND LOWER(COALESCE(ct.type,'')) NOT IN ('spend','debit','unlock','withdrawal','spent','admin_debit')))"
          );
        } else if (t === 'debit' || t === 'spend') {
          whereClauses.push(
            "(LOWER(COALESCE(ct.transaction_type,'')) = 'debit' OR LOWER(COALESCE(ct.type,'')) IN ('spend','debit','unlock','withdrawal','spent','admin_debit'))"
          );
        } else if (t === 'purchase') {
          whereClauses.push(
            "(LOWER(COALESCE(ct.type,'')) IN ('coin_pack','plan_purchase','coin','purchase','coin_purchase','buy','pack') OR ct.coin_pack_id IS NOT NULL OR ct.plan_id IS NOT NULL)"
          );
        } else {
          // Exact type match
          whereClauses.push('LOWER(ct.type) = ?');
          queryParams.push(t);
        }
      }

      const whereSQL = `WHERE ${whereClauses.join(' AND ')}`;

      // ── Total count ─────────────────────────────────────────────────────────
      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) as total FROM coin_transactions ct ${whereSQL}`,
        queryParams
      );

      // ── Fetch page ──────────────────────────────────────────────────────────
      const [rows] = await pool.query(
        `SELECT ct.*
         FROM coin_transactions ct
         ${whereSQL}
         ORDER BY ct.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      // ── Enrich with episode / story titles where reference_id applies ───────
      const episodeRefIds = rows
        .filter((tx) => tx.reference_id && ['spend', 'debit', 'unlock'].includes(String(tx.type || '').toLowerCase()))
        .map((tx) => tx.reference_id);

      let episodeMap = {};
      if (episodeRefIds.length > 0) {
        const [epRows] = await pool.query(
          `SELECT e.id, e.title AS episode_title, e.position, s.title AS story_title
           FROM episodes e
           LEFT JOIN stories s ON s.id = e.story_id
           WHERE e.id IN (?)`,
          [episodeRefIds]
        );
        epRows.forEach((ep) => {
          episodeMap[String(ep.id)] = ep;
        });
      }

      // ── Aggregate totals ────────────────────────────────────────────────────
      const [aggRows] = await pool.query(
        `SELECT ct.type, ct.transaction_type, ct.coins, ct.amount, ct.plan_id, ct.coin_pack_id, ct.payment_status
         FROM coin_transactions ct
         WHERE ct.user_id = ?`,
        [userId]
      );

      let totalEarned    = 0;
      let totalPurchased = 0;
      let totalSpent     = 0;

      aggRows.forEach((tx) => {
        const payStatus = String(tx.payment_status || 'paid').toLowerCase();
        if (payStatus === 'failed' || payStatus === 'faild') return;

        const coinVal = Math.abs(Number(tx.coins || 0));
        const typeStr = String(tx.type || '').toLowerCase();
        const txType  = String(tx.transaction_type || '').toLowerCase();

        const isDebit = txType === 'debit' || debitTypes.includes(typeStr) || Number(tx.coins || 0) < 0;

        if (isDebit) {
          totalSpent += coinVal;
        } else {
          const isPurchase =
            purchaseTypes.includes(typeStr) ||
            typeStr.includes('purchase') ||
            typeStr.includes('coin_pack') ||
            Number(tx.plan_id) > 0 ||
            Number(tx.coin_pack_id) > 0 ||
            Number(tx.amount || 0) > 0;

          isPurchase ? (totalPurchased += coinVal) : (totalEarned += coinVal);
        }
      });

      // ── Current wallet balance ──────────────────────────────────────────────
      const [[userRow]] = await pool.query(
        'SELECT wallet_balance FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
      const walletBalance = Number(userRow?.wallet_balance || 0);

      // ── Format response rows ────────────────────────────────────────────────
      const transactions = rows.map((tx) => {
        const typeStr  = String(tx.type || '').toLowerCase();
        const txType   = String(tx.transaction_type || '').toLowerCase();
        const coinVal  = Math.abs(Number(tx.coins || 0));
        const isFailed = String(tx.payment_status || '').toLowerCase() === 'failed';

        const isDebit = txType === 'debit' || debitTypes.includes(typeStr) || Number(tx.coins || 0) < 0;
        const isPurchase =
          purchaseTypes.includes(typeStr) ||
          typeStr.includes('purchase') ||
          typeStr.includes('coin_pack') ||
          Number(tx.plan_id) > 0 ||
          Number(tx.coin_pack_id) > 0 ||
          Number(tx.amount || 0) > 0;

        // Resolve category label
        let category = 'earned';
        if (isDebit)      category = 'spent';
        else if (isPurchase) category = 'purchased';

        // Resolve human-readable label
        const typeLabels = {
          daily_reward:   'Daily Reward',
          streak_reward:  'Streak Reward',
          ad_reward:      'Ad Reward',
          referral:       'Referral Bonus',
          milestone:      'Milestone Reward',
          plan_purchase:  'Plan Purchase',
          coin_pack:      'Coin Pack Purchase',
          coin_purchase:  'Coin Purchase',
          purchase:       'Purchase',
          spend:          'Episode Unlock',
          debit:          'Debit',
          unlock:         'Episode Unlock',
          withdrawal:     'Withdrawal',
          admin_credit:   'Admin Credit',
          admin_debit:    'Admin Debit',
        };
        const label = typeLabels[typeStr] || String(tx.type || 'Transaction');

        // Attach episode/story info if available
        let episodeInfo = null;
        if (tx.reference_id && episodeMap[String(tx.reference_id)]) {
          const ep = episodeMap[String(tx.reference_id)];
          episodeInfo = {
            episode_id:    Number(ep.id),
            episode_title: ep.episode_title,
            episode_no:    ep.position,
            story_title:   ep.story_title,
          };
        }

        return {
          id:               Number(tx.id),
          type:             tx.type,
          category,                          // 'earned' | 'purchased' | 'spent'
          label,                             // human-readable type label
          coins:            coinVal,
          coins_signed:     isDebit ? -coinVal : coinVal,
          amount:           Number(tx.amount || 0),
          transaction_type: tx.transaction_type || (isDebit ? 'debit' : 'credit'),
          payment_status:   tx.payment_status || 'paid',
          is_failed:        isFailed,
          description:      tx.description || null,
          plan_id:          tx.plan_id   ? Number(tx.plan_id)   : null,
          coin_pack_id:     tx.coin_pack_id ? Number(tx.coin_pack_id) : null,
          reference_id:     tx.reference_id || null,
          episode:          episodeInfo,
          created_at:       tx.created_at,
          updated_at:       tx.updated_at || null,
        };
      });

      return ApiResponse.success(res, {
        wallet_balance:      walletBalance,
        total_earned_coins:  totalEarned,
        total_purchased_coins: totalPurchased,
        total_spent_coins:   totalSpent,
        transactions,
        total:               Number(total),
        total_number:        Number(total),
        page:                pageNum,
        limit:               limitNum,
        total_pages:         Math.ceil(Number(total) / limitNum),
        pagination: {
          total:       Number(total),
          page:        pageNum,
          limit:       limitNum,
          total_pages: Math.ceil(Number(total) / limitNum),
        },
      }, 'Coin history fetched successfully.');
    } catch (error) {
      console.error('Coin History Error:', error);
      return ApiResponse.error(res, 'Failed to fetch coin history.', 500);
    }
  }

  /**
   * GET /api/v1/coins/history/:id
   * Return details of a single coin transaction by its primary ID.
   * Only the owner of the transaction can access it.
   */
  static async show(req, res) {
    try {
      const userId = req.user.id;
      const txId   = req.params.id;

      const [rows] = await pool.query(
        'SELECT * FROM coin_transactions WHERE id = ? LIMIT 1',
        [txId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Transaction not found.', 404);
      }

      const tx = rows[0];

      // Ensure the transaction belongs to the requesting user
      if (Number(tx.user_id) !== Number(userId)) {
        return ApiResponse.error(res, 'You are not authorized to view this transaction.', 403);
      }

      const debitTypes    = ['spend', 'debit', 'unlock', 'withdrawal', 'spent', 'admin_debit'];
      const purchaseTypes = ['coin_pack', 'plan_purchase', 'coin', 'purchase', 'coin_purchase', 'buy', 'pack'];

      const typeStr  = String(tx.type || '').toLowerCase();
      const txType   = String(tx.transaction_type || '').toLowerCase();
      const coinVal  = Math.abs(Number(tx.coins || 0));
      const isFailed = String(tx.payment_status || '').toLowerCase() === 'failed';

      const isDebit = txType === 'debit' || debitTypes.includes(typeStr) || Number(tx.coins || 0) < 0;
      const isPurchase =
        purchaseTypes.includes(typeStr) ||
        typeStr.includes('purchase') ||
        typeStr.includes('coin_pack') ||
        Number(tx.plan_id) > 0 ||
        Number(tx.coin_pack_id) > 0 ||
        Number(tx.amount || 0) > 0;

      let category = 'earned';
      if (isDebit)         category = 'spent';
      else if (isPurchase) category = 'purchased';

      const typeLabels = {
        daily_reward:  'Daily Reward',
        streak_reward: 'Streak Reward',
        ad_reward:     'Ad Reward',
        referral:      'Referral Bonus',
        milestone:     'Milestone Reward',
        plan_purchase: 'Plan Purchase',
        coin_pack:     'Coin Pack Purchase',
        coin_purchase: 'Coin Purchase',
        purchase:      'Purchase',
        spend:         'Episode Unlock',
        debit:         'Debit',
        unlock:        'Episode Unlock',
        withdrawal:    'Withdrawal',
        admin_credit:  'Admin Credit',
        admin_debit:   'Admin Debit',
      };
      const label = typeLabels[typeStr] || String(tx.type || 'Transaction');

      // Enrich with episode / story info when reference_id points to an episode
      let episodeInfo = null;
      if (tx.reference_id && ['spend', 'debit', 'unlock'].includes(typeStr)) {
        const [epRows] = await pool.query(
          `SELECT e.id, e.title AS episode_title, e.position, s.title AS story_title
           FROM episodes e
           LEFT JOIN stories s ON s.id = e.story_id
           WHERE e.id = ? LIMIT 1`,
          [tx.reference_id]
        );
        if (epRows.length > 0) {
          const ep = epRows[0];
          episodeInfo = {
            episode_id:    Number(ep.id),
            episode_title: ep.episode_title,
            episode_no:    ep.position,
            story_title:   ep.story_title,
          };
        }
      }

      return ApiResponse.success(res, {
        transaction: {
          id:               Number(tx.id),
          type:             tx.type,
          category,
          label,
          coins:            coinVal,
          coins_signed:     isDebit ? -coinVal : coinVal,
          amount:           Number(tx.amount || 0),
          transaction_type: tx.transaction_type || (isDebit ? 'debit' : 'credit'),
          payment_status:   tx.payment_status || 'paid',
          is_failed:        isFailed,
          description:      tx.description || null,
          plan_id:          tx.plan_id      ? Number(tx.plan_id)      : null,
          coin_pack_id:     tx.coin_pack_id ? Number(tx.coin_pack_id) : null,
          reference_id:     tx.reference_id || null,
          episode:          episodeInfo,
          created_at:       tx.created_at,
          updated_at:       tx.updated_at || null,
        },
      }, 'Transaction details fetched successfully.');
    } catch (error) {
      console.error('Coin History Show Error:', error);
      return ApiResponse.error(res, 'Failed to fetch transaction details.', 500);
    }
  }
}

module.exports = CoinHistoryController;
