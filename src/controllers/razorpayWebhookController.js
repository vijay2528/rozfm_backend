const { pool } = require('../config/db');
const crypto   = require('crypto');

/**
 * RazorpayWebhookController
 *
 * Handles Razorpay Webhook events for subscription auto-renewal.
 *
 * Set this URL in Razorpay Dashboard → Settings → Webhooks:
 *   https://your-domain.com/api/v1/webhook/razorpay
 *
 * Events to enable in Razorpay Dashboard:
 *   - subscription.charged    (auto-renewal success)
 *   - subscription.cancelled  (user/admin cancelled)
 *   - subscription.completed  (all cycles done)
 *   - payment.failed          (renewal failed)
 */
class RazorpayWebhookController {
  static async handle(req, res) {
    try {
      // ── 1. Verify Webhook Signature ───────────────────────────────────────
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || null;

      if (webhookSecret) {
        const razorpaySignature = req.headers['x-razorpay-signature'];
        const body              = req.rawBody || JSON.stringify(req.body); // raw body needed for HMAC

        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(body)
          .digest('hex');

        if (expectedSignature !== razorpaySignature) {
          console.error('❌ Razorpay Webhook signature mismatch!');
          return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
        }
        console.log('✅ Razorpay Webhook signature verified.');
      } else {
        console.warn('⚠️  RAZORPAY_WEBHOOK_SECRET not set — skipping signature verification.');
      }

      const event   = req.body?.event;
      const payload = req.body?.payload;

      console.log(`📨 Razorpay Webhook received: ${event}`);

      // ── 2. Route Events ───────────────────────────────────────────────────
      switch (event) {
        case 'subscription.charged':
          await RazorpayWebhookController.handleSubscriptionCharged(payload);
          break;

        case 'subscription.cancelled':
          await RazorpayWebhookController.handleSubscriptionCancelled(payload);
          break;

        case 'subscription.completed':
          await RazorpayWebhookController.handleSubscriptionCompleted(payload);
          break;

        case 'payment.failed':
          await RazorpayWebhookController.handlePaymentFailed(payload);
          break;

        default:
          console.log(`ℹ️  Unhandled Razorpay webhook event: ${event}`);
      }

      // Always respond 200 so Razorpay doesn't retry
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Razorpay Webhook Error:', error);
      return res.status(200).json({ success: true }); // still 200 to avoid retries
    }
  }

