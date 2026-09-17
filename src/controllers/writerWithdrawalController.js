const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

function formatCurrencyINR(amount) {
  const num = Number(amount) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

class WriterWithdrawalController {
  /**
   * Helper to calculate writer's earnings summary: total earnings, paid withdrawals, pending withdrawals, and net available balance
   */
  static async getWriterEarningsBalance(userId) {
    const [[{ total_earnings }]] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total_earnings FROM writer_earnings WHERE user_id = ?',
      [userId]
    );

    const [[{ total_paid }]] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total_paid FROM writer_withdrawals WHERE user_id = ? AND status = 'paid'",
      [userId]
    );

    const [[{ total_pending }]] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total_pending FROM writer_withdrawals WHERE user_id = ? AND status = 'pending'",
      [userId]
    );

    const earningsVal = Number(total_earnings || 0);
    const paidVal = Number(total_paid || 0);
    const pendingVal = Number(total_pending || 0);
    const availableVal = Math.max(0, earningsVal - paidVal - pendingVal);

    return {
      total_earnings: earningsVal,
      formatted_total_earnings: formatCurrencyINR(earningsVal),
      total_paid: paidVal,
      formatted_total_paid: formatCurrencyINR(paidVal),
      total_pending: pendingVal,
      formatted_total_pending: formatCurrencyINR(pendingVal),
      available_balance: availableVal,
      formatted_available_balance: formatCurrencyINR(availableVal),
    };
  }

  /**
   * GET /api/v1/writer/withdrawals/summary
   * Fetch writer's total earnings, withdrawal summary & bank details status
   */
  static async getSummary(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated user.', 401);
      }

      const balance = await WriterWithdrawalController.getWriterEarningsBalance(userId);

      const [bankRows] = await pool.query(
        'SELECT * FROM user_bank_details WHERE user_id = ? LIMIT 1',
        [userId]
      );

      const bankDetails = bankRows.length > 0 ? bankRows[0] : null;
      const hasBankDetails = Boolean(
        bankDetails && (bankDetails.account_number || bankDetails.upi_id)
      );

      return ApiResponse.success(res, {
        balance,
        has_bank_details: hasBankDetails,
        bank_details: bankDetails,
      }, 'Writer withdrawal summary fetched successfully.');
    } catch (error) {
      console.error('Writer Withdrawal Summary Error:', error);
      return ApiResponse.error(res, 'Failed to fetch withdrawal summary.', 500);
    }
  }

  /**
   * POST /api/v1/writer/withdrawals
   * Writer requests a new withdrawal (amount & description)
   * Validates that bank details exist and amount does not exceed available balance
   */
  static async requestWithdrawal(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated user.', 401);
      }

      const { amount, description } = req.body;
      const reqAmount = parseFloat(amount);

      if (isNaN(reqAmount) || reqAmount <= 0) {
        return ApiResponse.error(res, 'Please provide a valid positive withdrawal amount.', 420);
      }

      // Check 1: Verify writer has added bank account / UPI details
      const [bankRows] = await pool.query(
        'SELECT * FROM user_bank_details WHERE user_id = ? LIMIT 1',
        [userId]
      );

      const bankDetails = bankRows.length > 0 ? bankRows[0] : null;
      const hasValidAccount = Boolean(
        bankDetails &&
        ((bankDetails.account_number && bankDetails.account_number.trim() !== '') ||
         (bankDetails.upi_id && bankDetails.upi_id.trim() !== ''))
      );

      if (!hasValidAccount) {
        return ApiResponse.error(
          res,
          'Please add your bank account or UPI details before submitting a withdrawal request.',
          400
        );
      }

      // Check 2: Verify requested amount does not exceed available earnings balance
      const balance = await WriterWithdrawalController.getWriterEarningsBalance(userId);

      if (reqAmount > balance.available_balance) {
        return ApiResponse.error(
          res,
          `Requested withdrawal amount (${formatCurrencyINR(reqAmount)}) cannot be greater than your available earnings balance (${balance.formatted_available_balance}).`,
          400
        );
      }

      // Determine payment method and bank details from user_bank_details
      const paymentMethod = bankDetails.upi_id && !bankDetails.account_number ? 'upi' : 'bank_transfer';
      const holderName = bankDetails.account_holder_name || null;
      const accNum = bankDetails.account_number || null;
      const bankName = bankDetails.bank_name || null;
      const ifsc = bankDetails.ifsc_code || null;
      const upiId = bankDetails.upi_id || null;

      const [result] = await pool.query(
        `INSERT INTO writer_withdrawals 
         (user_id, amount, description, status, requested_at) 
         VALUES (?, ?, ?, 'pending', NOW())`,
        [
          userId,
          reqAmount,
          description || null,
        ]
      );

      const newWithdrawalId = result.insertId;

      return ApiResponse.success(
        res,
        {
          id: newWithdrawalId,
          amount: reqAmount,
          formatted_amount: formatCurrencyINR(reqAmount),
          description: description || null,
          payment_method: paymentMethod,
          status: 'pending',
          bank_details: {
            account_holder_name: holderName,
            account_number: accNum,
            bank_name: bankName,
            ifsc_code: ifsc,
            upi_id: upiId,
          },
        },
        'Withdrawal request submitted successfully.',
        201
      );
    } catch (error) {
      console.error('Writer Request Withdrawal Error:', error);
      return ApiResponse.error(res, 'Failed to submit withdrawal request.', 500);
    }
  }

  /**
   * GET /api/v1/writer/withdrawals
   * List withdrawal requests submitted by the writer
   */
  static async listWithdrawals(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated user.', 401);
      }

      const [rows] = await pool.query(
        `SELECT w.id, w.user_id, w.amount, w.description, w.status, w.transaction_reference, w.admin_notes, w.rejection_reason, w.requested_at, w.processed_at,
                b.account_holder_name, b.account_number, b.bank_name, b.ifsc_code, b.upi_id
         FROM writer_withdrawals w
         LEFT JOIN user_bank_details b ON w.user_id = b.user_id
         WHERE w.user_id = ?
         ORDER BY w.requested_at DESC`,
        [userId]
      );

      const withdrawals = rows.map((w) => {
        const amt = Number(w.amount || 0);
        const paymentMethod = w.upi_id && !w.account_number ? 'upi' : 'bank_transfer';
        return {
          id: w.id,
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

      return ApiResponse.success(res, { withdrawals, data: withdrawals }, 'Withdrawal history fetched successfully.');
    } catch (error) {
      console.error('Writer List Withdrawals Error:', error);
      return ApiResponse.error(res, 'Failed to fetch withdrawal history.', 500);
    }
  }

  /**
   * GET /api/v1/writer/bank-details
   * Fetch writer's saved bank account / UPI details
   */
  static async getBankDetails(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated user.', 401);
      }

      const [rows] = await pool.query(
        'SELECT id, user_id, account_holder_name, account_number, bank_name, ifsc_code, branch_name, upi_id, account_type, is_verified, created_at, updated_at FROM user_bank_details WHERE user_id = ? LIMIT 1',
        [userId]
      );

      const bankDetails = rows.length > 0 ? rows[0] : null;
      return ApiResponse.success(res, { bank_details: bankDetails }, 'Bank details fetched successfully.');
    } catch (error) {
      console.error('Writer Get Bank Details Error:', error);
      return ApiResponse.error(res, 'Failed to fetch bank details.', 500);
    }
  }

  /**
   * POST /api/v1/writer/bank-details or PUT /api/v1/writer/bank-details
   * Create or update writer's bank account / UPI details
   */
  static async saveBankDetails(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      if (!userId) {
        return ApiResponse.error(res, 'Unauthenticated user.', 401);
      }

      const {
        account_holder_name,
        account_number,
        bank_name,
        ifsc_code,
        branch_name,
        upi_id,
        account_type,
      } = req.body;

      if (!account_number && !upi_id) {
        return ApiResponse.error(res, 'Please provide either a Bank Account Number or a UPI ID.', 420);
      }

      const [existing] = await pool.query(
        'SELECT id FROM user_bank_details WHERE user_id = ? LIMIT 1',
        [userId]
      );

      if (existing.length > 0) {
        await pool.query(
          `UPDATE user_bank_details SET
            account_holder_name = COALESCE(?, account_holder_name),
            account_number = COALESCE(?, account_number),
            bank_name = COALESCE(?, bank_name),
            ifsc_code = COALESCE(?, ifsc_code),
            branch_name = COALESCE(?, branch_name),
            upi_id = COALESCE(?, upi_id),
            account_type = COALESCE(?, account_type),
            updated_at = NOW()
           WHERE user_id = ?`,
          [
            account_holder_name || null,
            account_number || null,
            bank_name || null,
            ifsc_code || null,
            branch_name || null,
            upi_id || null,
            account_type || null,
            userId,
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO user_bank_details 
           (user_id, account_holder_name, account_number, bank_name, ifsc_code, branch_name, upi_id, account_type) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            account_holder_name || null,
            account_number || null,
            bank_name || null,
            ifsc_code || null,
            branch_name || null,
            upi_id || null,
            account_type || 'savings',
          ]
        );
      }

      const [updatedRows] = await pool.query(
        'SELECT * FROM user_bank_details WHERE user_id = ? LIMIT 1',
        [userId]
      );

      return ApiResponse.success(res, { bank_details: updatedRows[0] }, 'Bank details saved successfully.');
    } catch (error) {
      console.error('Writer Save Bank Details Error:', error);
      return ApiResponse.error(res, 'Failed to save bank details.', 500);
    }
  }
}

module.exports = WriterWithdrawalController;
