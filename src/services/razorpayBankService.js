const { pool } = require('../config/db');

class RazorpayBankService {
  /**
   * Fetch Razorpay credentials from `settings` table or environment variables
   */
  static async getCredentials() {
    try {
      const [rows] = await pool.query(
        "SELECT `key`, `value` FROM settings WHERE `key` IN (?, ?)",
        [
          'payment_key_razorpay_key_id',
          'payment_key_razorpay_key_secret',
        ]
      );

      const settingsMap = {};
      if (Array.isArray(rows)) {
        rows.forEach((r) => {
          settingsMap[r.key] = r.value;
        });
      }

      const keyId =
        settingsMap['payment_key_razorpay_key_id'] ||
        process.env.RAZORPAY_KEY_ID ||
        process.env.RAZORPAY_KEY ||
        null;

      const keySecret =
        settingsMap['payment_key_razorpay_key_secret'] ||
        process.env.RAZORPAY_KEY_SECRET ||
        process.env.RAZORPAY_SECRET ||
        null;

      return {
        keyId,
        keySecret,
        isConfigured: Boolean(keyId && keySecret),
      };
    } catch (error) {
      console.error('Error fetching Razorpay credentials from settings:', error);
      const keyId = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY || null;
      const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || null;
      return {
        keyId,
        keySecret,
        isConfigured: Boolean(keyId && keySecret),
      };
    }
  }

  /**
   * Verify IFSC code using Razorpay IFSC API
   * Endpoint: https://ifsc.razorpay.com/:ifsc
   */
  static async verifyIfsc(ifscCode) {
    const cleanIfsc = (ifscCode || '').toString().trim().toUpperCase();

    // Standard 11-character Indian IFSC regex
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(cleanIfsc)) {
      return {
        valid: false,
        error: 'Invalid IFSC code format. IFSC must be an 11-character code (e.g. HDFC0000053).',
      };
    }

    try {
      const response = await fetch(`https://ifsc.razorpay.com/${cleanIfsc}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 404) {
        return {
          valid: false,
          error: `IFSC code "${cleanIfsc}" not found. Please enter a valid bank IFSC code.`,
        };
      }

      if (!response.ok) {
        return {
          valid: false,
          error: `IFSC verification service returned HTTP ${response.status}.`,
        };
      }

      const data = await response.json();
      return {
        valid: true,
        bank: data.BANK || '',
        branch: data.BRANCH || '',
        city: data.CITY || '',
        state: data.STATE || '',
        details: data,
      };
    } catch (error) {
      console.error('Razorpay IFSC Verification Error:', error);
      return {
        valid: false,
        error: 'Failed to connect to IFSC verification service.',
      };
    }
  }

  /**
   * Validate Bank Account
   *
   * NOTE: Live penny-drop bank validation (via /v1/fund_accounts/validations) requires
   * a RazorpayX (Banking Plus) account. Since this account is a standard Razorpay
   * Payments account, we perform IFSC validation only and save the bank details as
   * pending verification (is_verified = false). Admin can manually verify during
   * withdrawal processing.
   *
   * Reference: https://razorpay.com/docs/api/x/account-validation/
   */
  static async validateBankAccount({
    accountHolderName,
    accountNumber,
    ifscCode,
    userEmail,
    userPhone,
    userId,
  }) {
    const cleanName    = (accountHolderName || '').trim();
    const cleanAccount = (accountNumber || '').trim();
    const cleanIfsc    = (ifscCode || '').trim().toUpperCase();

    console.log('🏦 Bank validation: IFSC-only mode (standard Razorpay account — RazorpayX not available)');
    console.log('📋 Details:', { name: cleanName, account: cleanAccount, ifsc: cleanIfsc, userId });

    // Basic format validation
    if (!cleanName) {
      return { success: false, is_verified: false, error: 'Account holder name is required.' };
    }
    if (!cleanAccount || cleanAccount.length < 5 || cleanAccount.length > 20) {
      return { success: false, is_verified: false, error: 'Please enter a valid bank account number (5–20 digits).' };
    }
    if (!/^\d+$/.test(cleanAccount)) {
      return { success: false, is_verified: false, error: 'Bank account number must contain only digits.' };
    }

    // IFSC has already been verified in Step 1 of bankController (verifyIfsc),
    // so we just return success here with is_verified = false (pending admin review).
    console.log('✅ Basic validation passed. Saving as pending verification.');

    return {
      success: true,
      is_verified: false,         // Will be set to true by admin on withdrawal approval
      validation_id: null,
      status: 'pending',
      account_status: 'pending_verification',
      registered_name: null,
      name_match_score: null,
      message: 'Bank details saved successfully. Account will be verified during withdrawal processing.',
    };
  }
}

module.exports = RazorpayBankService;
