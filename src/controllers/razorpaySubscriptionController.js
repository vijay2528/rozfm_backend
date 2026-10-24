const { pool } = require('../config/db');
const crypto   = require('crypto');
const ApiResponse = require('../utils/apiResponse');
const RazorpaySubscriptionService = require('../services/razorpaySubscriptionService');

/**
 * Detect billing cycle and key amounts from a purchase_plan row.
 *
 * Rules (in priority order):
 *  1. Trial plan (is_trial = 1)        → billing_cycle = 'one_time' (no auto-renewal Subscription)
 *  2. duration_days >= 300             → billing_cycle = 'yearly'
 *  3. duration_days >= 60              → billing_cycle = 'quarterly'  (treated as monthly period × 3)
 *  4. monthly_amount > 0               → billing_cycle = 'monthly'
 *  5. yearly_amount > 0                → billing_cycle = 'yearly'
 *  6. Fallback                         → billing_cycle = 'monthly'
 *
 * If the caller already sent billing_cycle and it makes sense for the plan, we honour it.
 */
function detectBillingCycle(plan, requestedCycle) {
  const hasMonthly  = parseFloat(plan.monthly_amount || 0) > 0;
  const hasYearly   = parseFloat(plan.yearly_amount  || 0) > 0;
  const durationDays = parseInt(plan.duration_days   || 30);
  const isTrial     = Boolean(plan.is_trial) && parseInt(plan.trial_days || 0) > 0;

  // ── Trial plan: no recurring subscription ──────────────────────────────────
  if (isTrial) {
    return {
      billing_cycle: 'one_time',
      is_trial:      true,
      trial_days:    parseInt(plan.trial_days),
      duration_days: parseInt(plan.trial_days),
      amount_inr:    parseFloat(plan.price || 1),
      period:        null,   // not used for one_time
      renew_plan_id: plan.renew_plan_id || null,
    };
  }

  // ── Caller explicitly passed 'yearly' and plan supports it ────────────────
  if (requestedCycle === 'yearly' && (hasYearly || durationDays >= 300)) {
    const amount = parseFloat(plan.yearly_amount || plan.price || 0);
    return { billing_cycle: 'yearly', is_trial: false, duration_days: 365, amount_inr: amount, period: 'yearly' };
  }

  // ── Caller explicitly passed 'monthly' and plan supports it ───────────────
  if (requestedCycle === 'monthly' && (hasMonthly || durationDays <= 60)) {
    const amount = parseFloat(plan.monthly_amount || plan.price || 0);
    return { billing_cycle: 'monthly', is_trial: false, duration_days: durationDays || 30, amount_inr: amount, period: 'monthly' };
  }

  // ── Auto-detect from plan fields ──────────────────────────────────────────
  if (durationDays >= 300 || hasYearly) {
    const amount = parseFloat(plan.yearly_amount || plan.price || 0);
    return { billing_cycle: 'yearly', is_trial: false, duration_days: 365, amount_inr: amount, period: 'yearly' };
  }

  if (durationDays >= 60) {
    // Quarterly / multi-month: use monthly period in Razorpay
    const amount = parseFloat(plan.monthly_amount || plan.price || 0);
    return { billing_cycle: 'quarterly', is_trial: false, duration_days: durationDays, amount_inr: amount, period: 'monthly' };
  }

  // Default: monthly
  const amount = parseFloat(plan.monthly_amount || plan.price || 0);
  return { billing_cycle: 'monthly', is_trial: false, duration_days: durationDays || 30, amount_inr: amount, period: 'monthly' };
}

