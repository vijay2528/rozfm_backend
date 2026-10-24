const { pool } = require('../config/db');

/**
 * RazorpaySubscriptionService
 *
 * Handles Razorpay Subscriptions (auto-pay) for plan purchases.
 * Works with standard Razorpay Payments account (no RazorpayX needed).
 *
 * Flow:
 *  1. GET /plans            → List plans from purchase_plans table
 *  2. POST /plans/subscribe → Create Razorpay Plan + Subscription → return subscription_id to frontend
 *  3. Frontend opens Razorpay Checkout with subscription_id
 *  4. User pays
 *  5. POST /payments/razorpay/subscription/verify → Verify signature → activate subscription
 *  6. POST /webhook/razorpay → Handle auto-renewal (subscription.charged)
 */
class RazorpaySubscriptionService {
  /**
   * Fetch Razorpay credentials from settings table or env vars
   */
  static async getCredentials() {
    try {
      const [rows] = await pool.query(
        "SELECT `key`, `value` FROM settings WHERE `key` IN (?, ?)",
        ['payment_key_razorpay_key_id', 'payment_key_razorpay_key_secret']
      );
      const map = {};
      if (Array.isArray(rows)) rows.forEach((r) => { map[r.key] = r.value; });

      const keyId     = map['payment_key_razorpay_key_id']     || process.env.RAZORPAY_KEY_ID     || process.env.RAZORPAY_KEY    || null;
      const keySecret = map['payment_key_razorpay_key_secret'] || process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || null;

      return { keyId, keySecret, isConfigured: Boolean(keyId && keySecret) };
    } catch (err) {
      const keyId     = process.env.RAZORPAY_KEY_ID     || process.env.RAZORPAY_KEY    || null;
      const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || null;
      return { keyId, keySecret, isConfigured: Boolean(keyId && keySecret) };
    }
  }

  static getAuthHeader(keyId, keySecret) {
    return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  }

  static get headers() { return {}; } // placeholder; built per-call

