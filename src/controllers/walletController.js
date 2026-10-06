const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

class WalletController {
  static async show(req, res) {
    try {
      const userId = req.user.id;

      const [userRows] = await pool.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [userId]);
      const balance = Number(userRows[0]?.wallet_balance || 0);

      // Aggregate spent and earned coins from coin_transactions
      const debitTypes = ['spend', 'debit', 'unlock', 'withdrawal', 'spent', 'admin_debit'];
      const [txRows] = await pool.query(
        'SELECT type, coins FROM coin_transactions WHERE user_id = ?',
        [userId]
      );

      let totalEarned = 0;
      let totalSpent = 0;
      txRows.forEach((tx) => {
        const coinVal = Math.abs(Number(tx.coins || 0));
        const isDebit = debitTypes.includes(String(tx.type || '').toLowerCase()) || Number(tx.coins || 0) < 0;
        if (isDebit) {
          totalSpent += coinVal;
        } else {
          totalEarned += coinVal;
        }
      });

      return ApiResponse.success(res, {
        wallet_balance: balance,
        total_earned_coins: totalEarned,
        total_purchased_coins: totalSpent,
      });
    } catch (error) {
      console.error('Get Wallet Error:', error);
      return ApiResponse.error(res, 'Failed to fetch wallet details.', 500);
    }
  }

  static async purchase(req, res) {
    try {
      const userId = req.user.id;
      const {
        plan_id,
        coin_pack_id,
        coins,
        amount: reqAmount,
        type: reqType,
        transaction_type: reqTransactionType,
        payment_status,
        status,
        reference_id,
      } = req.body;

      let coinsToAdd = 0;
      let planId = plan_id ? parseInt(plan_id, 10) : null;
      let coinPackId = coin_pack_id ? parseInt(coin_pack_id, 10) : null;
      let type = reqType || (plan_id ? 'plan_purchase' : (coin_pack_id ? 'coin_pack' : 'coin'));
      let transactionType = reqTransactionType || 'credit';
      let moneyAmount = reqAmount !== undefined && reqAmount !== null ? Math.max(0, parseFloat(reqAmount) || 0) : 0.00;
      let description = 'Coin Purchase';

      if (plan_id) {
        if (!reqType) type = 'plan_purchase';
        planId = parseInt(plan_id, 10) || null;
        const [plans] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [plan_id]);
        if (plans.length > 0) {
          coinsToAdd = Number(plans[0].coins) + Number(plans[0].bonus_coins || 0);
          if (!moneyAmount && (plans[0].price !== undefined || plans[0].amount !== undefined)) {
            moneyAmount = parseFloat(plans[0].price ?? plans[0].amount) || 0.00;
          }
          description = `Purchased Plan: ${plans[0].name}`;
        }
      } else if (coin_pack_id) {
        if (!reqType) type = 'coin_pack';
        coinPackId = parseInt(coin_pack_id, 10) || null;
        const [packs] = await pool.query('SELECT * FROM coin_sales WHERE id = ? LIMIT 1', [coin_pack_id]);
        if (packs.length > 0) {
          coinsToAdd = Number(packs[0].coins || 0) + Number(packs[0].bonus || 0);
          if (!moneyAmount && (packs[0].amount !== undefined || packs[0].price !== undefined)) {
            moneyAmount = parseFloat(packs[0].amount ?? packs[0].price) || 0.00;
          }
          description = `Purchased Coin Pack: ${packs[0].pack_name}`;
        }
      } else if (coins) {
        if (!reqType) type = 'coin';
        coinsToAdd = Math.max(0, parseInt(coins, 10) || 0);
        description = `Purchased Coins: ${coinsToAdd}`;
      }

      if (coinsToAdd <= 0) {
        return ApiResponse.error(res, 'Invalid purchase plan or pack.', 422);
      }

      const rawStatus = String(payment_status || status || 'paid').toLowerCase().trim();
      const isFailed = rawStatus === 'failed' || rawStatus === 'faild';
      const normalizedPaymentStatus = isFailed ? 'failed' : 'paid';

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        if (!isFailed) {
          await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [coinsToAdd, userId]);
        }

        await connection.query(
          `INSERT INTO coin_transactions 
           (user_id, type, coins, plan_id, coin_pack_id, amount, transaction_type, payment_status, description, reference_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            type,
            coinsToAdd,
            planId,
            coinPackId,
            moneyAmount,
            transactionType,
            normalizedPaymentStatus,
            description,
            reference_id || null,
          ]
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
        {
          wallet_balance: Number(updatedUser[0].wallet_balance),
          type,
          plan_id: planId,
          coin_pack_id: coinPackId,
          amount: moneyAmount,
          transaction_type: transactionType,
          payment_status: normalizedPaymentStatus,
          coins: coinsToAdd,
        },
        normalizedPaymentStatus === 'failed' ? 'Failed purchase recorded.' : 'Coins credited successfully.'
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
          `INSERT INTO coin_transactions 
           (user_id, type, coins, plan_id, coin_pack_id, amount, transaction_type, payment_status, description) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, 'daily_reward', rewardCoins, null, null, 0.00, 'credit', 'paid', 'Daily Claim Bonus Coins']
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

      const debitTypes = ['spend', 'debit', 'unlock', 'withdrawal', 'spent', 'admin_debit'];

      let totalEarned = 0;
      let totalSpent = 0;

      const formattedTransactions = transactions.map((tx) => {
        const coinVal = Math.abs(Number(tx.coins || 0));
        const isDebit = tx.transaction_type
          ? String(tx.transaction_type).toLowerCase() === 'debit'
          : (debitTypes.includes(String(tx.type || '').toLowerCase()) || Number(tx.coins || 0) < 0);

        if (isDebit) {
          totalSpent += coinVal;
        } else {
          totalEarned += coinVal;
        }

        const transactionType = tx.transaction_type || (isDebit ? 'debit' : 'credit');

        return {
          id: tx.id,
          user_id: tx.user_id,
          type: tx.type,
          plan_id: tx.plan_id ? Number(tx.plan_id) : null,
          coin_pack_id: tx.coin_pack_id ? Number(tx.coin_pack_id) : null,
          amount: Number(tx.amount || 0),
          transaction_type: transactionType,
          payment_status: tx.payment_status || 'paid',
          coins: Number(tx.coins || 0),
          description: tx.description,
          reference_id: tx.reference_id,
          created_at: tx.created_at,
        };
      });

      return ApiResponse.success(
        res,
        {
          total_earned: totalEarned,
          transactions: formattedTransactions,
        },
        'Coin transactions fetched successfully.'
      );
    } catch (error) {
      console.error('List Transactions Error:', error);
      return ApiResponse.error(res, 'Failed to fetch coin transactions.', 500);
    }
  }
}

module.exports = WalletController;