  /**
   * subscription.charged — auto-renewal payment success
   * Extends the user's subscription by another billing cycle.
   */
  static async handleSubscriptionCharged(payload) {
    try {
      const subscription = payload?.subscription?.entity;
      const payment      = payload?.payment?.entity;

      if (!subscription) { console.error('❌ No subscription entity in payload'); return; }

      const razorpaySubId  = subscription.id;
      const paymentId      = payment?.id || null;
      const amountPaise    = payment?.amount || 0;
      const amountINR      = amountPaise / 100;

      console.log(`💰 Subscription charged: ${razorpaySubId} | Payment: ${paymentId} | Amount: ₹${amountINR}`);

      // Find local subscription
      const [subRows] = await pool.query(
        "SELECT * FROM subscriptions WHERE razorpay_subscription_id = ? ORDER BY id DESC LIMIT 1",
        [razorpaySubId]
      ).catch(() => [[]]);

      if (!subRows || subRows.length === 0) {
        console.error(`❌ No subscription found for razorpay_subscription_id: ${razorpaySubId}`);
        return;
      }

      const sub        = subRows[0];
      const userId     = sub.user_id;
      let   billingCycle = sub.billing_cycle || 'monthly';

      // Idempotency: payment already logged (by /verify or an earlier webhook retry)
      if (paymentId) {
        const [dup] = await pool.query(
          'SELECT id FROM coin_transactions WHERE reference_id = ? LIMIT 1',
          [paymentId]
        ).catch(() => [[]]);
        if (dup && dup.length) {
          console.log(`ℹ️  Payment ${paymentId} already processed — skipping.`);
          return;
        }
      }

      // Trial → paid: first recurring charge after trial moves user to the renew (3-month) plan
      const notes = subscription.notes || {};
      if (billingCycle === 'trial' && notes.renew_plan_id) {
        sub.plan_id  = Number(notes.renew_plan_id);
        billingCycle = notes.renew_billing_cycle || 'quarterly';
        await pool.query(
          'UPDATE subscriptions SET plan_id = ?, billing_cycle = ? WHERE id = ?',
          [sub.plan_id, billingCycle, sub.id]
        ).catch((e) => console.error('Trial→paid switch failed:', e.message));
        console.log(`🔁 Trial ended → user ${userId} moved to plan #${sub.plan_id} (${billingCycle})`);
      }

      const DAY = 24 * 60 * 60 * 1000;
      const cycleDays = billingCycle === 'yearly' ? 365 : billingCycle === 'quarterly' ? 90 : 30;

      // Prefer Razorpay's own period end (unix seconds); fallback to cycle-based extension
      let newExpiresAt;
      if (subscription.current_end) {
        newExpiresAt = new Date(subscription.current_end * 1000);
      } else {
        const currentExpiry = sub.expires_at ? new Date(sub.expires_at) : new Date();
        const baseDate      = currentExpiry > new Date() ? currentExpiry : new Date();
        newExpiresAt        = new Date(baseDate.getTime() + cycleDays * DAY);
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Extend subscription
        await connection.query(
          "UPDATE subscriptions SET status = 'active', expires_at = ?, updated_at = NOW() WHERE id = ?",
          [newExpiresAt, sub.id]
        );

        // Ensure user is VIP
        await connection.query(
          "UPDATE users SET subscription_type = 'vip' WHERE id = ?",
          [userId]
        );

        // Log renewal transaction
        let planCoins = 0;
        if (sub.plan_id) {
          const [planRows] = await pool.query('SELECT coins, bonus_coins, name FROM purchase_plans WHERE id = ? LIMIT 1', [sub.plan_id]);
          if (planRows && planRows[0]) {
            planCoins = Number(planRows[0].coins || 0) + Number(planRows[0].bonus_coins || 0);
            if (planCoins > 0) {
              await connection.query(
                'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
                [planCoins, userId]
              );
            }
          }
        }

        await connection.query(
          `INSERT INTO coin_transactions 
           (user_id, type, coins, plan_id, amount, transaction_type, payment_status, description, reference_id)
           VALUES (?, 'plan_renewal', ?, ?, ?, 'credit', 'paid', ?, ?)`,
          [userId, planCoins, sub.plan_id || null, amountINR, `Auto-renewal (${billingCycle})`, paymentId]
        );

        await connection.commit();
        console.log(`✅ Subscription renewed for user ${userId} until ${newExpiresAt.toISOString()}`);
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error('handleSubscriptionCharged error:', err);
    }
  }

  /**
   * subscription.cancelled — subscription was cancelled
   */
  static async handleSubscriptionCancelled(payload) {
    try {
      const subscription  = payload?.subscription?.entity;
      if (!subscription) return;
      const razorpaySubId = subscription.id;

      await pool.query(
        "UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE razorpay_subscription_id = ? AND status = 'active'",
        [razorpaySubId]
      ).catch(() => {});

      console.log(`🚫 Subscription cancelled on Razorpay: ${razorpaySubId}`);
    } catch (err) {
      console.error('handleSubscriptionCancelled error:', err);
    }
  }

  /**
   * subscription.completed — all renewal cycles exhausted
   */
  static async handleSubscriptionCompleted(payload) {
    try {
      const subscription  = payload?.subscription?.entity;
      if (!subscription) return;
      const razorpaySubId = subscription.id;

      await pool.query(
        "UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE razorpay_subscription_id = ? AND status = 'active'",
        [razorpaySubId]
      ).catch(() => {});

      console.log(`✔️  Subscription completed (all cycles done): ${razorpaySubId}`);
    } catch (err) {
      console.error('handleSubscriptionCompleted error:', err);
    }
  }

  /**
   * payment.failed — renewal payment failed
   */
  static async handlePaymentFailed(payload) {
    try {
      const payment = payload?.payment?.entity;
      if (!payment) return;
      const subscriptionId = payment?.subscription_id || null;
      console.warn(`⚠️  Payment failed for subscription: ${subscriptionId} | Payment: ${payment.id}`);
      // You can notify the user here via push notification or email
    } catch (err) {
      console.error('handlePaymentFailed error:', err);
    }
  }
}

module.exports = RazorpayWebhookController;
