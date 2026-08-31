const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

function generateAdminToken(userId, role) {
  return jwt.sign(
    { id: userId, role: role || 'admin' },
    process.env.JWT_SECRET || 'rozfm_super_secret_jwt_key_2026',
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

class AdminAuthController {
  /**
   * POST /api/v1/admin/login or /api/v1/admin/auth/login
   * Authenticate admin user with email/phone and password
   */
  static async login(req, res) {
    try {
      const { email, phone, username, password } = req.body;
      const loginIdentifier = (email || phone || username || '').trim();

      if (!loginIdentifier || !password) {
        return ApiResponse.error(res, 'Email and password are required.', 422);
      }

      // Query user by email or phone
      const [rows] = await pool.query(
        'SELECT * FROM users WHERE (email = ? OR phone = ?) LIMIT 1',
        [loginIdentifier.toLowerCase(), loginIdentifier]
      );

      if (rows.length === 0) {
        return ApiResponse.error(res, 'Invalid email or password.', 401);
      }

      const user = rows[0];

      // Check if user account is blocked
      if (user.is_blocked) {
        return ApiResponse.error(res, 'Your account has been suspended. Contact an administrator.', 403);
      }

      // Check admin role / privileges
      const userRole = (user.role || user.subscription_type || '').toLowerCase();
      const isAdmin = userRole === 'admin' || user.is_admin === 1 || user.is_admin === true;

      if (!isAdmin) {
        return ApiResponse.error(res, 'Access denied. Administrator rights required.', 403);
      }

      // Verify password
      if (!user.password) {
        return ApiResponse.error(res, 'Password authentication is not configured for this account.', 401);
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return ApiResponse.error(res, 'Invalid email or password.', 401);
      }

      // Update last login timestamp
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

      // Generate JWT Token
      const token = generateAdminToken(user.id, user.role || 'admin');

      return ApiResponse.success(
        res,
        {
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role || 'admin',
            last_login_at: new Date().toISOString(),
          },
        },
        'Admin login successful.'
      );
    } catch (error) {
      console.error('[Admin Auth Controller] Login Error:', error);
      return ApiResponse.error(res, 'Admin login failed.', 500);
    }
  }

  /**
   * POST /api/v1/admin/logout or /api/v1/admin/auth/logout
   * Logout admin user (stateless JWT invalidation signal)
   */
  static async logout(req, res) {
    try {
      return ApiResponse.success(res, null, 'Admin logged out successfully.');
    } catch (error) {
      console.error('[Admin Auth Controller] Logout Error:', error);
      return ApiResponse.error(res, 'Admin logout failed.', 500);
    }
  }
}

module.exports = AdminAuthController;
