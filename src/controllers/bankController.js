const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

function formatBankDetails(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    account_holder_name: row.account_holder_name || '',
    account_number: row.account_number || '',
    bank_name: row.bank_name || '',
    ifsc_code: row.ifsc_code || '',
    branch_name: row.branch_name || null,
    upi_id: row.upi_id || null,
    account_type: row.account_type || 'savings',
    is_verified: Boolean(row.is_verified),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

class BankController {
  /**
   * GET /api/v1/user/bank-details or GET /api/v1/bank-details
   * Fetch bank details of authenticated user
   */
  static async show(req, res) {
    try {
      const userId = req.user.id;
      const [rows] = await pool.query('SELECT * FROM user_bank_details WHERE user_id = ? LIMIT 1', [userId]);

      if (rows.length === 0) {
        return ApiResponse.success(res, { bank_details: null }, 'No bank details found.');
      }

      return ApiResponse.success(res, { bank_details: formatBankDetails(rows[0]) });
    } catch (error) {
      console.error('Get Bank Details Error:', error);
      return ApiResponse.error(res, 'Failed to fetch bank details.', 500);
    }
  }

  /**
   * POST /api/v1/user/bank-details or PUT /api/v1/user/bank-details
   * Save or update bank details for authenticated user
   */
  static async store(req, res) {
    try {
      const userId = req.user.id;
      const {
        account_holder_name,
        account_number,
        bank_name,
        ifsc_code,
        branch_name,
        upi_id,
        account_type = 'savings',
      } = req.body;

      if (!account_holder_name || !account_holder_name.trim()) {
        return ApiResponse.error(res, 'Account holder name is required.', 422);
      }
      if (!account_number || !account_number.trim()) {
        return ApiResponse.error(res, 'Account number is required.', 422);
      }
      if (!bank_name || !bank_name.trim()) {
        return ApiResponse.error(res, 'Bank name is required.', 422);
      }
      if (!ifsc_code || !ifsc_code.trim()) {
        return ApiResponse.error(res, 'IFSC code is required.', 422);
      }

      const holderName = account_holder_name.trim();
      const accNum = account_number.trim();
      const bName = bank_name.trim();
      const ifsc = ifsc_code.trim().toUpperCase();
      const branch = branch_name ? branch_name.trim() : null;
      const upi = upi_id ? upi_id.trim() : null;
      const accType = (account_type && ['savings', 'current'].includes(account_type.toLowerCase())) ? account_type.toLowerCase() : 'savings';

      const [existing] = await pool.query('SELECT id FROM user_bank_details WHERE user_id = ? LIMIT 1', [userId]);

      if (existing.length > 0) {
        await pool.query(
          `UPDATE user_bank_details 
           SET account_holder_name = ?, account_number = ?, bank_name = ?, ifsc_code = ?, branch_name = ?, upi_id = ?, account_type = ?, updated_at = NOW()
           WHERE user_id = ?`,
          [holderName, accNum, bName, ifsc, branch, upi, accType, userId]
        );
      } else {
        await pool.query(
          `INSERT INTO user_bank_details (user_id, account_holder_name, account_number, bank_name, ifsc_code, branch_name, upi_id, account_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, holderName, accNum, bName, ifsc, branch, upi, accType]
        );
      }

      const [updatedRows] = await pool.query('SELECT * FROM user_bank_details WHERE user_id = ? LIMIT 1', [userId]);

      return ApiResponse.success(
        res,
        { bank_details: formatBankDetails(updatedRows[0]) },
        'Bank details saved successfully.'
      );
    } catch (error) {
      console.error('Save Bank Details Error:', error);
      return ApiResponse.error(res, 'Failed to save bank details.', 500);
    }
  }

  /**
   * DELETE /api/v1/user/bank-details
   * Remove bank details of authenticated user
   */
  static async destroy(req, res) {
    try {
      const userId = req.user.id;
      const [existing] = await pool.query('SELECT id FROM user_bank_details WHERE user_id = ? LIMIT 1', [userId]);

      if (existing.length === 0) {
        return ApiResponse.error(res, 'No bank details found to delete.', 404);
      }

      await pool.query('DELETE FROM user_bank_details WHERE user_id = ?', [userId]);

      return ApiResponse.success(res, null, 'Bank details deleted successfully.');
    } catch (error) {
      console.error('Delete Bank Details Error:', error);
      return ApiResponse.error(res, 'Failed to delete bank details.', 500);
    }
  }
}

module.exports = BankController;