  /**
   * Create or reuse a Razorpay Plan for a given purchase_plan row.
   * Razorpay Plans are identified by a unique `item.name` + `period` + `interval` + `amount`.
   * We store the razorpay_plan_id in the purchase_plans table to avoid duplication.
   *
   * @param {object} purchasePlan  - Row from purchase_plans table
   * @param {string} billingCycle  - 'monthly' | 'yearly'
   * @param {object} creds         - { keyId, keySecret }
   */
  static async getRazorpayPlanId(purchasePlan, billingCycle, creds, overrideAmountINR = null) {
    const authHeader = this.getAuthHeader(creds.keyId, creds.keySecret);
    const headers    = { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' };

    // Check if already stored in DB
    // Each purchase_plan has a single duration → one cached Razorpay Plan ID
    const columnName = 'razorpay_plan_id';
    const [planRows] = await pool.query(
      `SELECT ${columnName} FROM purchase_plans WHERE id = ? LIMIT 1`,
      [purchasePlan.id]
    ).catch(() => [[]]);

    // Determine amount and period
    const amountINR = overrideAmountINR != null
      ? parseFloat(overrideAmountINR)
      : billingCycle === 'yearly'
        ? parseFloat(purchasePlan.yearly_amount || purchasePlan.price || 0)
        : parseFloat(purchasePlan.monthly_amount || purchasePlan.price || 0);

    if (!amountINR || amountINR <= 0) {
      return { success: false, error: `Invalid amount for ${billingCycle} billing.` };
    }

    const amountPaise = Math.round(amountINR * 100);
    const period      = billingCycle === 'yearly' ? 'yearly' : 'monthly';
    const interval    = billingCycle === 'quarterly' ? 3 : 1;

    // Reuse cached Razorpay Plan only if price/period still match
    // (Razorpay Plans are immutable — if admin changes price, a new plan is created)
    const cachedId = planRows?.[0]?.[columnName];
    if (cachedId) {
      const chk = await fetch(`https://api.razorpay.com/v1/plans/${cachedId}`, { headers }).catch(() => null);
      const cached = chk && chk.ok ? await chk.json().catch(() => null) : null;
      if (cached && cached.item?.amount === amountPaise && cached.period === period && Number(cached.interval) === interval) {
        console.log(`♻️  Reusing existing Razorpay Plan: ${cachedId}`);
        return { success: true, planId: cachedId, amountINR };
      }
      console.log(`🔄 Cached Razorpay Plan ${cachedId} is outdated — creating a new one.`);
    }

    const planPayload = {
      period,
      interval,
      item: {
        name:     `${purchasePlan.name} - ${billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1)}`,
        amount:   amountPaise,
        currency: 'INR',
        description: purchasePlan.description || `${purchasePlan.name} plan`,
      },
      notes: {
        purchase_plan_id: String(purchasePlan.id),
        billing_cycle:    billingCycle,
      },
    };

    console.log('📋 Creating Razorpay Plan:', JSON.stringify(planPayload));

    const res = await fetch('https://api.razorpay.com/v1/plans', {
      method: 'POST',
      headers,
      body: JSON.stringify(planPayload),
    });

    const data = await res.json().catch(() => null);
    console.log('📋 Razorpay Plan response:', JSON.stringify(data));

    if (!res.ok) {
      const err = data?.error || {};
      return { success: false, error: err.description || err.message || `Plan creation failed (HTTP ${res.status}).` };
    }

    const razorpayPlanId = data?.id;
    if (!razorpayPlanId) return { success: false, error: 'Razorpay did not return a plan id.' };

    // Store in DB for reuse (only if column exists — graceful fallback)
    try {
      await pool.query(
        `UPDATE purchase_plans SET ${columnName} = ? WHERE id = ?`,
        [razorpayPlanId, purchasePlan.id]
      );
    } catch (_) {
      console.warn(`⚠️  Could not store razorpay_plan_id in DB (column "${columnName}" may not exist). Continuing...`);
    }

    return { success: true, planId: razorpayPlanId, amountINR };
  }

  /**
   * Create a Razorpay Subscription for a user
   *
   * @param {object} params
   * @param {number} params.userId
   * @param {object} params.purchasePlan  - Row from purchase_plans
   * @param {string} params.billingCycle  - 'monthly' | 'yearly'
   * @param {string} params.userEmail
   * @param {string} params.userPhone
   */
  /**
   * Extra (optional) params for trial → paid autopay:
   * @param {number} params.startAt         - Unix seconds; first recurring charge happens at this time
   * @param {number} params.addonAmountINR  - One-time amount charged immediately on authentication (trial price)
   * @param {object} params.extraNotes      - Additional notes stored on the Razorpay subscription
   */
  static async createSubscription({ userId, purchasePlan, billingCycle = 'monthly', overrideAmountINR = null, userEmail, userPhone, startAt = null, addonAmountINR = 0, addonName = 'Trial', extraNotes = {} }) {
    const creds = await this.getCredentials();
    if (!creds.isConfigured) {
      return { success: false, error: 'Razorpay payment keys are not configured.' };
    }

    const authHeader = this.getAuthHeader(creds.keyId, creds.keySecret);
    const headers    = { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' };

    // Step 1: Get/Create Razorpay Plan
    const planResult = await this.getRazorpayPlanId(purchasePlan, billingCycle, creds, overrideAmountINR);
    if (!planResult.success) return { success: false, error: planResult.error };

    const razorpayPlanId = planResult.planId;

    // Step 2: Create Subscription
    const subscriptionPayload = {
      plan_id:       razorpayPlanId,
      // Max auto-renewal cycles (~10 years)
      total_count:   billingCycle === 'yearly' ? 10 : billingCycle === 'quarterly' ? 40 : 120,
      quantity:      1,
      customer_notify: 1,
      notes: {
        user_id:          String(userId),
        purchase_plan_id: String(purchasePlan.id),
        billing_cycle:    billingCycle,
        service:          'RozFM Subscription',
        ...Object.fromEntries(Object.entries(extraNotes).map(([k, v]) => [k, String(v ?? '')])),
      },
    };

    // Delay first recurring charge (used for trials)
    if (startAt) subscriptionPayload.start_at = Math.floor(startAt);

    // Charge trial price immediately at mandate authentication
    if (addonAmountINR && addonAmountINR > 0) {
      subscriptionPayload.addons = [{
        item: { name: addonName, amount: Math.round(addonAmountINR * 100), currency: 'INR' },
      }];
    }

    // Attach customer details if available
    if (userEmail || userPhone) {
      subscriptionPayload.notify_info = {
        notify_email: userEmail || undefined,
        notify_phone: userPhone || undefined,
      };
    }

    console.log('🔄 Creating Razorpay Subscription:', JSON.stringify(subscriptionPayload));

    const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers,
      body: JSON.stringify(subscriptionPayload),
    });

    const data = await res.json().catch(() => null);
    console.log('🔄 Razorpay Subscription response:', JSON.stringify(data));

    if (!res.ok) {
      const err = data?.error || {};
      return { success: false, error: err.description || err.message || `Subscription creation failed (HTTP ${res.status}).`, details: data };
    }

    return {
      success:         true,
      subscription_id: data.id,
      short_url:       data.short_url || null,
      status:          data.status,
      razorpay_plan_id: razorpayPlanId,
      amount_inr:      planResult.amountINR || null,
      data,
    };
  }

  /**
   * Fetch a Razorpay Subscription by ID
   */
  static async fetchSubscription(razorpaySubId) {
    const creds = await this.getCredentials();
    if (!creds.isConfigured) return null;

    const authHeader = this.getAuthHeader(creds.keyId, creds.keySecret);
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${razorpaySubId}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    return res.ok ? await res.json() : null;
  }

  /**
   * Cancel a Razorpay Subscription (at end of billing cycle)
   */
  static async cancelSubscription(razorpaySubId, cancelAtCycleEnd = true) {
    const creds = await this.getCredentials();
    if (!creds.isConfigured) return { success: false, error: 'Keys not configured.' };

    const authHeader = this.getAuthHeader(creds.keyId, creds.keySecret);
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${razorpaySubId}/cancel`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }),
    });
    const data = await res.json().catch(() => null);
    return res.ok ? { success: true, data } : { success: false, error: data?.error?.description || 'Cancel failed.' };
  }
}

module.exports = RazorpaySubscriptionService;
