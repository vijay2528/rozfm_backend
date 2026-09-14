const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

function extractToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader) {
    const str = authHeader.toString().trim();
    if (/^bearer\s+/i.test(str)) {
      return str.replace(/^bearer\s+/i, '').trim();
    }
    return str;
  }
  if (req.headers['x-access-token']) {
    return req.headers['x-access-token'].toString().trim();
  }
  if (req.query) {
    if (req.query.token) return req.query.token.toString().trim();
    if (req.query.auth_token) return req.query.auth_token.toString().trim();
    if (req.query.authorization) {
      const str = req.query.authorization.toString().trim();
      return /^bearer\s+/i.test(str) ? str.replace(/^bearer\s+/i, '').trim() : str;
    }
  }
  if (req.body) {
    if (req.body.token) return req.body.token.toString().trim();
    if (req.body.auth_token) return req.body.auth_token.toString().trim();
  }
  return null;
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractToken(req);
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

async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rozfm_super_secret_jwt_key_2026');

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [decoded.id]);
    if (rows.length > 0 && !rows[0].is_blocked) {
      req.user = rows[0];
      req.token = token;
    }
  } catch (error) {
    // Silently continue for optional authentication
  }
  return next();
}

authMiddleware.optional = optionalAuth;

module.exports = authMiddleware;

