const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const CoinPackController = require('./coinPackController');

class PurchaseController {
  /**
   * POST /api/purchases/verify
   * POST /api/v1/purchases/verify
   * POST /api/v1/payments/google-play/verify
   *
   * Verifies Google Play In-App (coin pack) or Subscription purchase.
   *
   * Body parameters:
   *   - product_id (string, required): e.g. 'rozfm_starter_49', 'roz_pass', 'roz_saver', 'roz_premium'
   *   - purchase_token (string, required): Google Play purchase token
   *   - purchase_type (string, optional): 'inapp' (coin pack) or 'subs' (subscription). Auto-detected if omitted.
   *   - order_id (string, optional): Google Play Order ID, e.g. 'GPA.xxxx-xxxx-xxxx-xxxxx'
   *   - base_plan_id (string, optional): Base plan ID for subscriptions, e.g. 'monthly', 'six-month', 'yearly'
   *   - package_name (string, optional): Android application package name
   */
  static async verify(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponse.error(res, 'Authentication required.', 401);
      }

      const {
        product_id: bodyProductId,
        productId,
        purchase_token: bodyPurchaseToken,
        purchaseToken,
        purchase_type: bodyPurchaseType,
        purchaseType,
        order_id: bodyOrderId,
        orderId,
        base_plan_id: bodyBasePlanId,
        basePlanId,
        package_name: bodyPackageName,
        packageName,
      } = req.body;

      const prodId = (bodyProductId || productId || '').trim();
      const token = (bodyPurchaseToken || purchaseToken || '').trim();
      let type = (bodyPurchaseType || purchaseType || '').trim().toLowerCase();
      const ordId = (bodyOrderId || orderId || '').trim();
      const basePlan = (bodyBasePlanId || basePlanId || '').trim();
      const pkgName = (bodyPackageName || packageName || '').trim();

      if (!prodId || !token) {
        return ApiResponse.error(res, 'product_id and purchase_token are required.', 422);
      }

      const referenceId = ordId || token;

      // ── 1. Idempotency Check: Prevent duplicate credit for the same purchase ──
      const [existingTx] = await pool.query(
        'SELECT id, type, payment_status, coins, amount FROM coin_transactions WHERE reference_id = ? AND payment_status = "paid" LIMIT 1',
        [referenceId]
      );

      if (existingTx.length > 0) {
        // Fetch current user wallet and subscription
        const [userRows] = await pool.query('SELECT wallet_balance, subscription_type FROM users WHERE id = ? LIMIT 1', [userId]);
        const user = userRows[0] || {};

        return ApiResponse.success(res, {
          already_verified: true,
          type: existingTx[0].type,
          product_id: prodId,
          order_id: ordId || null,
          wallet_balance: Number(user.wallet_balance || 0),
          subscription_type: user.subscription_type || 'free',
        }, 'Purchase already verified and applied.');
      }

      // ── 2. Determine whether it is a Coin Pack ('inapp') or Subscription ('subs') ──
      let coinPack = null;
      let subscriptionPlan = null;

      // If type not explicitly specified, search coin_sales first, then purchase_plans
      if (!type || type === 'inapp') {
        const [cpRows] = await pool.query(
          'SELECT * FROM coin_sales WHERE product_id = ? OR pack_name = ? LIMIT 1',
          [prodId, prodId]
        );
        if (cpRows.length > 0) {
          coinPack = cpRows[0];
          type = 'inapp';
        }
      }

      if (!coinPack && (!type || type === 'subs' || type === 'subscription')) {
        let subQuery = 'SELECT * FROM purchase_plans WHERE product_id = ?';
        const subParams = [prodId];

        if (basePlan) {
          subQuery += ' AND base_plan_id = ?';
          subParams.push(basePlan);
        }
        subQuery += ' ORDER BY is_active DESC LIMIT 1';

        const [spRows] = await pool.query(subQuery, subParams);
        if (spRows.length > 0) {
          subscriptionPlan = spRows[0];
          type = 'subs';
        }
      }

