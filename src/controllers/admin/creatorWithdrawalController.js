const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrencyINR(amount) {
  const num = Number(amount) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

function formatDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Controller ────────────────────────────────────────────────────────────────

class AdminCreatorWithdrawalController {
  /**
   * GET /api/v1/admin/creator-withdrawals
   *
   * Paginated list of all creator withdrawal requests.
   * Matches the "Creator Withdrawals" screen in the Admin panel:
   *  - USER column  : creator name, avatar, email
   *  - AMOUNT       : formatted INR
   *  - METHOD       : UPI / Bank Transfer
   *  - STATUS       : pending | approved | paid | rejected
   *  - REQUESTED    : requested_at date
   *
   * Query params:
   *  - search   : creator name, email, phone, account_number, upi_id
   *  - status   : all (default) | pending | approved | paid | rejected | success
   *  - page     : 1 (default)
   *  - limit    : 20 (default, max 100)
   */
  static async index(req, res) {
    try {
      const { search, status, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      // Only show users whose role is creator/Creator
      let whereClauses = ["(u.role = 'creator' OR u.role = 'Creator')"];
      let queryParams = [];

      if (search) {
        whereClauses.push(
          '(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR b.account_number LIKE ? OR b.upi_id LIKE ?)'
        );
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }

      // Normalise frontend status aliases: "success" → "paid"
      let normalizedStatus = null;
      if (status && status !== 'all') {
        normalizedStatus = status.toLowerCase() === 'success' ? 'paid' : status.toLowerCase();
        whereClauses.push('w.status = ?');
        queryParams.push(normalizedStatus);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      // ── Total count ────────────────────────────────────────────────────────
      const [[{ total_count }]] = await pool.query(
        `SELECT COUNT(*) AS total_count
         FROM writer_withdrawals w
         INNER JOIN users u ON w.user_id = u.id
         LEFT JOIN user_bank_details b ON w.user_id = b.user_id
         ${whereSql}`,
        queryParams
      );

      // ── Summary KPIs (scoped to creators only) ─────────────────────────────
      const [[{ total_requests }]] = await pool.query(
        `SELECT COUNT(*) AS total_requests
         FROM writer_withdrawals w
         INNER JOIN users u ON w.user_id = u.id
         WHERE (u.role = 'creator' OR u.role = 'Creator')`
      );

      const [[{ pending_count, pending_amount }]] = await pool.query(
        `SELECT COUNT(*) AS pending_count, COALESCE(SUM(w.amount), 0) AS pending_amount
         FROM writer_withdrawals w
         INNER JOIN users u ON w.user_id = u.id
         WHERE (u.role = 'creator' OR u.role = 'Creator') AND w.status = 'pending'`
      );

      const [[{ approved_count, approved_amount }]] = await pool.query(
        `SELECT COUNT(*) AS approved_count, COALESCE(SUM(w.amount), 0) AS approved_amount
         FROM writer_withdrawals w
         INNER JOIN users u ON w.user_id = u.id
         WHERE (u.role = 'creator' OR u.role = 'Creator') AND w.status = 'approved'`
      );

      const [[{ paid_count, paid_amount }]] = await pool.query(
        `SELECT COUNT(*) AS paid_count, COALESCE(SUM(w.amount), 0) AS paid_amount
         FROM writer_withdrawals w
         INNER JOIN users u ON w.user_id = u.id
         WHERE (u.role = 'creator' OR u.role = 'Creator') AND w.status = 'paid'`
      );

      const [[{ rejected_count, rejected_amount }]] = await pool.query(
        `SELECT COUNT(*) AS rejected_count, COALESCE(SUM(w.amount), 0) AS rejected_amount
         FROM writer_withdrawals w
         INNER JOIN users u ON w.user_id = u.id
         WHERE (u.role = 'creator' OR u.role = 'Creator') AND w.status = 'rejected'`
      );

      // ── Paginated list ─────────────────────────────────────────────────────
      const [rows] = await pool.query(
        `SELECT
           w.id,
           w.user_id,
           w.amount,
           w.description,
           w.status,
           w.transaction_reference,
           w.admin_notes,
           w.rejection_reason,
           w.requested_at,
           w.processed_at,
           u.name           AS creator_name,
           u.email          AS creator_email,
           u.phone          AS creator_phone,
           u.avatar_path    AS creator_avatar,
           b.account_holder_name,
           b.account_number,
           b.bank_name,
           b.ifsc_code,
           b.upi_id
         FROM writer_withdrawals w
         INNER JOIN users u ON w.user_id = u.id
         LEFT JOIN user_bank_details b ON w.user_id = b.user_id
         ${whereSql}
         ORDER BY w.requested_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      // ── Format rows ────────────────────────────────────────────────────────
      const withdrawals = rows.map((w) => {
        const amt = Number(w.amount || 0);
        const hasUpi = w.upi_id && w.upi_id.trim() !== '';
        const hasBank = w.account_number && w.account_number.trim() !== '';
        const paymentMethod = hasUpi && !hasBank ? 'UPI' : 'Bank Transfer';

        // Map DB status → display label (pending/approved/paid→Success/rejected)
        const statusLabel =
          w.status === 'paid' ? 'success' : w.status;

        return {
          id: w.id,
          creator_id: w.user_id,
          creator_name: w.creator_name || 'Unnamed Creator',
          creator_email: w.creator_email || null,
          creator_phone: w.creator_phone || null,
          creator_avatar: w.creator_avatar || null,
          amount: amt,
          formatted_amount: formatCurrencyINR(amt),
          description: w.description || null,
          payment_method: paymentMethod,
          status: w.status,
          status_label: statusLabel,
          transaction_reference: w.transaction_reference || null,
          admin_notes: w.admin_notes || null,
          rejection_reason: w.rejection_reason || null,
          requested_at: w.requested_at,
          requested_date: formatDate(w.requested_at),
          processed_at: w.processed_at || null,
          processed_date: formatDate(w.processed_at),
          bank_details: {
            account_holder_name: w.account_holder_name || null,
            account_number: w.account_number || null,
            bank_name: w.bank_name || null,
            ifsc_code: w.ifsc_code || null,
            upi_id: w.upi_id || null,
          },
        };
      });

      return ApiResponse.success(
        res,
        {
          withdrawals,
          data: withdrawals,
          summary: {
            total_requests: Number(total_requests || 0),
            pending_count: Number(pending_count || 0),
            pending_amount: Number(pending_amount || 0),
            formatted_pending_amount: formatCurrencyINR(pending_amount),
            approved_count: Number(approved_count || 0),
            approved_amount: Number(approved_amount || 0),
            formatted_approved_amount: formatCurrencyINR(approved_amount),
            paid_count: Number(paid_count || 0),
            paid_amount: Number(paid_amount || 0),
            formatted_paid_amount: formatCurrencyINR(paid_amount),
            rejected_count: Number(rejected_count || 0),
            rejected_amount: Number(rejected_amount || 0),
            formatted_rejected_amount: formatCurrencyINR(rejected_amount),
          },
          pagination: {
            total: Number(total_count || 0),
            page: pageNum,
            limit: limitNum,
            total_pages: Math.ceil(Number(total_count || 0) / limitNum),
          },
        },
        'Creator withdrawal requests fetched successfully.'
      );
    } catch (error) {
      console.error('Admin Creator Withdrawals List Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creator withdrawal requests.', 500);
    }
  }

  /**
   * GET /api/v1/admin/creator-withdrawals/:id
   *
   * Full detail of a single creator withdrawal request including creator's
   * earnings balance and bank details.
   */
  static async show(req, res) {
    try {
      const withdrawalId = req.params.id;

      const [rows] = await pool.query(
        `SELECT
           w.id,
           w.user_id,
           w.amount,
           w.description,
           w.status,
           w.transaction_reference,
           w.admin_notes,
           w.rejection_reason,
           w.requested_at,
           w.processed_at,
           u.name           AS creator_name,
           u.email          AS creator_email,
           u.phone          AS creator_phone,
           u.avatar_path    AS creator_avatar,
           b.account_holder_name,
           b.account_number,
           b.bank_name,
           b.ifsc_code,
           b.upi_id
         FROM writer_withdrawals w
         INNER JOIN users u ON w.user_id = u.id
         LEFT JOIN user_bank_details b ON w.user_id = b.user_id
         WHERE w.id = ?
           AND (u.role = 'creator' OR u.role = 'Creator')
         LIMIT 1`,
        [withdrawalId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Creator withdrawal request not found.', 404);
      }

      const w = rows[0];
      const amt = Number(w.amount || 0);
      const hasUpi = w.upi_id && w.upi_id.trim() !== '';
      const hasBank = w.account_number && w.account_number.trim() !== '';
      const paymentMethod = hasUpi && !hasBank ? 'UPI' : 'Bank Transfer';

      // Creator earnings balance
      const [[{ total_earnings }]] = await pool.query(
        'SELECT COALESCE(SUM(amount), 0) AS total_earnings FROM writer_earnings WHERE user_id = ?',
        [w.user_id]
      );
      const [[{ total_paid }]] = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) AS total_paid FROM writer_withdrawals WHERE user_id = ? AND status = 'paid'",
        [w.user_id]
      );
      const [[{ total_pending }]] = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) AS total_pending FROM writer_withdrawals WHERE user_id = ? AND status = 'pending'",
        [w.user_id]
      );

      const earningsVal = Number(total_earnings || 0);
      const paidVal = Number(total_paid || 0);
      const pendingVal = Number(total_pending || 0);
      const availableVal = Math.max(0, earningsVal - paidVal - pendingVal);

      return ApiResponse.success(
        res,
        {
          id: w.id,
          creator_id: w.user_id,
          creator_name: w.creator_name || 'Unnamed Creator',
          creator_email: w.creator_email || null,
          creator_phone: w.creator_phone || null,
          creator_avatar: w.creator_avatar || null,
          amount: amt,
          formatted_amount: formatCurrencyINR(amt),
          description: w.description || null,
          payment_method: paymentMethod,
          status: w.status,
          transaction_reference: w.transaction_reference || null,
          admin_notes: w.admin_notes || null,
          rejection_reason: w.rejection_reason || null,
          requested_at: w.requested_at,
          requested_date: formatDate(w.requested_at),
          processed_at: w.processed_at || null,
          processed_date: formatDate(w.processed_at),
          bank_details: {
            account_holder_name: w.account_holder_name || null,
            account_number: w.account_number || null,
            bank_name: w.bank_name || null,
            ifsc_code: w.ifsc_code || null,
            upi_id: w.upi_id || null,
          },
          creator_financials: {
            total_earnings: earningsVal,
            formatted_total_earnings: formatCurrencyINR(earningsVal),
            total_paid: paidVal,
            formatted_total_paid: formatCurrencyINR(paidVal),
            total_pending: pendingVal,
            formatted_total_pending: formatCurrencyINR(pendingVal),
            available_balance: availableVal,
            formatted_available_balance: formatCurrencyINR(availableVal),
          },
        },
        'Creator withdrawal request fetched successfully.'
      );
    } catch (error) {
      console.error('Admin Creator Withdrawal Show Error:', error);
      return ApiResponse.error(res, 'Failed to fetch creator withdrawal request.', 500);
    }
  }

  /**
   * POST /api/v1/admin/creator-withdrawals/:id/action
   * PUT  /api/v1/admin/creator-withdrawals/:id
   *
   * Approve or Reject a creator withdrawal request.
   *
   * Body:
   *  - status               : "approved" | "paid" | "rejected" | "pending"
   *  - transaction_reference: (required when approving/paying, optional otherwise)
   *  - utr                  : alias for transaction_reference
   *  - admin_notes          : optional admin note
   *  - rejection_reason     : required when status = "rejected"
   */
  static async processWithdrawal(req, res) {
    try {
      const withdrawalId = req.params.id;
      const { status, transaction_reference, utr, admin_notes, rejection_reason } = req.body;

      if (!status) {
        return ApiResponse.error(
          res,
          'Status is required. Use: approved, paid, rejected, or pending.',
          422
        );
      }

      const validStatuses = ['approved', 'paid', 'rejected', 'pending'];
      const normalizedStatus = status.toLowerCase();

      if (!validStatuses.includes(normalizedStatus)) {
        return ApiResponse.error(
          res,
          `Invalid status "${status}". Allowed values: ${validStatuses.join(', ')}.`,
          400
        );
      }

      // Validate rejection_reason is provided when rejecting
      if (normalizedStatus === 'rejected' && !rejection_reason) {
        return ApiResponse.error(
          res,
          'A rejection_reason is required when rejecting a withdrawal request.',
          422
        );
      }

      // Verify the withdrawal belongs to a creator
      const [rows] = await pool.query(
        `SELECT w.id, w.user_id, w.amount, w.status
         FROM writer_withdrawals w
         INNER JOIN users u ON w.user_id = u.id
         WHERE w.id = ?
           AND (u.role = 'creator' OR u.role = 'Creator')
         LIMIT 1`,
        [withdrawalId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Creator withdrawal request not found.', 404);
      }

      const txRef = transaction_reference || utr || null;

      // Build UPDATE fields
      let updateFields = ['status = ?', 'processed_at = NOW()', 'updated_at = NOW()'];
      let queryParams = [normalizedStatus];

      if (txRef !== undefined) {
        updateFields.push('transaction_reference = ?');
        queryParams.push(txRef);
      }

      if (admin_notes !== undefined) {
        updateFields.push('admin_notes = ?');
        queryParams.push(admin_notes || null);
      }

      if (rejection_reason !== undefined) {
        updateFields.push('rejection_reason = ?');
        queryParams.push(rejection_reason || null);
      }

      await pool.query(
        `UPDATE writer_withdrawals SET ${updateFields.join(', ')} WHERE id = ?`,
        [...queryParams, withdrawalId]
      );

      // Human-readable action label
      const actionLabel = {
        approved: 'Approved',
        paid: 'Marked as Paid',
        rejected: 'Rejected',
        pending: 'Reset to Pending',
      }[normalizedStatus] || normalizedStatus;

      return ApiResponse.success(
        res,
        {
          id: Number(withdrawalId),
          status: normalizedStatus,
          action: actionLabel,
          transaction_reference: txRef,
          admin_notes: admin_notes || null,
          rejection_reason: rejection_reason || null,
        },
        `Withdrawal request ${actionLabel} successfully.`
      );
    } catch (error) {
      console.error('Admin Process Creator Withdrawal Error:', error);
      return ApiResponse.error(res, 'Failed to process creator withdrawal request.', 500);
    }
  }

  /**
   * POST /api/v1/admin/creator-withdrawals/:id/approve
   * Quick shortcut — sets status to "approved"
   */
  static async approve(req, res) {
    req.body.status = 'approved';
    return AdminCreatorWithdrawalController.processWithdrawal(req, res);
  }

  /**
   * POST /api/v1/admin/creator-withdrawals/:id/reject
   * Quick shortcut — sets status to "rejected"
   * Body: { rejection_reason: "..." }
   */
  static async reject(req, res) {
    req.body.status = 'rejected';
    return AdminCreatorWithdrawalController.processWithdrawal(req, res);
  }
}

module.exports = AdminCreatorWithdrawalController;
