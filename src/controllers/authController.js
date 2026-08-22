const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toProfileFieldsArray } = require('../utils/userPresenter');

const DEMO_OTP = '123456';
const OTP_TTL_MINUTES = 10;

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

      return ApiResponse.success(
        res,
        {
          token: token,
          user: toProfileFieldsArray(user),
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
      const { device_token, device_type, phone, email } = req.body;

      const phoneStr = phone ? normalizePhone(phone) : '';
      const emailStr = email ? email.toLowerCase().trim() : '';

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
        const [users] = await pool.query('SELECT * FROM users WHERE phone = ? LIMIT 1', [phoneStr]);
        let isNewUser = users.length === 0;
        let userId;

        if (isNewUser) {
          const placeholderEmail = `phone_${phoneStr.replace(/\D/g, '') || Date.now()}@app.local`;
          const dummyPassword = await bcrypt.hash(Math.random().toString(36), 10);
          const userName = `User ${phoneStr.slice(-4)}`;

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
          userId = user.id;

          await pool.query(
            'UPDATE users SET platform = ?, device_token = ?, device_type = ? WHERE id = ?',
            [device_type, device_token, device_type, userId]
          );
        }

        // Delete previous unverified OTPs for this phone
        await pool.query('DELETE FROM otp_verifications WHERE phone = ? AND verified_at IS NULL', [phoneStr]);

        // Insert new OTP verification record (expires in 10 minutes)
        const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
        await pool.query(
          `INSERT INTO otp_verifications (phone, otp, device_token, device_type, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          [phoneStr, DEMO_OTP, device_token, device_type, expiresAt]
        );

        return ApiResponse.success(
          res,
          {
            login_type: 'phone',
            phone: phoneStr,
            is_new_user: isNewUser,
            otp_sent: true,
            expires_in_minutes: OTP_TTL_MINUTES,
          },
          'OTP sent successfully.'
        );
      }

      // Email Login Flow
      if (emailStr !== '') {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [emailStr]);
        let isNewUser = users.length === 0;
        let user;

        if (isNewUser) {
          const nameFromEmail = emailStr.split('@')[0] || 'User';
          const dummyPassword = await bcrypt.hash(Math.random().toString(36), 10);

          const [insertRes] = await pool.query(
            `INSERT INTO users (name, email, password, platform, device_token, device_type, subscription_type, wallet_balance, login_method, last_login_at)
             VALUES (?, ?, ?, ?, ?, ?, 'free', 0.00, 'email_otp', NOW())`,
            [nameFromEmail, emailStr, dummyPassword, device_type, device_token, device_type]
          );

          const [newUserRows] = await pool.query('SELECT * FROM users WHERE id = ?', [insertRes.insertId]);
          user = newUserRows[0];
        } else {
          user = users[0];
          if (user.is_blocked) {
            return ApiResponse.error(res, 'Your account has been suspended. Contact an administrator.', 403);
          }

          await pool.query(
            'UPDATE users SET platform = ?, device_token = ?, device_type = ?, last_login_at = NOW() WHERE id = ?',
            [device_type, device_token, device_type, user.id]
          );

          const [updatedUserRows] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
          user = updatedUserRows[0];
        }

        const token = generateToken(user.id);

        return ApiResponse.success(
          res,
          {
            login_type: 'email',
            is_new_user: isNewUser,
            token: token,
            user: toProfileFieldsArray(user),
          },
          'Login successful.'
        );
      }
    } catch (error) {
      console.error('Login Error:', error);
      return ApiResponse.error(res, 'Login failed.', 500);
    }
  }

  static async verifyOtp(req, res) {
    try {
      const { phone, otp } = req.body;

      if (!phone || !otp) {
        return ApiResponse.error(res, 'Phone and OTP are required.', 422);
      }

      const phoneStr = normalizePhone(phone);

      const [records] = await pool.query(
        `SELECT * FROM otp_verifications 
         WHERE phone = ? AND verified_at IS NULL 
         ORDER BY id DESC LIMIT 1`,
        [phoneStr]
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
      const [users] = await pool.query('SELECT * FROM users WHERE phone = ? LIMIT 1', [phoneStr]);
      if (users.length === 0) {
        return ApiResponse.error(res, 'User not found. Please request OTP again.', 422);
      }

      let user = users[0];
      if (user.is_blocked) {
        return ApiResponse.error(res, 'Your account has been suspended. Contact an administrator.', 403);
      }

      // Update user last login
      await pool.query(
        'UPDATE users SET platform = ?, device_token = ?, device_type = ?, last_login_at = NOW() WHERE id = ?',
        [record.device_type || 'android', record.device_token || '', record.device_type || 'android', user.id]
      );

      const [updatedUserRows] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
      user = updatedUserRows[0];

      const token = generateToken(user.id);

      return ApiResponse.success(
        res,
        {
          token: token,
          user: toProfileFieldsArray(user),
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
