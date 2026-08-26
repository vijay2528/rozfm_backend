const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

class UserController {
  /**
   * GET /api/v1/admin/users
   * Paginated list of users with search, role, status filters
   */
  static async index(req, res) {
    try {
      const { search, role, is_blocked, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      let whereClauses = ['1=1'];
      let queryParams = [];

      if (search) {
        whereClauses.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (role) {
        whereClauses.push('subscription_type = ?');
        queryParams.push(role);
      }

      if (is_blocked !== undefined && is_blocked !== '') {
        whereClauses.push('is_blocked = ?');
        queryParams.push(is_blocked === '1' || is_blocked === 'true' ? 1 : 0);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [[{ count }]] = await pool.query(`SELECT COUNT(*) as count FROM users ${whereSql}`, queryParams);

      const [users] = await pool.query(
        `SELECT id, name, email, phone, country, state, city, subscription_type, wallet_balance, is_blocked, last_login_at, created_at
         FROM users
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ApiResponse.success(res, {
        users,
        pagination: {
          total: count,
          page: parseInt(page, 10),
          limit: limitNum,
          total_pages: Math.ceil(count / limitNum),
        },
      });
    } catch (error) {
      console.error('Admin List Users Error:', error);
      return ApiResponse.error(res, 'Failed to fetch users list.', 500);
    }
  }

  /**
   * GET /api/v1/admin/users/:id
   * Get detailed profile of a single user
   */
  static async show(req, res) {
    try {
      const userId = req.params.id;

      const [userRows] = await pool.query(
        `SELECT id, name, email, phone, country, state, city, age_group, gender, avatar_path,
                subscription_type, wallet_balance, platform, device_type, is_blocked, blocked_at, last_login_at, created_at
         FROM users WHERE id = ? LIMIT 1`,
        [userId]
      );

      if (userRows.length === 0) {
        return ApiResponse.error(res, 'User not found.', 444);
      }

      const user = userRows[0];

      // Fetch recent transactions
      const [transactions] = await pool.query(
        'SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
        [userId]
      );

      // Fetch unlocked episodes
      const [unlocks] = await pool.query(
        `SELECT ue.*, e.title as episode_title, s.title as story_title
         FROM user_episode_unlocks ue
         LEFT JOIN episodes e ON ue.episode_id = e.id
         LEFT JOIN stories s ON e.story_id = s.id
         WHERE ue.user_id = ? ORDER BY ue.unlocked_at DESC LIMIT 10`,
        [userId]
      );

      return ApiResponse.success(res, {
        user,
        recent_transactions: transactions,
        unlocked_episodes: unlocks,
      });
    } catch (error) {
      console.error('Admin Get User Details Error:', error);
      return ApiResponse.error(res, 'Failed to fetch user details.', 500);
    }
  }

  /**
   * PUT /api/v1/admin/users/:id
   * Update user profile, role, or block status
   */
  static async update(req, res) {
    try {
      const userId = req.params.id;
      const { name, email, phone, subscription_type, is_blocked } = req.body;

      const [userRows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
      if (userRows.length === 0) {
        return ApiResponse.error(res, 'User not found.', 444);
      }

      const updateFields = [];
      const queryParams = [];

      if (name) {
        updateFields.push('`name` = ?');
        queryParams.push(name.trim());
      }
      if (email) {
        updateFields.push('`email` = ?');
        queryParams.push(email.trim());
      }
      if (phone) {
        updateFields.push('`phone` = ?');
        queryParams.push(phone.trim());
      }
      if (subscription_type) {
        updateFields.push('`subscription_type` = ?');
        queryParams.push(subscription_type);
      }
      if (is_blocked !== undefined) {
        const blockVal = is_blocked === 1 || is_blocked === '1' || is_blocked === true;
        updateFields.push('`is_blocked` = ?');
        queryParams.push(blockVal ? 1 : 0);
        if (blockVal) {
          updateFields.push('`blocked_at` = NOW()');
        } else {
          updateFields.push('`blocked_at` = NULL');
        }
      }

      if (updateFields.length > 0) {
        queryParams.push(userId);
        await pool.query(
          `UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
          queryParams
        );
      }

      const [updated] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
      return ApiResponse.success(res, { user: updated[0] }, 'User details updated successfully.');
    } catch (error) {
      console.error('Admin Update User Error:', error);
      return ApiResponse.error(res, 'Failed to update user details.', 500);
    }
  }

  /**
   * POST /api/v1/admin/users/:id/wallet
   * Credit or debit user wallet balance
   */
  static async updateWallet(req, res) {
    try {
      const userId = req.params.id;
      const { coins, type = 'credit', description } = req.body;

      const coinAmount = parseInt(coins, 10);
      if (isNaN(coinAmount) || coinAmount <= 0) {
        return ApiResponse.error(res, 'Valid coin amount is required.', 422);
      }

      const [userRows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
      if (userRows.length === 0) {
        return ApiResponse.error(res, 'User not found.', 444);
      }

      const currentBalance = Number(userRows[0].wallet_balance || 0);
      let newBalance = currentBalance;

      if (type === 'credit') {
        newBalance += coinAmount;
      } else {
        newBalance = Math.max(0, currentBalance - coinAmount);
      }

      await pool.query('UPDATE users SET wallet_balance = ? WHERE id = ?', [newBalance, userId]);

      // Record transaction log
      await pool.query(
        'INSERT INTO coin_transactions (user_id, type, coins, description) VALUES (?, ?, ?, ?)',
        [
          userId,
          type === 'credit' ? 'credit' : 'debit',
          coinAmount,
          description || (type === 'credit' ? 'Admin credited wallet' : 'Admin debited wallet'),
        ]
      );

      return ApiResponse.success(
        res,
        { user_id: Number(userId), new_balance: newBalance },
        `User wallet ${type === 'credit' ? 'credited' : 'debited'} successfully.`
      );
    } catch (error) {
      console.error('Admin Wallet Update Error:', error);
      return ApiResponse.error(res, 'Failed to update user wallet balance.', 500);
    }
  }
}

module.exports = UserController;