class RazorpaySubscriptionController {
  /**
   * POST /api/v1/plans/subscribe
   *
   * Body: { plan_id, billing_cycle?: 'monthly' | 'yearly' }
   *
   * Auto-detects billing cycle from plan fields if not provided.
   * Creates:
   *   - Trial plan     → Razorpay Order (one-time payment, no auto-renewal)
   *   - Regular plan   → Razorpay Subscription (auto-renewal)
   */
  static async createSubscription(req, res) {
    try {
      const userId       = req.user?.id;
      const { plan_id, billing_cycle: requestedCycle } = req.body;

      if (!plan_id) {
        return ApiResponse.error(res, 'plan_id is required.', 422);
      }

      // ── Fetch plan ────────────────────────────────────────────────────────
      const [planRows] = await pool.query(
        'SELECT * FROM purchase_plans WHERE id = ? AND (is_active = 1 OR status = 1) LIMIT 1',
        [plan_id]
      );
      if (!planRows || planRows.length === 0) {
        return ApiResponse.error(res, 'Plan not found or inactive.', 404);
      }
      const plan = planRows[0];

      // ── Detect billing cycle ──────────────────────────────────────────────
      const cycleInfo = detectBillingCycle(plan, requestedCycle);
      console.log(`📅 Plan #${plan_id} "${plan.name}" → billing_cycle: ${cycleInfo.billing_cycle}, amount: ₹${cycleInfo.amount_inr}, duration: ${cycleInfo.duration_days} days`);

      if (!cycleInfo.is_trial && (!cycleInfo.amount_inr || cycleInfo.amount_inr <= 0)) {
        return ApiResponse.error(res, 'This plan does not have a valid price.', 422);
      }

      // ── Fetch user details ────────────────────────────────────────────────
      const [userRows] = await pool.query('SELECT email, phone FROM users WHERE id = ? LIMIT 1', [userId]);
      const user = userRows?.[0] || {};

      // ── Fetch credentials ─────────────────────────────────────────────────
      const creds = await RazorpaySubscriptionService.getCredentials();
      if (!creds.isConfigured) {
        return ApiResponse.error(res, 'Razorpay payment keys are not configured.', 500);
      }

      // ── Trial plan: autopay subscription on the renew (3-month) plan ──────
      //   - Trial price charged now as an add-on (mandate authentication)
      //   - First 3-month charge happens automatically after trial_days (start_at)
      if (cycleInfo.is_trial) {
        const PlanController = require('./planController');
        if (await PlanController.hasUsedTrial(userId)) {
          return ApiResponse.error(res, 'You have already used your trial. Please choose another plan.', 422);
        }
        // Resolve renew plan: plan.renew_plan_id → else first active ~3-month plan
        let renewPlan = null;
        if (cycleInfo.renew_plan_id) {
          const [r] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [cycleInfo.renew_plan_id]);
          renewPlan = r?.[0] || null;
        }
        if (!renewPlan) {
          const [r] = await pool.query(
            `SELECT * FROM purchase_plans
             WHERE (is_trial = 0 OR is_trial IS NULL) AND duration_days BETWEEN 60 AND 120
               AND (is_active = 1 OR status = 1)
             ORDER BY duration_days ASC, id ASC LIMIT 1`
          );
          renewPlan = r?.[0] || null;
        }
        if (!renewPlan) {
          return ApiResponse.error(res, 'No 3-month plan configured to continue after the trial. Set renew_plan_id on the trial plan.', 422);
        }

        const renewCycle = detectBillingCycle(renewPlan, null);
        if (!renewCycle.amount_inr || renewCycle.amount_inr <= 0) {
          return ApiResponse.error(res, 'The renewal plan does not have a valid price.', 422);
        }

        const trialDays = cycleInfo.trial_days;
        const startAt   = Math.floor(Date.now() / 1000) + trialDays * 24 * 60 * 60;

        const result = await RazorpaySubscriptionService.createSubscription({
          userId,
          purchasePlan:      renewPlan,
          billingCycle:      renewCycle.billing_cycle,
          overrideAmountINR: renewCycle.amount_inr,
          userEmail:         user.email || null,
          userPhone:         user.phone || null,
          startAt,
          addonAmountINR:    cycleInfo.amount_inr,
          addonName:         `${plan.name} (${trialDays}-day trial)`,
          extraNotes: {
            is_trial:             '1',
            trial_plan_id:        plan.id,
            trial_days:           trialDays,
            renew_plan_id:        renewPlan.id,
            renew_billing_cycle:  renewCycle.billing_cycle,
          },
        });

        if (!result.success) {
          return ApiResponse.error(res, result.error || 'Failed to create trial subscription.', 422,
            result.details ? { razorpay: result.details } : null
          );
        }

        return ApiResponse.success(res, {
          type:               'subscription',
          subscription_id:    result.subscription_id,
          razorpay_key:       creds.keyId,
          short_url:          result.short_url,
          status:             result.status,
          plan_id:            Number(plan_id),
          plan_name:          plan.name,
          billing_cycle:      'trial',
          is_trial:           true,
          trial_days:         trialDays,
          amount:             cycleInfo.amount_inr,
          currency:           'INR',
          auto_renewal:       true,
          renew_plan: {
            id:            renewPlan.id,
            name:          renewPlan.name,
            billing_cycle: renewCycle.billing_cycle,
            amount:        renewCycle.amount_inr,
            first_charge_at: new Date(startAt * 1000).toISOString(),
          },
        }, `Trial for ${trialDays} days, then ${renewPlan.name} at ₹${renewCycle.amount_inr} auto-renews.`);
      }

      // ── Regular plan: create Razorpay Subscription ────────────────────────
      const result = await RazorpaySubscriptionService.createSubscription({
        userId,
        purchasePlan: plan,
        billingCycle: cycleInfo.billing_cycle,
        overrideAmountINR: cycleInfo.amount_inr,
        userEmail: user.email || null,
        userPhone: user.phone || null,
      });

      if (!result.success) {
        return ApiResponse.error(res, result.error || 'Failed to create subscription.', 422,
          result.details ? { razorpay: result.details } : null
        );
      }

      return ApiResponse.success(res, {
        type:             'subscription',
        subscription_id:  result.subscription_id,
        razorpay_key:     creds.keyId,
        short_url:        result.short_url,
        status:           result.status,
        plan_id:          Number(plan_id),
        plan_name:        plan.name,
        billing_cycle:    cycleInfo.billing_cycle,
        is_trial:         false,
        duration_days:    cycleInfo.duration_days,
        amount:           cycleInfo.amount_inr,
        currency:         'INR',
      }, 'Subscription created. Complete payment via Razorpay Checkout.');
    } catch (error) {
      console.error('Create Subscription Error:', error);
      return ApiResponse.error(res, 'Failed to create subscription.', 500);
    }
  }

  /**
   * POST /api/v1/payments/razorpay/subscription/verify
   *
   * Handles both:
   *   - Subscription payments: { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
   *   - One-time / trial payments: { razorpay_payment_id, razorpay_order_id, razorpay_signature }
   */
  static async verifySubscription(req, res) {
    try {
      const userId = req.user?.id;
      const {
        razorpay_payment_id,
        razorpay_subscription_id,
        razorpay_order_id,
        razorpay_signature,
        plan_id,
      } = req.body;

      if (!razorpay_payment_id || !razorpay_signature) {
        return ApiResponse.error(res, 'razorpay_payment_id and razorpay_signature are required.', 422);
      }
      if (!razorpay_subscription_id && !razorpay_order_id) {
        return ApiResponse.error(res, 'Either razorpay_subscription_id or razorpay_order_id is required.', 422);
      }

      // ── Verify Signature ──────────────────────────────────────────────────
      const creds = await RazorpaySubscriptionService.getCredentials();
      let signatureInput;
      if (razorpay_subscription_id) {
        signatureInput = `${razorpay_payment_id}|${razorpay_subscription_id}`;
      } else {
        signatureInput = `${razorpay_order_id}|${razorpay_payment_id}`;
      }

      const expectedSignature = crypto
        .createHmac('sha256', creds.keySecret || '')
        .update(signatureInput)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        console.error('❌ Razorpay signature mismatch!');
        return ApiResponse.error(res, 'Payment signature verification failed. Please contact support.', 422);
      }
      console.log('✅ Razorpay signature verified.');

      // ── Idempotency: payment already recorded in coin_transactions? ──────────
      const [dupRows] = await pool.query(
        'SELECT id FROM coin_transactions WHERE reference_id = ? LIMIT 1',
        [razorpay_payment_id]
      );
      if (dupRows && dupRows.length) {
        return ApiResponse.error(res, 'This payment has already been processed.', 409);
      }

      // ── Fetch plan details ────────────────────────────────────────────────
      let plan        = null;
      let cycleInfo   = { billing_cycle: 'monthly', is_trial: false, duration_days: 30, amount_inr: 0 };

      if (plan_id) {
        const [planRows] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? LIMIT 1', [plan_id]);
        if (planRows && planRows[0]) {
          plan      = planRows[0];
          cycleInfo = detectBillingCycle(plan, razorpay_subscription_id ? null : 'one_time');
          if (cycleInfo.is_trial) cycleInfo.billing_cycle = 'trial';
        }
      }

      const startsAt  = new Date();
      const expiresAt = new Date(Date.now() + cycleInfo.duration_days * 24 * 60 * 60 * 1000);
      const planCoins = plan ? (Number(plan.coins || 0) + Number(plan.bonus_coins || 0)) : 0;

      // ── Activate in DB ────────────────────────────────────────────────────
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Expire previous active subscriptions
        await connection.query(
          "UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'",
          [userId]
        );

        // Insert new subscription
        let newSubId = null;
        try {
          const [subResult] = await connection.query(
            `INSERT INTO subscriptions
             (user_id, plan_id, status, starts_at, expires_at, razorpay_subscription_id, billing_cycle)
             VALUES (?, ?, 'active', ?, ?, ?, ?)`,
            [
              userId,
              plan_id || null,
              startsAt,
              expiresAt,
              razorpay_subscription_id || null,
              cycleInfo.billing_cycle,
            ]
          );
          newSubId = subResult.insertId;
        } catch (_) {
          // Fallback: columns may not exist yet (run migration SQL)
          const [subResult] = await connection.query(
            `INSERT INTO subscriptions (user_id, plan_id, status, starts_at, expires_at) VALUES (?, ?, 'active', ?, ?)`,
            [userId, plan_id || null, startsAt, expiresAt]
          );
          newSubId = subResult.insertId;
        }

        // Credit coins to wallet
        if (planCoins > 0) {
          await connection.query(
            'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
            [planCoins, userId]
          );
        }

        // Mark user as VIP
        await connection.query(
          "UPDATE users SET subscription_type = 'vip' WHERE id = ?",
          [userId]
        );

        // Log coin transaction
        await connection.query(
          `INSERT INTO coin_transactions
           (user_id, type, coins, plan_id, amount, transaction_type, payment_status, description, reference_id)
           VALUES (?, 'plan_purchase', ?, ?, ?, 'credit', 'paid', ?, ?)`,
          [
            userId,
            planCoins,
            plan_id || null,
            cycleInfo.amount_inr,
            plan
              ? `${cycleInfo.is_trial ? 'Trial' : 'Subscribed to'} ${plan.name} (${cycleInfo.billing_cycle})`
              : 'Plan Subscription',
            razorpay_payment_id,
          ]
        );

        await connection.commit();

        return ApiResponse.success(res, {
          subscription_id:            newSubId,
          razorpay_subscription_id:   razorpay_subscription_id || null,
          razorpay_payment_id,
          plan_id:                    plan_id ? Number(plan_id) : null,
          plan_name:                  plan?.name || 'Subscription Plan',
          billing_cycle:              cycleInfo.billing_cycle,
          is_trial:                   cycleInfo.is_trial,
          trial_days:                 cycleInfo.is_trial ? cycleInfo.trial_days : null,
          duration_days:              cycleInfo.duration_days,
          amount:                     cycleInfo.amount_inr,
          coins_credited:             planCoins,
          status:                     'active',
          starts_at:                  startsAt.toISOString(),
          expires_at:                 expiresAt.toISOString(),
          next_renewal:               razorpay_subscription_id ? expiresAt.toISOString() : null,
          auto_renewal:               Boolean(razorpay_subscription_id),
        }, cycleInfo.is_trial
            ? `Trial started! You have ${cycleInfo.trial_days} days of full access.`
            : 'Subscription activated! Auto-renewal is enabled.'
        );
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Verify Subscription Error:', error);
      return ApiResponse.error(res, 'Failed to verify subscription.', 500);
    }
  }

  /**
   * POST /api/v1/user/subscription/cancel
   */
  static async cancelSubscription(req, res) {
    try {
      const userId = req.user?.id;

      const [subRows] = await pool.query(
        "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
        [userId]
      );

      if (!subRows || subRows.length === 0) {
        return ApiResponse.error(res, 'No active subscription found.', 404);
      }

      const subscription = subRows[0];
      const rzpSubId     = subscription.razorpay_subscription_id || null;

      if (rzpSubId) {
        const cancelResult = await RazorpaySubscriptionService.cancelSubscription(rzpSubId, true);
        if (!cancelResult.success) {
          console.warn('⚠️  Razorpay cancel failed:', cancelResult.error);
        }
      }

      await pool.query(
        "UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE id = ?",
        [subscription.id]
      );

      return ApiResponse.success(res, {
        subscription_id: subscription.id,
        billing_cycle:   subscription.billing_cycle || null,
        status:          'cancelled',
        expires_at:      subscription.expires_at ? new Date(subscription.expires_at).toISOString() : null,
        auto_renewal:    false,
      }, 'Subscription cancelled. You retain access until the end of your current billing period.');
    } catch (error) {
      console.error('Cancel Subscription Error:', error);
      return ApiResponse.error(res, 'Failed to cancel subscription.', 500);
    }
  }
}

module.exports = RazorpaySubscriptionController;
