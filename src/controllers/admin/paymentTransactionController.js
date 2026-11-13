const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

/**
 * AdminPaymentTransactionController
 *
 * Powers the admin "Payment > Transactions" and "Payment > Failed Payments" screens.
 * Source of truth: `coin_transactions` rows written by RazorpayController.verifyPayment
 * (money payments => amount > 0 OR reference_id is a Razorpay payment id).
 */

// Only real money payments (exclude spend/debit/ad-reward/streak rows)
const PAYMENT_BASE_WHERE = `(ct.payment_status IS NOT NULL AND (ct.amount > 0 OR ct.reference_id LIKE 'pay\\_%'))`;

const TYPE_LABELS = {
  coin_pack: 'Coin Pack',
  coin: 'Coin Pack',
  plan_purchase: 'Premium Sub',
  subscription: 'Premium Sub',
  membership: 'Gold Membership',
};

const STATUS_MAP = {
  success: ['paid', 'success', 'captured'],
  paid: ['paid', 'success', 'captured'],
  failed: ['failed', 'faild'],
  refunded: ['refunded'],
  pending: ['pending', 'created'],
};

function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (STATUS_MAP.success.includes(s)) return 'success';
  if (STATUS_MAP.failed.includes(s)) return 'failed';
  if (STATUS_MAP.refunded.includes(s)) return 'refunded';
  if (STATUS_MAP.pending.includes(s)) return 'pending';
  return s || 'pending';
}

function detectGateway(ref) {
  const r = String(ref || '');
  if (r.startsWith('pay_') || r.startsWith('order_') || r.startsWith('sub_')) return 'Razorpay';
  if (r.startsWith('GPA.')) return 'Google Play';
  return 'Razorpay';
}

function present(row) {
  return {
    id: row.id,
    transaction_id: `TXN-${String(row.id).padStart(5, '0')}`,
    payment_id: row.reference_id || null,
    user: {
      id: row.user_id,
      name: row.user_name || 'Unknown',
      email: row.user_email || null,
      phone: row.user_phone || null,
    },
    type: row.type,
    type_label: TYPE_LABELS[row.type] || row.type,
    gateway: detectGateway(row.reference_id),
    amount: Number(row.amount || 0),
    currency: 'INR',
    coins: Number(row.coins || 0),
    plan_id: row.plan_id || null,
    coin_pack_id: row.coin_pack_id || null,
    status: normalizeStatus(row.payment_status),
    raw_status: row.payment_status,
    description: row.description,
    date: row.created_at,
  };
}

