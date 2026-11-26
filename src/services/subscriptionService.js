const { pool } = require('../config/db');

class SubscriptionService {
  /**
   * Assign or activate a subscription plan for a user.
   * Can be invoked by:
   *  - Admin manually granting a plan (is_manual = 1, assigned_by = 'admin')
   *  - In-app Google Play / Razorpay purchase verification
   *
   * @param {Object} params
   * @param {number|string} params.userId - Target user ID
   * @param {number|string} params.planId - Plan ID from purchase_plans (e.g. 4 for Roz Pass)
   * @param {number} [params.durationDays] - Custom duration in days (optional, defaults to plan.duration_days)
   * @param {string} [params.assignedBy='admin'] - 'admin', 'google_play', 'razorpay'
   * @param {boolean} [params.isManual=true] - true if assigned by admin
   * @param {string} [params.notes] - Optional remarks e.g. 'Manually assigned by Admin'
   * @param {number} [params.amountPaid=0] - Actual payment amount (0.00 for admin manual grant)
   * @param {string} [params.referenceId] - Gateway/Admin transaction reference
   */
  static async assignPlan({
    userId,
    planId,
    durationDays = null,
    assignedBy = 'admin',
    isManual = true,
    notes = 'Manually assigned by Admin',
    amountPaid = 0.00,
    referenceId = null,
  }) {
    if (!userId) {
      throw new Error('User ID is required');
    }
    if (!planId) {
      throw new Error('Plan ID is required');
    }

    // 1. Fetch user
    const [userRows] = await pool.query('SELECT id, name, email, phone, subscription_type FROM users WHERE id = ? LIMIT 1', [userId]);
    if (userRows.length === 0) {
      throw new Error(`User with ID ${userId} not found`);
    }
    const user = userRows[0];

    // 2. Fetch plan from purchase_plans
    const [planRows] = await pool.query('SELECT * FROM purchase_plans WHERE id = ? OR slug = ? LIMIT 1', [planId, String(planId)]);
    if (planRows.length === 0) {
      throw new Error(`Subscription plan with ID or slug '${planId}' not found in purchase_plans`);
    }
    const plan = planRows[0];

    // 3. Determine duration in days
    let days = durationDays ? parseInt(durationDays, 10) : null;
    if (!days || isNaN(days) || days <= 0) {
      if (plan.duration_days && Number(plan.duration_days) > 0) {
        days = Number(plan.duration_days);
      } else if (plan.billing_period === 'P1Y' || (plan.name && plan.name.toLowerCase().includes('year')) || (plan.description && plan.description.includes('365'))) {
        days = 365;
      } else if (plan.billing_period === 'P6M' || (plan.name && plan.name.toLowerCase().includes('saver')) || (plan.description && plan.description.includes('180'))) {
        days = 180;
      } else {
        days = 30; // default 30 days
      }
    }

    const startsAt = new Date();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const billingCycle = days >= 365 ? 'yearly' : (days >= 180 ? 'six-month' : 'monthly');

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 4. Expire any currently active subscriptions for this user
      await connection.query(
        "UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'",
        [userId]
      );

      // 5. Insert new active subscription with manual tracking fields
      const [subRes] = await connection.query(
        `INSERT INTO subscriptions 
         (user_id, plan_id, status, starts_at, expires_at, billing_cycle, is_manual, assigned_by, notes)
         VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          plan.id,
          startsAt,
          expiresAt,
          billingCycle,
          isManual ? 1 : 0,
          assignedBy,
          notes,
        ]
      );
      const subscriptionId = subRes.insertId;

      // 6. Update user subscription_type to 'vip'
      await connection.query(
        "UPDATE users SET subscription_type = 'vip' WHERE id = ?",
        [userId]
      );

      // 7. Record transaction in coin_transactions for audit history
      // Note: for admin manual grant, amount = 0.00 so platform revenue is NOT falsely inflated
      const ref = referenceId || `ADMIN-SUB-${userId}-${Date.now()}`;
      const desc = isManual
        ? `Admin Assigned: ${plan.name} (${days} Days)`
        : `Subscription Purchase: ${plan.name}`;

      await connection.query(
        `INSERT INTO coin_transactions 
         (user_id, type, coins, plan_id, amount, transaction_type, payment_status, payment_method, description, reference_id)
         VALUES (?, 'subscription', 0, ?, ?, 'credit', 'paid', ?, ?, ?)`,
        [
          userId,
          plan.id,
          parseFloat(amountPaid || 0),
          assignedBy === 'admin' ? 'admin_manual' : assignedBy,
          desc,
          ref,
        ]
      );

      await connection.commit();

      return {
        subscription_id: subscriptionId,
        user_id: user.id,
        user_name: user.name,
        user_email: user.email,
        user_phone: user.phone,
        plan_id: plan.id,
        plan_name: plan.name,
        plan_price: Number(plan.price || plan.monthly_amount || 0),
        subscription_type: 'vip',
        status: 'active',
        is_manual: isManual,
        assigned_by: assignedBy,
        notes: notes,
        starts_at: startsAt,
        expires_at: expiresAt,
        days_granted: days,
        days_remaining: days,
        billing_cycle: billingCycle,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

module.exports = SubscriptionService;
