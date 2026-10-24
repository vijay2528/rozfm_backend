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
   * Validate Bank Account using the official Razorpay 3-step flow:
   * Step 1: POST /v1/contacts           → Create Contact  → get contact_id
   * Step 2: POST /v1/fund_accounts      → Create Fund Account linked to contact → get fund_account_id
   * Step 3: POST /v1/fund_accounts/validations → Validate the fund account
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
    const creds = await this.getCredentials();

    console.log('🔑 Razorpay credentials:', {
      keyId: creds.keyId ? '[REDACTED]' : null,
      keySecret: creds.keySecret ? '[REDACTED]' : null,
      isConfigured: creds.isConfigured,
    });

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

    const headers = {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const cleanName    = (accountHolderName || '').trim();
    const cleanAccount = (accountNumber || '').trim();
    const cleanIfsc    = (ifscCode || '').trim().toUpperCase();
    const email        = userEmail || `user_${userId || Date.now()}@rozfm.com`;
    const phone        = userPhone || '9999999999';

    try {
      // ── Step 1: Create Contact ─────────────────────────────────────────────
      console.log('📞 Step 1: Creating Razorpay Contact...');
      const contactPayload = {
        name: cleanName,
        email,
        contact: phone,
        type: 'customer',
        reference_id: `rozfm_user_${userId || Date.now()}`,
        notes: {
          user_id: String(userId || ''),
          service: 'RozFM Bank Account Verification',
        },
      };

      const contactRes = await fetch('https://api.razorpay.com/v1/contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify(contactPayload),
      });

      const contactData = await contactRes.json().catch(() => null);
      console.log('📞 Contact API response:', JSON.stringify(contactData));

      if (!contactRes.ok) {
        const err = contactData?.error || {};
        console.error('❌ Razorpay Create Contact Error:', contactData);
        return {
          success: false,
          is_verified: false,
          statusCode: contactRes.status,
          error: err.description || err.message || `Create Contact failed with HTTP ${contactRes.status}.`,
          details: contactData,
        };
      }

      const contactId = contactData?.id;
      if (!contactId) {
        return { success: false, is_verified: false, error: 'Razorpay did not return a contact_id.' };
      }
      console.log(`✅ Contact created: ${contactId}`);

      // ── Step 2: Create Fund Account (Bank Account) ─────────────────────────
      console.log('🏦 Step 2: Creating Razorpay Fund Account...');
      const fundAccountPayload = {
        contact_id: contactId,
        account_type: 'bank_account',
        bank_account: {
          name: cleanName,
          ifsc: cleanIfsc,
          account_number: cleanAccount,
        },
      };

      const fundRes = await fetch('https://api.razorpay.com/v1/fund_accounts', {
        method: 'POST',
        headers,
        body: JSON.stringify(fundAccountPayload),
      });

      const fundData = await fundRes.json().catch(() => null);
      console.log('🏦 Fund Account API response:', JSON.stringify(fundData));

      if (!fundRes.ok) {
        const err = fundData?.error || {};
        console.error('❌ Razorpay Create Fund Account Error:', fundData);
        return {
          success: false,
          is_verified: false,
          statusCode: fundRes.status,
          error: err.description || err.message || `Create Fund Account failed with HTTP ${fundRes.status}.`,
          details: fundData,
        };
      }

      const fundAccountId = fundData?.id;
      if (!fundAccountId) {
        return { success: false, is_verified: false, error: 'Razorpay did not return a fund_account_id.' };
      }
      console.log(`✅ Fund Account created: ${fundAccountId}`);

      // ── Step 3: Validate Bank Account ──────────────────────────────────────
      console.log('✔️ Step 3: Validating Bank Account...');
      // Use env var in production; fallback to Razorpay's official test account number in test mode
      const sourceAccountNumber = process.env.RAZORPAY_SOURCE_ACCOUNT_NUMBER || '7878780080316316';
      console.log('✔️ Using source_account_number:', sourceAccountNumber);

      const validationPayload = {
        account_number: sourceAccountNumber, // Your RazorpayX business account number
        fund_account: {
          id: fundAccountId,
        },
        amount: 100,   // 1 INR in paise
        currency: 'INR',
        notes: {
          user_id: String(userId || ''),
          service: 'RozFM Bank Account Verification',
        },
      };

      console.log('✔️ Validation payload:', JSON.stringify(validationPayload));

      const validationRes = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
        method: 'POST',
        headers,
        body: JSON.stringify(validationPayload),
      });

      const validationData = await validationRes.json().catch(() => null);
      console.log('✔️ Validation API response:', JSON.stringify(validationData));

      if (!validationRes.ok) {
        const err = validationData?.error || {};
        console.error('❌ Razorpay Fund Account Validation Error:', validationData);
        return {
          success: false,
          is_verified: false,
          statusCode: validationRes.status,
          code: err.code || 'RAZORPAY_VALIDATION_ERROR',
          error: err.description || err.message || `Validation failed with HTTP ${validationRes.status}.`,
          details: validationData,
        };
      }

      const results       = validationData?.results || validationData?.validation_results || {};
      const accountStatus = (results.account_status || '').toLowerCase();
      const status        = (validationData?.status || '').toLowerCase();

      // If bank explicitly marked account as invalid
      if (accountStatus === 'invalid' || status === 'failed') {
        return {
          success: false,
          is_verified: false,
          status,
          account_status: accountStatus || 'invalid',
          error: results.details || results.description || 'The beneficiary bank reported this account as invalid or inactive.',
          details: validationData,
        };
      }

      // Successful verification
      return {
        success: true,
        is_verified: true,
        validation_id:    validationData?.id || null,
        contact_id:       contactId,
        fund_account_id:  fundAccountId,
        status:           status || 'completed',
        account_status:   accountStatus || 'active',
        registered_name:  results.registered_name || null,
        name_match_score: results.name_match_score !== undefined ? results.name_match_score : null,
        details:          validationData,
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
