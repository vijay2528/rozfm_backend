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
   * Validate Bank Account using RazorpayX Account Validation API
   * Endpoint: POST https://api.razorpay.com/v1/fund_accounts/validations
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
    const creds = await this.getCredentials();

    if (!creds.isConfigured) {
      return {
        success: false,
        is_verified: false,
        error:
          'Razorpay payment keys are not configured. Please configure payment_key_razorpay_key_id and payment_key_razorpay_key_secret in settings.',
      };
    }

    const authHeader =
      'Basic ' + Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64');
  console.log('🔑 Razorpay credentials:', { keyId: creds.keyId ? '[REDACTED]' : null, keySecret: creds.keySecret ? '[REDACTED]' : null, isConfigured: creds.isConfigured });

    const cleanName = (accountHolderName || '').trim();
    const cleanAccount = (accountNumber || '').trim().replace(/\D/g, '');
    const cleanIfsc = (ifscCode || '').trim().toUpperCase();

    const payload = {
      // validation_type removed as not required
      reference_id: `fav_${userId || 'usr'}_${Date.now()}`,
      notes: {
        user_id: String(userId || ''),
        service: 'RozFM Bank Account Verification',
      },
      fund_account: {
        account_type: 'bank_account',
        bank_account: {
          name: cleanName,
          ifsc: cleanIfsc,
          account_number: cleanAccount,
        },
        contact: {
          name: cleanName,
          email: userEmail || `user_${userId || Date.now()}@rozfm.com`,
          contact: userPhone || '9999999999',
          type: 'customer',
        },
      },
    };

    try {
      const response = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        const rzpError = responseData?.error || {};
        const description =
          rzpError.description ||
          rzpError.message ||
          `Razorpay API returned HTTP ${response.status}.`;

        console.error('Razorpay Fund Account Validation Error Response:', responseData);

        return {
          success: false,
          is_verified: false,
          statusCode: response.status,
          code: rzpError.code || 'RAZORPAY_VALIDATION_ERROR',
          error: description,
          details: responseData,
        };
      }

      const results = responseData?.results || responseData?.validation_results || {};
      const accountStatus = (results.account_status || '').toLowerCase();
      const status = (responseData?.status || '').toLowerCase();

      // If bank explicitly marked account as invalid
      if (accountStatus === 'invalid' || status === 'failed') {
        const failureReason =
          results.details ||
          results.description ||
          'The beneficiary bank reported this account as invalid or inactive.';

        return {
          success: false,
          is_verified: false,
          status,
          account_status: accountStatus || 'invalid',
          error: failureReason,
          details: responseData,
        };
      }

      // Successful verification
      return {
        success: true,
        is_verified: true,
        validation_id: responseData?.id || null,
        status: status || 'completed',
        account_status: accountStatus || 'active',
        registered_name: results.registered_name || null,
        name_match_score:
          results.name_match_score !== undefined ? results.name_match_score : null,
        details: responseData,
      };
    } catch (error) {
      console.error('Razorpay Account Validation Network Error:', error);
      return {
        success: false,
        is_verified: false,
        error: 'Failed to connect to Razorpay account validation service.',
      };
    }
  }
}

module.exports = RazorpayBankService;
