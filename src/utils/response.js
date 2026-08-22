/**
 * Standardized API Response Utilities
 */

/**
 * Send a success HTTP response
 * @param {import('express').Response} res 
 * @param {any} data 
 * @param {string} message 
 * @param {number} statusCode 
 */
const sendSuccess = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    status: 'success',
    message,
    data,
  });
};

/**
 * Send an error HTTP response
 * @param {import('express').Response} res 
 * @param {string} message 
 * @param {number} statusCode 
 * @param {any} errors 
 */
const sendError = (res, message = 'Internal Server Error', statusCode = 500, errors = null) => {
  return res.status(statusCode).json({
    status: 'error',
    message,
    errors,
  });
};

module.exports = {
  sendSuccess,
  sendError,
};
