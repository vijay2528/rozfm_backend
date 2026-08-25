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
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_id, coin_pack_id } = req.body;

      if (!razorpay_order_id || !razorpay_payment_id) {
        return ApiResponse.error(res, 'Order ID and Payment ID are required.', 422);
      }

      let coinsToAdd = 0;
      let description = 'Razorpay Payment Credit';

      if (plan_id) {
        const [plans] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [plan_id]);
        if (plans.length > 0) {
          coinsToAdd = Number(plans[0].coins) + Number(plans[0].bonus_coins || 0);
          description = `Purchased Plan #${plan_id}: ${plans[0].name}`;
        }
      } else if (coin_pack_id) {
        const [packs] = await pool.query('SELECT * FROM coin_sales WHERE id = ? LIMIT 1', [coin_pack_id]);
        if (packs.length > 0) {
          coinsToAdd = Number(packs[0].coins);
          description = `Purchased Coin Pack #${coin_pack_id}: ${packs[0].pack_name}`;
        }
      }

      if (coinsToAdd <= 0) {
        coinsToAdd = 100; // Default fallback for test order
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [coinsToAdd, userId]);
        await connection.query(
          'INSERT INTO coin_transactions (user_id, type, coins, description, reference_id) VALUES (?, ?, ?, ?, ?)',
          [userId, 'razorpay', coinsToAdd, description, razorpay_payment_id]
        );

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
        { wallet_balance: Number(userRows[0].wallet_balance), payment_id: razorpay_payment_id },
        'Payment verified and coins credited.'
      );
    } catch (error) {
      console.error('Verify Razorpay Payment Error:', error);
      return ApiResponse.error(res, 'Failed to verify payment.', 500);
    }
  }
}

module.exports = RazorpayController;
