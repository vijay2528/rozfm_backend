const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

function formatCurrencyINR(amount) {
  const num = Number(amount) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

class AdminWithdrawalController {
  /**
   * GET /api/v1/admin/withdrawals
   * Paginated list of all writer withdrawal requests with search, status filters & summary stats
   */
  static async index(req, res) {
    try {
      const { search, status, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (search) {
        whereClauses.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR b.account_number LIKE ? OR b.upi_id LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (status && status !== 'all') {
        whereClauses.push('w.status = ?');
        queryParams.push(status.toLowerCase());
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      // Total count query
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) as count FROM writer_withdrawals w LEFT JOIN users u ON w.user_id = u.id LEFT JOIN user_bank_details b ON w.user_id = b.user_id ${whereSql}`,
        queryParams
      );

      // Summary metrics
      const [[{ total_requests }]] = await pool.query('SELECT COUNT(*) as total_requests FROM writer_withdrawals');
      const [[{ pending_count, pending_amount }]] = await pool.query(
        "SELECT COUNT(*) as pending_count, COALESCE(SUM(amount), 0) as pending_amount FROM writer_withdrawals WHERE status = 'pending'"
      );
      const [[{ paid_count, paid_amount }]] = await pool.query(
        "SELECT COUNT(*) as paid_count, COALESCE(SUM(amount), 0) as paid_amount FROM writer_withdrawals WHERE status = 'paid'"
      );
      const [[{ rejected_count, rejected_amount }]] = await pool.query(
        "SELECT COUNT(*) as rejected_count, COALESCE(SUM(amount), 0) as rejected_amount FROM writer_withdrawals WHERE status = 'rejected'"
      );

      // Fetch paginated list
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
          u.name as writer_name,
          u.email as writer_email,
          u.phone as writer_phone,
          u.avatar_path as writer_avatar,
          b.account_holder_name,
          b.account_number,
          b.bank_name,
          b.ifsc_code,
          b.upi_id
         FROM writer_withdrawals w
         LEFT JOIN users u ON w.user_id = u.id
         LEFT JOIN user_bank_details b ON w.user_id = b.user_id
         ${whereSql}
         ORDER BY w.requested_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      const withdrawals = rows.map((w) => {
        const amt = Number(w.amount || 0);
        const paymentMethod = w.upi_id && !w.account_number ? 'upi' : 'bank_transfer';
        return {
          id: w.id,
          writer_id: w.user_id,
          writer_name: w.writer_name || 'Unnamed Writer',
          writer_email: w.writer_email || null,
          writer_phone: w.writer_phone || null,
          writer_avatar: w.writer_avatar || null,
          amount: amt,
          formatted_amount: formatCurrencyINR(amt),
          description: w.description || null,
          payment_method: paymentMethod,
          status: w.status,
          transaction_reference: w.transaction_reference || null,
          admin_notes: w.admin_notes || null,
          rejection_reason: w.rejection_reason || null,
          requested_at: w.requested_at,
          processed_at: w.processed_at,
          bank_details: {
            account_holder_name: w.account_holder_name || null,
            account_number: w.account_number || null,
            bank_name: w.bank_name || null,
            ifsc_code: w.ifsc_code || null,
            upi_id: w.upi_id || null,
          },
        };
      });

      return ApiResponse.success(res, {
        withdrawals,
        data: withdrawals,
        summary: {
          total_requests: Number(total_requests || 0),
          pending_count: Number(pending_count || 0),
          pending_amount: Number(pending_amount || 0),
          formatted_pending_amount: formatCurrencyINR(pending_amount || 0),
          paid_count: Number(paid_count || 0),
          paid_amount: Number(paid_amount || 0),
          formatted_paid_amount: formatCurrencyINR(paid_amount || 0),
          rejected_count: Number(rejected_count || 0),
          rejected_amount: Number(rejected_amount || 0),
          formatted_rejected_amount: formatCurrencyINR(rejected_amount || 0),
        },
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      }, 'Withdrawal requests list fetched successfully.');
    } catch (error) {
      console.error('Admin List Withdrawals Error:', error);
      return ApiResponse.error(res, 'Failed to fetch withdrawal requests list.', 500);
    }
  }

  /**
   * GET /api/v1/admin/withdrawals/:id
   * Get single withdrawal request details
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
          u.name as writer_name,
          u.email as writer_email,
          u.phone as writer_phone,
          u.avatar_path as writer_avatar,
          b.account_holder_name,
          b.account_number,
          b.bank_name,
          b.ifsc_code,
          b.upi_id
         FROM writer_withdrawals w
         LEFT JOIN users u ON w.user_id = u.id
         LEFT JOIN user_bank_details b ON w.user_id = b.user_id
         WHERE w.id = ?
         LIMIT 1`,
        [withdrawalId]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Withdrawal request not found.', 404);
      }

      const w = rows[0];
      const amt = Number(w.amount || 0);
      const paymentMethod = w.upi_id && !w.account_number ? 'upi' : 'bank_transfer';

      // Writer's overall earnings & total paid
      const [[{ total_earnings }]] = await pool.query(
        'SELECT COALESCE(SUM(amount), 0) as total_earnings FROM writer_earnings WHERE user_id = ?',
        [w.user_id]
      );

      const [[{ total_paid }]] = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) as total_paid FROM writer_withdrawals WHERE user_id = ? AND status = 'paid'",
        [w.user_id]
      );

      const earningsVal = Number(total_earnings || 0);
      const paidVal = Number(total_paid || 0);

      const withdrawalDetail = {
        id: w.id,
        writer_id: w.user_id,
        writer_name: w.writer_name || 'Unnamed Writer',
        writer_email: w.writer_email || null,
        writer_phone: w.writer_phone || null,
        writer_avatar: w.writer_avatar || null,
        amount: amt,
        formatted_amount: formatCurrencyINR(amt),
        description: w.description || null,
        payment_method: paymentMethod,
        status: w.status,
        transaction_reference: w.transaction_reference || null,
        admin_notes: w.admin_notes || null,
        rejection_reason: w.rejection_reason || null,
        requested_at: w.requested_at,
        processed_at: w.processed_at,
        bank_details: {
          account_holder_name: w.account_holder_name || null,
          account_number: w.account_number || null,
          bank_name: w.bank_name || null,
          ifsc_code: w.ifsc_code || null,
          upi_id: w.upi_id || null,
        },
        writer_financials: {
          total_earnings: earningsVal,
          formatted_total_earnings: formatCurrencyINR(earningsVal),
          total_paid: paidVal,
          formatted_total_paid: formatCurrencyINR(paidVal),
        },
      };

      return ApiResponse.success(res, withdrawalDetail, 'Withdrawal request details fetched successfully.');
    } catch (error) {
      console.error('Admin Show Withdrawal Error:', error);
      return ApiResponse.error(res, 'Failed to fetch withdrawal details.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/withdrawals/:id or POST /api/v1/admin/withdrawals/:id/action
   * Action / Process withdrawal request (mark as paid, approved, or rejected with manual payment details)
   */
  static async processWithdrawal(req, res) {
    try {
      const withdrawalId = req.params.id;
      const {
        status,
        transaction_reference,
        utr,
        admin_notes,
        rejection_reason,
      } = req.body;

      if (!status) {
        return ApiResponse.error(res, 'Status is required (paid, approved, rejected, pending).', 420);
      }

      const validStatuses = ['paid', 'approved', 'rejected', 'pending'];
      const normalizedStatus = status.toLowerCase();
      if (!validStatuses.includes(normalizedStatus)) {
        return ApiResponse.error(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
      }

      const [rows] = await pool.query('SELECT id, user_id, amount FROM writer_withdrawals WHERE id = ? LIMIT 1', [withdrawalId]);
      if (rows.length === 0) {
        return ApiResponse.error(res, 'Withdrawal request not found.', 404);
      }

      const txRef = transaction_reference || utr || null;

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

      return ApiResponse.success(
        res,
        {
          id: Number(withdrawalId),
          status: normalizedStatus,
          transaction_reference: txRef,
          admin_notes: admin_notes || null,
          rejection_reason: rejection_reason || null,
        },
        `Withdrawal request status updated to '${normalizedStatus}' successfully.`
      );
    } catch (error) {
      console.error('Admin Process Withdrawal Error:', error);
      return ApiResponse.error(res, 'Failed to process withdrawal request.', 500);
    }
  }

  /**
   * DELETE /api/v1/admin/withdrawals/:id
   * Delete a withdrawal request record
   */
  static async destroy(req, res) {
    try {
      const withdrawalId = req.params.id;

      const [result] = await pool.query('DELETE FROM writer_withdrawals WHERE id = ?', [withdrawalId]);
      if (result.affectedRows === 0) {
        return ApiResponse.error(res, 'Withdrawal request not found.', 404);
      }

      return ApiResponse.success(res, { id: withdrawalId }, 'Withdrawal request deleted successfully.');
    } catch (error) {
      console.error('Admin Delete Withdrawal Error:', error);
      return ApiResponse.error(res, 'Failed to delete withdrawal request.', 500);
    }
  }
}

module.exports = AdminWithdrawalController;
