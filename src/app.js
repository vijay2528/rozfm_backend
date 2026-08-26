/**
 * Express Application Configuration & Middleware Setup
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const apiV1Routes = require('./routes/apiV1Routes');
const adminRoutes = require('./routes/adminRoutes');
const ApiResponse = require('./utils/apiResponse');

const app = express();

// Global Middleware Stack
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  return ApiResponse.success(res, { uptime: process.uptime(), timestamp: new Date() }, 'ROZ FM Backend service is healthy');
});

// API Routes (v1)
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1', apiV1Routes);

// 404 Route Handler
app.use((req, res) => {
  return ApiResponse.error(res, `Cannot ${req.method} ${req.originalUrl} - Route Not Found`, 404);
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err.stack);
  return ApiResponse.error(res, err.message || 'Internal Server Error', err.status || 500);
});

module.exports = app;
