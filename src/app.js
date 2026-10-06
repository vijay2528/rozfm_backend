/**
 * Express Application Configuration & Middleware Setup
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const path = require('path');

const apiV1Routes = require('./routes/apiV1Routes');
const adminRoutes = require('./routes/adminRoutes');
const ApiResponse = require('./utils/apiResponse');

const app = express();

// Global Middleware Stack
app.use(helmet());
app.use(cors());

// Request body parsers
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({
  limit: '500mb',
  extended: true
}));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Helper to resolve HTML file paths from src or root folder
const fs = require('fs');
const resolveHtmlPath = (fileName, fallbackName) => {
  const candidates = [
    path.join(__dirname, fileName),
    path.join(__dirname, '..', fileName),
    fallbackName ? path.join(__dirname, fallbackName) : null,
    fallbackName ? path.join(__dirname, '..', fallbackName) : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(__dirname, fileName);
};

// Serve Privacy Policy HTML Page
const servePrivacyPolicy = (req, res) => {
  res.sendFile(resolveHtmlPath('privacy_policy.html', 'privacy.html'));
};

const privacyRoutes = [
  '/privacy-policy',
];
privacyRoutes.forEach((route) => app.get(route, servePrivacyPolicy));

// Serve Refund Policy HTML Page
const serveRefundPolicy = (req, res) => {
  res.sendFile(resolveHtmlPath('refund_policy.html', 'refund.html'));
};

const refundRoutes = [
  '/refund-policy',
];
refundRoutes.forEach((route) => app.get(route, serveRefundPolicy));

// Serve Terms and Conditions HTML Page
const serveTermsAndConditions = (req, res) => {
  res.sendFile(resolveHtmlPath('terms_and_condition.html', 'terms.html'));
};

const termsRoutes = [
  '/terms-and-condition',
];
termsRoutes.forEach((route) => app.get(route, serveTermsAndConditions));

// Serve Copyright Policy HTML Page
const serveCopyrightPolicy = (req, res) => {
  res.sendFile(resolveHtmlPath('copy_right_policy.html', 'copyright.html'));
};

app.get('/copy-right-policy', serveCopyrightPolicy);

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  return ApiResponse.success(
    res,
    {
      uptime: process.uptime(),
      timestamp: new Date()
    },
    'ROZ FM Backend service is healthy'
  );
});

// Admin Routes
app.use('/api/v1/admin', adminRoutes);
app.use('/admin', adminRoutes);

// API Routes (v1)
app.use('/api/v1', apiV1Routes);

// 404 Route Handler
app.use((req, res) => {
  return ApiResponse.error(
    res,
    `Cannot ${req.method} ${req.originalUrl} - Route Not Found`,
    404
  );
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err.stack);

  return ApiResponse.error(
    res,
    err.message || 'Internal Server Error',
    err.status || 500
  );
});

module.exports = app;