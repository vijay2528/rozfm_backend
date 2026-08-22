const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return ApiResponse.error(res, 'Unauthenticated.', 401);
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return ApiResponse.error(res, 'Unauthenticated.', 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rozfm_super_secret_jwt_key_2026');

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [decoded.id]);
    if (rows.length === 0) {
      return ApiResponse.error(res, 'User not found.', 401);
    }

    const user = rows[0];
    if (user.is_blocked) {
      return ApiResponse.error(res, 'Your account has been suspended. Contact an administrator.', 403);
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
      return ApiResponse.error(res, 'Unauthenticated.', 401);
    }
    return ApiResponse.error(res, 'Internal server error', 500);
  }
}

module.exports = authMiddleware;
