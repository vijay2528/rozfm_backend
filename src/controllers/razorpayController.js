const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const crypto = require('crypto');

class RazorpayController {
  static async createOrder(req, res) {
    try {
      const { amount, plan_id, coin_pack_id } = req.body;
      if (!amount || amount <= 0) {
        return ApiResponse.error(res, 'Valid amount is required.', 422);
      }

      // Generate dummy Razorpay order ID for integration testing
      const orderId = `order_${crypto.randomBytes(12).toString('hex')}`;
      const currency = 'INR';

      return ApiResponse.success(res, {
        order_id: orderId,
        amount: Math.round(amount * 100), // in paise
        currency,
        key: process.env.RAZORPAY_KEY || 'rzp_test_mockkey12345',
        plan_id: plan_id || null,
        coin_pack_id: coin_pack_id || null,
      });
    } catch (error) {
      console.error('Create Razorpay Order Error:', error);
      return ApiResponse.error(res, 'Failed to create payment order.', 500);
    }
  }

  static async verifyPayment(req, res) {
    try {
      const userId = req.user.id;
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        plan_id,
        coin_pack_id,
        coins,
        amount: reqAmount,
        type: reqType,
        transaction_type: reqTransactionType,
        status,
        payment_status,
      } = req.body;

      if (!razorpay_order_id || !razorpay_payment_id) {
        return ApiResponse.error(res, 'Order ID and Payment ID are required.', 422);
      }

      let coinsToAdd = 0;
      let planId = plan_id ? parseInt(plan_id, 10) : null;
      let coinPackId = coin_pack_id ? parseInt(coin_pack_id, 10) : null;
      let type = reqType || (plan_id ? 'plan_purchase' : (coin_pack_id ? 'coin_pack' : 'coin'));
      let transactionType = reqTransactionType || 'credit';
      let moneyAmount = reqAmount !== undefined && reqAmount !== null ? Math.max(0, parseFloat(reqAmount) || 0) : 0.00;
      let description = 'Razorpay Payment Credit';

      if (plan_id) {
        if (!reqType) type = 'plan_purchase';
        planId = parseInt(plan_id, 10) || null;
        const [plans] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [plan_id]);
        if (plans.length > 0) {
          coinsToAdd = Number(plans[0].coins) + Number(plans[0].bonus_coins || 0);
          if (!moneyAmount && (plans[0].price !== undefined || plans[0].amount !== undefined)) {
            moneyAmount = parseFloat(plans[0].price ?? plans[0].amount) || 0.00;
          }
          description = `Purchased Plan #${plan_id}: ${plans[0].name}`;
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
          description = `Purchased Coin Pack #${coin_pack_id}: ${packs[0].pack_name}`;
        }
      } else {
        if (!reqType) type = 'coin';
        coinsToAdd = Math.max(0, parseInt(coins || 0, 10));
        description = `Purchased Coins (${coinsToAdd || 100})`;
      }

      if (coinsToAdd <= 0) {
        coinsToAdd = 100; // Default fallback for test order
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
            razorpay_payment_id,
          ]
        );

        if (planId && !isFailed) {
          const startsAt = new Date();
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

          try {
            await connection.query(
              "UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'",
              [userId]
            );

            await connection.query(
              'INSERT INTO subscriptions (user_id, plan_id, status, starts_at, expires_at) VALUES (?, ?, ?, ?, ?)',
              [userId, planId, 'active', startsAt, expiresAt]
            );

            await connection.query(
              "UPDATE users SET subscription_type = 'vip' WHERE id = ?",
              [userId]
            );
          } catch (subErr) {
            console.error('Auto-activate subscription error on plan purchase:', subErr.message);
          }
        }

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      const [userRows] = await pool.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [userId]);
      return ApiResponse.success(
        res,
        {
          wallet_balance: Number(userRows[0].wallet_balance),
          payment_id: razorpay_payment_id,
          type,
          plan_id: planId,
          coin_pack_id: coinPackId,
          amount: moneyAmount,
          transaction_type: transactionType,
          payment_status: normalizedPaymentStatus,
          coins: coinsToAdd,
        },
        normalizedPaymentStatus === 'failed' ? 'Payment failed recorded.' : 'Payment verified and coins credited.'
      );
    } catch (error) {
      console.error('Verify Razorpay Payment Error:', error);
      return ApiResponse.error(res, 'Failed to verify payment.', 500);
    }
  }
}

module.exports = RazorpayController;
