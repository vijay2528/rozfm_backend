const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class WalletController {
  static async show(req, res) {
    try {
      const [userRows] = await pool.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [req.user.id]);
      const balance = Number(userRows[0]?.wallet_balance || 0);

      return ApiResponse.success(res, { wallet_balance: balance });
    } catch (error) {
      console.error('Get Wallet Error:', error);
      return ApiResponse.error(res, 'Failed to fetch wallet details.', 500);
    }
  }

  static async purchase(req, res) {
    try {
      const userId = req.user.id;
      const { plan_id, coin_pack_id } = req.body;

      let coinsToAdd = 0;
      let description = 'Coin Purchase';

      if (plan_id) {
        const [plans] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [plan_id]);
        if (plans.length > 0) {
          coinsToAdd = Number(plans[0].coins) + Number(plans[0].bonus_coins || 0);
          description = `Purchased Plan: ${plans[0].name}`;
        }
      } else if (coin_pack_id) {
        const [packs] = await pool.query('SELECT * FROM coin_sales WHERE id = ? LIMIT 1', [coin_pack_id]);
        if (packs.length > 0) {
          coinsToAdd = Number(packs[0].coins);
          description = `Purchased Coin Pack: ${packs[0].pack_name}`;
        }
      }

      if (coinsToAdd <= 0) {
        return ApiResponse.error(res, 'Invalid purchase plan or pack.', 422);
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [coinsToAdd, userId]);
        await connection.query(
          'INSERT INTO coin_transactions (user_id, type, coins, description) VALUES (?, ?, ?, ?)',
          [userId, 'purchase', coinsToAdd, description]
        );

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      const [updatedUser] = await pool.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [userId]);
      return ApiResponse.success(
        res,
        { wallet_balance: Number(updatedUser[0].wallet_balance) },
        'Coins credited successfully.'
      );
    } catch (error) {
      console.error('Purchase Coins Error:', error);
      return ApiResponse.error(res, 'Failed to purchase coins.', 500);
    }
  }

  static async dailyClaimStatus(req, res) {
    try {
      const userId = req.user.id;
      const [claimedToday] = await pool.query(
        `SELECT id FROM coin_transactions
         WHERE user_id = ? AND type = 'daily_reward' AND DATE(created_at) = CURDATE()
         LIMIT 1`,
        [userId]
      );

      const canClaim = claimedToday.length === 0;
      return ApiResponse.success(res, { can_claim: canClaim, reward_coins: 10 });
    } catch (error) {
      console.error('Daily Claim Status Error:', error);
      return ApiResponse.error(res, 'Failed to check daily claim status.', 500);
    }
  }

  static async dailyClaim(req, res) {
    try {
      const userId = req.user.id;
      const [claimedToday] = await pool.query(
        `SELECT id FROM coin_transactions
         WHERE user_id = ? AND type = 'daily_reward' AND DATE(created_at) = CURDATE()
         LIMIT 1`,
        [userId]
      );

      if (claimedToday.length > 0) {
        return ApiResponse.error(res, 'Daily reward already claimed today.', 422);
      }

      const rewardCoins = 10;
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [rewardCoins, userId]);
        await connection.query(
          'INSERT INTO coin_transactions (user_id, type, coins, description) VALUES (?, ?, ?, ?)',
          [userId, 'daily_reward', rewardCoins, 'Daily Claim Bonus Coins']
        );

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      const [updatedUser] = await pool.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [userId]);
      return ApiResponse.success(
        res,
        { wallet_balance: Number(updatedUser[0].wallet_balance), claimed_coins: rewardCoins },
        'Daily reward claimed successfully.'
      );
    } catch (error) {
      console.error('Daily Claim Error:', error);
      return ApiResponse.error(res, 'Failed to claim daily reward.', 500);
    }
  }

  static async transactions(req, res) {
    try {
      const userId = req.user.id;
      const [transactions] = await pool.query(
        'SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
      );

      return ApiResponse.success(res, { transactions });
    } catch (error) {
      console.error('List Transactions Error:', error);
      return ApiResponse.error(res, 'Failed to fetch coin transactions.', 500);
    }
  }
}

module.exports = WalletController;