      // If still not identified, fallback to coin pack check or subscription check
      if (!coinPack && !subscriptionPlan) {
        // Check if prodId contains 'pass', 'premium', or 'saver' -> subs, else inapp
        if (prodId.includes('pass') || prodId.includes('premium') || prodId.includes('saver')) {
          const [spRows] = await pool.query('SELECT * FROM purchase_plans WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
          if (spRows.length > 0) {
            subscriptionPlan = spRows[0];
            type = 'subs';
          }
        } else {
          const [cpRows] = await pool.query('SELECT * FROM coin_sales WHERE status = 1 ORDER BY id ASC LIMIT 1');
          if (cpRows.length > 0) {
            coinPack = cpRows[0];
            type = 'inapp';
          }
        }
      }

      // ── One-Time Welcome Offer Restriction ──
      const isWelcome = CoinPackController.isWelcomePack(coinPack) ||
        (subscriptionPlan && CoinPackController.isWelcomePack(subscriptionPlan));

      if (isWelcome) {
        const welcomePurchased = await CoinPackController.hasPurchasedWelcomeOffer(userId);
        if (welcomePurchased) {
          return ApiResponse.error(
            res,
            'You have already purchased the Welcome Offer. This offer can only be purchased once per account.',
            400
          );
        }
      }

      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        // ── Case A: Coin Pack Purchase (inapp) ──
        if (type === 'inapp' && coinPack) {
          const coinsToAdd = Number(coinPack.coins || 0) + Number(coinPack.bonus || 0);
          const amountVal = parseFloat(coinPack.amount || 0);
          const packName = coinPack.pack_name || 'Coin Pack';

          // 1. Credit wallet
          if (coinsToAdd > 0) {
            await connection.query(
              'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
              [coinsToAdd, userId]
            );
          }

          // 2. Record coin transaction
          const [txResult] = await connection.query(
            `INSERT INTO coin_transactions 
             (user_id, type, coins, coin_pack_id, amount, transaction_type, payment_status, payment_method, description, reference_id)
             VALUES (?, 'coin_pack', ?, ?, ?, 'credit', 'paid', 'google_play', ?, ?)`,
            [
              userId,
              coinsToAdd,
              coinPack.id,
              amountVal,
              `Google Play Purchase: ${packName}`,
              referenceId,
            ]
          );

          await connection.commit();
          connection.release();

          // 3. Get updated wallet balance
          const [userRows] = await pool.query('SELECT wallet_balance FROM users WHERE id = ? LIMIT 1', [userId]);
          const newBalance = Number(userRows[0]?.wallet_balance || 0);

          return ApiResponse.success(res, {
            type: 'inapp',
            product_id: coinPack.product_id || prodId,
            pack_name: packName,
            coins_added: coinsToAdd,
            wallet_balance: newBalance,
            order_id: ordId || null,
            transaction_id: txResult.insertId,
          }, `${coinsToAdd} coins added to your wallet successfully.`);
        }

        // ── Case B: Subscription Plan Purchase (subs) ──
        if (subscriptionPlan) {
          const durationDays = Number(subscriptionPlan.duration_days || 30);
          const planAmount = parseFloat(subscriptionPlan.price || subscriptionPlan.amount || 0);
          const planName = subscriptionPlan.name || 'VIP Membership';

          const startsAt = new Date();
          const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

          // 1. Expire existing active subscriptions
          await connection.query(
            "UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'",
            [userId]
          );

          // 2. Insert new active subscription
          const [subResult] = await connection.query(
            'INSERT INTO subscriptions (user_id, plan_id, status, starts_at, expires_at) VALUES (?, ?, "active", ?, ?)',
            [userId, subscriptionPlan.id, startsAt, expiresAt]
          );

          // 3. Update user subscription type to 'vip'
          await connection.query(
            "UPDATE users SET subscription_type = 'vip' WHERE id = ?",
            [userId]
          );

          // 4. Record transaction in coin_transactions
          await connection.query(
            `INSERT INTO coin_transactions 
             (user_id, type, coins, plan_id, amount, transaction_type, payment_status, payment_method, description, reference_id)
             VALUES (?, 'subscription', 0, ?, ?, 'debit', 'paid', 'google_play', ?, ?)`,
            [
              userId,
              subscriptionPlan.id,
              planAmount,
              `Google Play Subscription: ${planName}`,
              referenceId,
            ]
          );

          await connection.commit();
          connection.release();

          return ApiResponse.success(res, {
            type: 'subs',
            product_id: subscriptionPlan.product_id || prodId,
            base_plan_id: subscriptionPlan.base_plan_id || null,
            plan_name: planName,
            subscription_type: 'vip',
            subscription: {
              id: subResult.insertId,
              plan_id: subscriptionPlan.id,
              status: 'active',
              starts_at: startsAt.toISOString(),
              expires_at: expiresAt.toISOString(),
              duration_days: durationDays,
            },
            order_id: ordId || null,
          }, `${planName} subscription activated successfully.`);
        }

        connection.release();
        return ApiResponse.error(res, `Unknown product: ${prodId}. No matching plan or coin pack found.`, 404);
      } catch (txError) {
        await connection.rollback();
        connection.release();
        throw txError;
      }
    } catch (error) {
      console.error('Google Play Purchase Verification Error:', error);
      return ApiResponse.error(res, 'Failed to verify Google Play purchase.', 500);
    }
  }
}

module.exports = PurchaseController;
