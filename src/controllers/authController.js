const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toProfileFieldsArray, checkIsProfileComplete, checkIsCategorySelected } = require('../utils/userPresenter');
const WhatsAppService = require('../services/whatsappService');

const DEMO_OTP = '123456';
const OTP_TTL_MINUTES = 10;

function generateRandomOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(userId) {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET || 'rozfm_super_secret_jwt_key_2026',
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

function normalizePhone(phone) {
  return phone ? phone.replace(/\s+/g, '').trim() : '';
}

class AuthController {
  static async register(req, res) {
    try {
      const { name, email, password, phone, platform, locale } = req.body;

      if (!name || !email || !password) {
        return ApiResponse.error(res, 'Name, email, and password are required.', 422);
      }

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedPhone = phone ? normalizePhone(phone) : null;

      // Check if email already exists
      const [existingEmail] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
      if (existingEmail.length > 0) {
        return ApiResponse.error(res, 'Email is already registered.', 422);
      }

      // Check if phone already exists
      if (normalizedPhone) {
        const [existingPhone] = await pool.query('SELECT id FROM users WHERE phone = ? LIMIT 1', [normalizedPhone]);
        if (existingPhone.length > 0) {
          return ApiResponse.error(res, 'Phone number is already registered.', 422);
        }
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const userPlatform = platform || 'android';

      const [result] = await pool.query(
        `INSERT INTO users (name, email, phone, password, platform, device_type, locale, subscription_type, wallet_balance, login_method, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'free', 0.00, 'email_password', NOW())`,
        [name, normalizedEmail, normalizedPhone, hashedPassword, userPlatform, userPlatform, locale || null]
      );

      const userId = result.insertId;
      const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
      const user = userRows[0];

      const token = generateToken(userId);
      const isProfileComplete = checkIsProfileComplete(user);
      const isCategorySelected = await checkIsCategorySelected(user.id);

      return ApiResponse.success(
        res,
        {
          token: token,
          isProfileComplete,
          isCategorySelected,
          user: toProfileFieldsArray(user, { isProfileComplete, isCategorySelected }),
        },
        'Registration successful.',
        201
      );
    } catch (error) {
      console.error('Registration Error:', error);
      return ApiResponse.error(res, 'Registration failed.', 500);
    }
  }

  static async login(req, res) {
    try {
      const { device_token, device_type, phone, email, name } = req.body;

      const phoneStr = phone ? normalizePhone(phone) : '';
      const emailStr = email ? email.toLowerCase().trim() : '';
      const nameStr = name && typeof name === 'string' && name.trim() !== '' ? name.trim() : null;

      if (!device_token || !device_type) {
        return ApiResponse.error(res, 'Device token and device type are required.', 422);
      }

      if (!phoneStr && !emailStr) {
        return ApiResponse.error(res, 'Phone or email is required.', 422);
      }

      if (phoneStr && emailStr) {
        return ApiResponse.error(res, 'Send either phone or email, not both.', 422);
      }

      // Phone Login Flow
      if (phoneStr !== '') {
        const digits = phoneStr.replace(/\D/g, '');
        const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
        const [users] = await pool.query(
          'SELECT * FROM users WHERE phone = ? OR phone = ? OR (LENGTH(?) = 10 AND RIGHT(REPLACE(phone, "+", ""), 10) = ?) LIMIT 1',
          [phoneStr, digits, last10, last10]
        );
        let isNewUser = users.length === 0;
        let userId;

        if (isNewUser) {
          const placeholderEmail = `phone_${phoneStr.replace(/\D/g, '') || Date.now()}@app.local`;
          const dummyPassword = await bcrypt.hash(Math.random().toString(36), 10);
          const userName = nameStr || `User ${phoneStr.slice(-4)}`;

          const [insertRes] = await pool.query(
            `INSERT INTO users (name, email, phone, password, platform, device_token, device_type, subscription_type, wallet_balance, login_method)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'free', 0.00, 'phone_otp')`,
            [userName, placeholderEmail, phoneStr, dummyPassword, device_type, device_token, device_type]
          );
          userId = insertRes.insertId;
        } else {
          const user = users[0];
          if (user.is_blocked) {
            return ApiResponse.error(res, 'Your account has been suspended. Contact an administrator.', 403);
          }

          const loginMethod = String(user.login_method || '').toLowerCase().trim();
          if (loginMethod === 'email_otp' || loginMethod === 'google') {
            return ApiResponse.error(
              res,
              'This account is registered with Google Email. Please login using your email.',
              422
            );
          }

          userId = user.id;

          if (nameStr) {
            await pool.query(
              'UPDATE users SET name = ?, platform = ?, device_token = ?, device_type = ? WHERE id = ?',
              [nameStr, device_type, device_token, device_type, userId]
            );
          } else {
            await pool.query(
              'UPDATE users SET platform = ?, device_token = ?, device_type = ? WHERE id = ?',
              [device_type, device_token, device_type, userId]
            );
          }
        }

        // Delete previous unverified OTPs for this phone
        await pool.query(
          `DELETE FROM otp_verifications 
           WHERE (phone = ? OR phone = ? OR (LENGTH(?) = 10 AND RIGHT(REPLACE(phone, '+', ''), 10) = ?)) 
             AND verified_at IS NULL`,
          [phoneStr, digits, last10, last10]
        );

        // Generate OTP (use demo OTP for special test numbers or when USE_DEMO_OTP=true, else 6-digit random code)
        const isDemoNumber = ['9999999999', '1234567890'].includes(last10) || process.env.USE_DEMO_OTP === 'true';
        const otp = isDemoNumber ? DEMO_OTP : generateRandomOtp();

        // Insert new OTP verification record (expires in 10 minutes)
        const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
        await pool.query(
          `INSERT INTO otp_verifications (phone, otp, device_token, device_type, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          [phoneStr, otp, device_token, device_type, expiresAt]
        );

        // Send OTP via WhatsApp Cloud API
        const whatsappRes = await WhatsAppService.sendOtp(phoneStr, otp);

        const isSent = Boolean(whatsappRes && whatsappRes.success);
        const resMessage = isSent
          ? 'OTP sent successfully to your WhatsApp number.'
          : `OTP generated, but WhatsApp delivery failed: ${whatsappRes?.error || 'Meta API error'}.`;

        return ApiResponse.success(
          res,
          {
            login_type: 'phone',
            phone: phoneStr,
            is_new_user: isNewUser,
            otp_sent: isSent,
            whatsapp_sent: isSent,
            whatsapp_status: isSent ? 'DELIVERED' : 'FAILED',
            whatsapp_message_id: whatsappRes?.messageId || null,
            whatsapp_error: isSent ? null : (whatsappRes?.error || null),
            expires_in_minutes: OTP_TTL_MINUTES,
            debug_otp: otp,
          },
          resMessage
        );
      }

      // Email Login Flow
      if (emailStr !== '') {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [emailStr]);
        let isNewUser = users.length === 0;
        let user;

        if (isNewUser) {
          const userName = nameStr; // Only save name if user passed it, otherwise null
          const dummyPassword = await bcrypt.hash(Math.random().toString(36), 10);

          const [insertRes] = await pool.query(
            `INSERT INTO users (name, email, password, platform, device_token, device_type, subscription_type, wallet_balance, login_method, last_login_at)
             VALUES (?, ?, ?, ?, ?, ?, 'free', 0.00, 'email_otp', NOW())`,
            [userName, emailStr, dummyPassword, device_type, device_token, device_type]
          );

          const [newUserRows] = await pool.query('SELECT * FROM users WHERE id = ?', [insertRes.insertId]);
          user = newUserRows[0];
        } else {
          user = users[0];
          if (user.is_blocked) {
            return ApiResponse.error(res, 'Your account has been suspended. Contact an administrator.', 403);
          }

          if (nameStr) {
            await pool.query(
              'UPDATE users SET name = ?, platform = ?, device_token = ?, device_type = ?, last_login_at = NOW() WHERE id = ?',
              [nameStr, device_type, device_token, device_type, user.id]
            );
          } else {
            await pool.query(
              'UPDATE users SET platform = ?, device_token = ?, device_type = ?, last_login_at = NOW() WHERE id = ?',
              [device_type, device_token, device_type, user.id]
            );
          }

          const [updatedUserRows] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
          user = updatedUserRows[0];
        }

        const token = generateToken(user.id);
        const isProfileComplete = checkIsProfileComplete(user);
        const isCategorySelected = await checkIsCategorySelected(user.id);

        return ApiResponse.success(
          res,
          {
            login_type: 'email',
            is_new_user: isNewUser,
            token: token,
            isProfileComplete,
            isCategorySelected,
            user: toProfileFieldsArray(user, { isProfileComplete, isCategorySelected }),
          },
          'Login successful.'
        );
      }
    } catch (error) {
      console.error('Login Error:', error);
      return ApiResponse.error(res, 'Login failed.', 500);
    }
  }

  static async resendOtp(req, res) {
    try {
      const { phone, device_token, device_type } = req.body;

      if (!phone) {
        return ApiResponse.error(res, 'Phone number is required.', 422);
      }

      const phoneStr = normalizePhone(phone);
      const digits = phoneStr.replace(/\D/g, '');
      const last10 = digits.length >= 10 ? digits.slice(-10) : digits;

      // Rate limiting: minimum 30 seconds cooldown between OTP requests
      const [recent] = await pool.query(
        `SELECT created_at FROM otp_verifications 
         WHERE (phone = ? OR phone = ? OR (LENGTH(?) = 10 AND RIGHT(REPLACE(phone, '+', ''), 10) = ?))
           AND verified_at IS NULL 
         ORDER BY id DESC LIMIT 1`,
        [phoneStr, digits, last10, last10]
      );

      if (recent.length > 0 && recent[0].created_at) {
        const diffSeconds = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
        if (diffSeconds < 30) {
          return ApiResponse.error(
            res,
            `Please wait ${Math.ceil(30 - diffSeconds)} seconds before requesting a new OTP.`,
            429
          );
        }
      }

      // Delete old unverified OTPs for this phone
      await pool.query(
        `DELETE FROM otp_verifications 
         WHERE (phone = ? OR phone = ? OR (LENGTH(?) = 10 AND RIGHT(REPLACE(phone, '+', ''), 10) = ?))
           AND verified_at IS NULL`,
        [phoneStr, digits, last10, last10]
      );

      // Generate OTP (use demo OTP for test numbers, else generate random 6 digits)
      const isDemoNumber = ['9999999999', '1234567890'].includes(last10) || process.env.USE_DEMO_OTP === 'true';
      const otp = isDemoNumber ? DEMO_OTP : generateRandomOtp();

      // Insert new OTP record (expires in 10 minutes)
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
      await pool.query(
        `INSERT INTO otp_verifications (phone, otp, device_token, device_type, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [phoneStr, otp, device_token || '', device_type || 'android', expiresAt]
      );

      // Send OTP via WhatsApp Cloud API
      const whatsappRes = await WhatsAppService.sendOtp(phoneStr, otp);

      const isSent = Boolean(whatsappRes && whatsappRes.success);
      const resMessage = isSent
        ? 'OTP resent successfully to your WhatsApp number.'
        : `OTP regenerated, but WhatsApp delivery failed: ${whatsappRes?.error || 'Meta API error'}.`;

      return ApiResponse.success(
        res,
        {
          phone: phoneStr,
          otp_sent: isSent,
          whatsapp_sent: isSent,
          whatsapp_status: isSent ? 'DELIVERED' : 'FAILED',
          whatsapp_message_id: whatsappRes?.messageId || null,
          whatsapp_error: isSent ? null : (whatsappRes?.error || null),
          expires_in_minutes: OTP_TTL_MINUTES,
          debug_otp: otp,
        },
        resMessage
      );
    } catch (error) {
      console.error('Resend OTP Error:', error);
      return ApiResponse.error(res, 'Failed to resend OTP.', 500);
    }
  }

  static async verifyOtp(req, res) {
    try {
      const { phone, otp } = req.body;

      if (!phone || !otp) {
        return ApiResponse.error(res, 'Phone and OTP are required.', 422);
      }

      const phoneStr = normalizePhone(phone);
      const digits = phoneStr.replace(/\D/g, '');
      const last10 = digits.length >= 10 ? digits.slice(-10) : digits;

      const [records] = await pool.query(
        `SELECT * FROM otp_verifications 
         WHERE (phone = ? OR phone = ? OR (LENGTH(?) = 10 AND RIGHT(REPLACE(phone, '+', ''), 10) = ?)) 
           AND verified_at IS NULL 
         ORDER BY id DESC LIMIT 1`,
        [phoneStr, digits, last10, last10]
      );

      if (records.length === 0) {
        return ApiResponse.error(res, 'OTP not found. Please request a new one.', 422);
      }

      const record = records[0];
      const now = new Date();

      if (new Date(record.expires_at) < now) {
        return ApiResponse.error(res, 'OTP has expired. Please request a new one.', 422);
      }

      if (record.otp !== otp) {
        return ApiResponse.error(res, 'Invalid OTP.', 422);
      }

      // Mark OTP as verified
      await pool.query('UPDATE otp_verifications SET verified_at = NOW() WHERE id = ?', [record.id]);

      // Fetch user
      const [users] = await pool.query(
        'SELECT * FROM users WHERE phone = ? OR phone = ? OR (LENGTH(?) = 10 AND RIGHT(REPLACE(phone, "+", ""), 10) = ?) LIMIT 1',
        [phoneStr, digits, last10, last10]
      );
      if (users.length === 0) {
        return ApiResponse.error(res, 'User not found. Please request OTP again.', 422);
      }

      let user = users[0];
      if (user.is_blocked) {
        return ApiResponse.error(res, 'Your account has been suspended. Contact an administrator.', 403);
      }

      const loginMethod = String(user.login_method || '').toLowerCase().trim();
      if (loginMethod === 'email_otp' || loginMethod === 'google') {
        return ApiResponse.error(
          res,
          'This account is registered with Google Email. Please login using your email.',
          422
        );
      }

      // Update user last login
      await pool.query(
        'UPDATE users SET platform = ?, device_token = ?, device_type = ?, last_login_at = NOW() WHERE id = ?',
        [record.device_type || 'android', record.device_token || '', record.device_type || 'android', user.id]
      );

      const [updatedUserRows] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
      user = updatedUserRows[0];

      const token = generateToken(user.id);
      const isProfileComplete = checkIsProfileComplete(user);
      const isCategorySelected = await checkIsCategorySelected(user.id);

      return ApiResponse.success(
        res,
        {
          token: token,
          isProfileComplete,
          isCategorySelected,
          user: toProfileFieldsArray(user, { isProfileComplete, isCategorySelected }),
        },
        'Login successful.'
      );
    } catch (error) {
      console.error('Verify OTP Error:', error);
      return ApiResponse.error(res, 'OTP verification failed.', 500);
    }
  }

  static async logout(req, res) {
    try {
      // In JWT stateless auth, logout completes by client discarding token
      return ApiResponse.success(res, null, 'Logged out.');
    } catch (error) {
      return ApiResponse.error(res, 'Logout failed.', 500);
    }
  }
}

module.exports = AuthController;