/** Build WHERE clause + params from query string */
function buildFilters(query, forcedStatus = null) {
  const { status, search, type, from_date, to_date, gateway } = query;
  const where = [PAYMENT_BASE_WHERE];
  const params = [];

  const statusKey = (forcedStatus || status || '').toLowerCase();
  if (statusKey && statusKey !== 'all' && STATUS_MAP[statusKey]) {
    where.push(`LOWER(ct.payment_status) IN (${STATUS_MAP[statusKey].map(() => '?').join(',')})`);
    params.push(...STATUS_MAP[statusKey]);
  }

  if (type) {
    where.push('ct.type = ?');
    params.push(type);
  }

  if (gateway && String(gateway).toLowerCase() === 'razorpay') {
    where.push("(ct.reference_id LIKE 'pay\\_%' OR ct.reference_id LIKE 'order\\_%')");
  }

  if (from_date) {
    where.push('DATE(ct.created_at) >= ?');
    params.push(from_date);
  }
  if (to_date) {
    where.push('DATE(ct.created_at) <= ?');
    params.push(to_date);
  }

  if (search) {
    const s = String(search).trim();
    const idMatch = s.toUpperCase().replace(/^TXN-?/, '');
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR ct.reference_id LIKE ? OR ct.description LIKE ? OR ct.id = ?)');
    params.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`, /^\d+$/.test(idMatch) ? Number(idMatch) : -1);
  }

  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

async function listWithFilters(req, res, forcedStatus) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { whereSql, params } = buildFilters(req.query, forcedStatus);

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM coin_transactions ct LEFT JOIN users u ON ct.user_id = u.id ${whereSql}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT ct.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone
       FROM coin_transactions ct
       LEFT JOIN users u ON ct.user_id = u.id
       ${whereSql}
      ORDER BY ct.created_at DESC, ct.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    items: rows.map(present),
    pagination: {
      total: Number(total),
      page,
      limit,
      total_pages: Math.ceil(Number(total) / limit),
      showing: rows.length,
    },
  };
}

async function computeStats(extraWhere = '', extraParams = []) {
  const [[s]] = await pool.query(
    `SELECT
        COUNT(*) AS total_count,
        SUM(LOWER(ct.payment_status) IN ('paid','success','captured')) AS success_count,
        SUM(LOWER(ct.payment_status) IN ('failed','faild')) AS failed_count,
        SUM(LOWER(ct.payment_status) = 'refunded') AS refunded_count,
        COALESCE(SUM(CASE WHEN LOWER(ct.payment_status) IN ('paid','success','captured') THEN ct.amount END), 0) AS success_amount,
        COALESCE(SUM(CASE WHEN LOWER(ct.payment_status) IN ('failed','faild') THEN ct.amount END), 0) AS failed_amount,
        COALESCE(SUM(CASE WHEN LOWER(ct.payment_status) = 'refunded' THEN ct.amount END), 0) AS refunded_amount
       FROM coin_transactions ct
      WHERE ${PAYMENT_BASE_WHERE} ${extraWhere}`,
    extraParams
  );
  const total = Number(s.total_count || 0);
  return {
    total_count: total,
    success_count: Number(s.success_count || 0),
    failed_count: Number(s.failed_count || 0),
    refunded_count: Number(s.refunded_count || 0),
    success_amount: Number(s.success_amount || 0),
    failed_amount: Number(s.failed_amount || 0),
    refunded_amount: Number(s.refunded_amount || 0),
    success_rate: total ? Number(((Number(s.success_count || 0) / total) * 100).toFixed(2)) : 0,
    failure_rate: total ? Number(((Number(s.failed_count || 0) / total) * 100).toFixed(2)) : 0,
  };
}

function toCsv(items) {
  const header = ['Transaction ID', 'Payment ID', 'User', 'Email', 'Type', 'Gateway', 'Amount', 'Coins', 'Status', 'Date'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = items.map((t) =>
    [t.transaction_id, t.payment_id, t.user.name, t.user.email, t.type_label, t.gateway, t.amount, t.coins, t.status,
      t.date ? new Date(t.date).toISOString() : ''].map(esc).join(',')
  );
  return [header.map(esc).join(','), ...lines].join('\n');
}

class AdminPaymentTransactionController {
  // ── Transactions ──────────────────────────────────────────────────────────

  /** GET /admin/payments/transactions?status=all|success|failed|refunded&search=&type=&from_date=&to_date=&page=&limit= */
  static async index(req, res) {
    try {
      const { items, pagination } = await listWithFilters(req, res, null);
      const stats = await computeStats();
      return ApiResponse.success(res, { transactions: items, stats, pagination });
    } catch (error) {
      console.error('Admin Payment Transactions Error:', error);
      return ApiResponse.error(res, 'Failed to fetch transactions.', 500);
    }
  }

  /** GET /admin/payments/transactions/stats */
  static async stats(req, res) {
    try {
      return ApiResponse.success(res, await computeStats());
    } catch (error) {
      console.error('Admin Payment Stats Error:', error);
      return ApiResponse.error(res, 'Failed to fetch transaction stats.', 500);
    }
  }

  /** GET /admin/payments/transactions/export?status=...  -> CSV */
  static async export(req, res) {
    try {
      req.query.page = 1;
      req.query.limit = 100;
      const { whereSql, params } = buildFilters(req.query, req.forcedStatus || null);
      const [rows] = await pool.query(
        `SELECT ct.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone
           FROM coin_transactions ct LEFT JOIN users u ON ct.user_id = u.id
           ${whereSql} ORDER BY ct.created_at DESC LIMIT 10000`,
        params
      );
      const csv = toCsv(rows.map(present));
      const name = req.forcedStatus === 'failed' ? 'failed_payments' : 'transactions';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}_${Date.now()}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error('Admin Payment Export Error:', error);
      return ApiResponse.error(res, 'Failed to export transactions.', 500);
    }
  }

  /** GET /admin/payments/transactions/:id  (accepts 123 or TXN-00123 or pay_xxx) */
  static async show(req, res) {
    try {
      const raw = String(req.params.id).trim();
      const numeric = raw.toUpperCase().replace(/^TXN-?/, '');
      const [rows] = await pool.query(
        `SELECT ct.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone
           FROM coin_transactions ct LEFT JOIN users u ON ct.user_id = u.id
          WHERE ${PAYMENT_BASE_WHERE} AND (ct.id = ? OR ct.reference_id = ?) LIMIT 1`,
        [/^\d+$/.test(numeric) ? Number(numeric) : -1, raw]
      );
      if (!rows.length) return ApiResponse.error(res, 'Transaction not found.', 404);
      return ApiResponse.success(res, present(rows[0]));
    } catch (error) {
      console.error('Admin Payment Show Error:', error);
      return ApiResponse.error(res, 'Failed to fetch transaction.', 500);
    }
  }

  // ── Failed Payments ───────────────────────────────────────────────────────

  /** GET /admin/payments/failed?search=&type=&from_date=&to_date=&page=&limit= */
  static async failed(req, res) {
    try {
      const { items, pagination } = await listWithFilters(req, res, 'failed');
      const stats = await computeStats();
      const [[today]] = await pool.query(
        `SELECT COUNT(*) AS c, COALESCE(SUM(ct.amount),0) AS amt FROM coin_transactions ct
          WHERE ${PAYMENT_BASE_WHERE} AND LOWER(ct.payment_status) IN ('failed','faild') AND DATE(ct.created_at) = CURDATE()`
      );
      return ApiResponse.success(res, {
        failed_payments: items,
        stats: {
          failed_count: stats.failed_count,
          failed_amount: stats.failed_amount,
          failure_rate: stats.failure_rate,
          today_failed_count: Number(today.c || 0),
          today_failed_amount: Number(today.amt || 0),
        },
        pagination,
      });
    } catch (error) {
      console.error('Admin Failed Payments Error:', error);
      return ApiResponse.error(res, 'Failed to fetch failed payments.', 500);
    }
  }

  /** GET /admin/payments/failed/export -> CSV */
  static async exportFailed(req, res) {
    req.forcedStatus = 'failed';
    return AdminPaymentTransactionController.export(req, res);
  }

  /**
   * POST /admin/payments/failed/:id/resolve
   * Manually mark a failed payment as paid (e.g. money captured late) and credit coins.
   */
  static async resolveFailed(req, res) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT * FROM coin_transactions WHERE id = ? AND LOWER(payment_status) IN ('failed','faild') FOR UPDATE`,
        [req.params.id]
      );
      if (!rows.length) {
        await connection.rollback();
        return ApiResponse.error(res, 'Failed payment not found.', 404);
      }
      const tx = rows[0];
      await connection.query("UPDATE coin_transactions SET payment_status = 'paid' WHERE id = ?", [tx.id]);
      if (Number(tx.coins) > 0) {
        await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [tx.coins, tx.user_id]);
      }
      await connection.commit();
      return ApiResponse.success(res, { id: tx.id, status: 'success', coins_credited: Number(tx.coins || 0) }, 'Payment marked as paid and coins credited.');
    } catch (error) {
      await connection.rollback();
      console.error('Admin Resolve Failed Payment Error:', error);
      return ApiResponse.error(res, 'Failed to resolve payment.', 500);
    } finally {
      connection.release();
    }
  }

  /** DELETE /admin/payments/failed/:id */
  static async destroyFailed(req, res) {
    try {
      const [result] = await pool.query(
        "DELETE FROM coin_transactions WHERE id = ? AND LOWER(payment_status) IN ('failed','faild')",
        [req.params.id]
      );
      if (!result.affectedRows) return ApiResponse.error(res, 'Failed payment not found.', 404);
      return ApiResponse.success(res, { id: Number(req.params.id) }, 'Failed payment deleted.');
    } catch (error) {
      console.error('Admin Delete Failed Payment Error:', error);
      return ApiResponse.error(res, 'Failed to delete payment.', 500);
    }
  }
}

module.exports = AdminPaymentTransactionController;
