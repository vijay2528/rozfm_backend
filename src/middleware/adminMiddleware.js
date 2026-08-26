const ApiResponse = require('../utils/apiResponse');

/**
 * Middleware to check if authenticated user has admin privileges
 */
module.exports = function adminMiddleware(req, res, next) {
  if (!req.user) {
    return ApiResponse.error(res, 'Authentication required.', 401);
  }

  const role = (req.user.role || req.user.subscription_type || '').toLowerCase();
  const isAdmin = role === 'admin' || req.user.is_admin === 1 || req.user.is_admin === true;

  if (!isAdmin) {
    return ApiResponse.error(res, 'Access denied. Administrator rights required.', 403);
  }

  next();
};
