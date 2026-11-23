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

// ── Razorpay Webhook — must capture raw body BEFORE express.json() ────────────
const RazorpayWebhookController = require('./controllers/razorpayWebhookController');
app.post(
  '/api/v1/webhook/razorpay',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    req.rawBody = req.body ? req.body.toString('utf8') : '';
    try { req.body = JSON.parse(req.rawBody); } catch (_) { req.body = {}; }
    next();
  },
  RazorpayWebhookController.handle
);
// ─────────────────────────────────────────────────────────────────────────────

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
  '/privacy-policy.html',
  '/privacy_policy',
  '/privacy_policy.html',
  '/privacy',
  '/privacy.html',
  '/api/privacy-policy',
  '/api/v1/privacy-policy',
];
privacyRoutes.forEach((route) => app.get(route, servePrivacyPolicy));

// Serve Refund Policy HTML Page
const serveRefundPolicy = (req, res) => {
  res.sendFile(resolveHtmlPath('refund_policy.html', 'refund.html'));
};

const refundRoutes = [
  '/refund-policy',
  '/refund-policy.html',
  '/refund_policy',
  '/refund_policy.html',
  '/refund',
  '/refund.html',
  '/api/refund-policy',
  '/api/v1/refund-policy',
];
refundRoutes.forEach((route) => app.get(route, serveRefundPolicy));

// Serve Terms and Conditions HTML Page
const serveTermsAndConditions = (req, res) => {
  res.sendFile(resolveHtmlPath('terms_and_condition.html', 'terms.html'));
};

const termsRoutes = [
  '/terms-and-condition',
  '/terms-and-condition.html',
  '/terms-and-conditions',
  '/terms-and-conditions.html',
  '/terms_and_condition',
  '/terms_and_condition.html',
  '/terms_and_conditions',
  '/terms_and_conditions.html',
  '/terms',
  '/terms.html',
  '/terms-of-service',
  '/terms-of-service.html',
  '/terms-of-use',
  '/terms-of-use.html',
  '/api/terms-and-condition',
  '/api/v1/terms-and-condition',
  '/api/terms-and-conditions',
  '/api/v1/terms-and-conditions',
];
termsRoutes.forEach((route) => app.get(route, serveTermsAndConditions));

// Serve Copyright Policy HTML Page
const serveCopyrightPolicy = (req, res) => {
  res.sendFile(resolveHtmlPath('copy_right_policy.html', 'copyright.html'));
};

const copyrightRoutes = [
  '/copy-right-policy',
  '/copy-right-policy.html',
  '/copyright-policy',
  '/copyright-policy.html',
  '/copy_right_policy',
  '/copy_right_policy.html',
  '/copyright',
  '/copyright.html',
  '/api/copy-right-policy',
  '/api/v1/copy-right-policy',
  '/api/copyright-policy',
  '/api/v1/copyright-policy',
];
copyrightRoutes.forEach((route) => app.get(route, serveCopyrightPolicy));

// Serve Preview Landing Page
const servePreviewPage = (req, res) => {
  res.sendFile(resolveHtmlPath('preview.html'));
};
app.get('/preview', servePreviewPage);
app.get('/preview.html', servePreviewPage);

// Serve Logo
const serveLogo = (req, res) => {
  const filePath = path.join(__dirname, '..', 'logo.png');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/png');
    return res.sendFile(filePath);
  }
  const altPath = path.join(__dirname, 'logo.png');
  if (fs.existsSync(altPath)) {
    res.setHeader('Content-Type', 'image/png');
    return res.sendFile(altPath);
  }
  return res.status(404).send('Logo not found');
};
app.get('/logo.png', serveLogo);

// Serve Story Preview Landing Page (WhatsApp share, web preview & deep linking)
const StoryWebController = require('./controllers/storyWebController');
app.get('/stories/:id', StoryWebController.renderStoryPage);
app.get('/stories/:id/:slug?', StoryWebController.renderStoryPage);

// Serve app-ads.txt for Google AdMob verification
const serveAppAdsTxt = (req, res) => {
  const filePath = path.join(__dirname, '..', 'app-ads.txt');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.sendFile(filePath);
  }
  const altPath = path.join(__dirname, 'app-ads.txt');
  if (fs.existsSync(altPath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.sendFile(altPath);
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send('google.com, pub-6312932745538617, DIRECT, f08c47fec0942fa0\n');
};

app.get('/app-ads.txt', serveAppAdsTxt);
app.get('/api/v1/app-ads.txt', serveAppAdsTxt);

// Serve .well-known/assetlinks.json for Android App Links verification
const serveAssetLinks = (req, res) => {
  const candidates = [
    path.join(__dirname, '.well-known', 'assetlinks.json'),
    path.join(__dirname, '..', '.well-known', 'assetlinks.json'),
    path.join(process.cwd(), '.well-known', 'assetlinks.json'),
    path.join(process.cwd(), 'src', '.well-known', 'assetlinks.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'application/json');
      return res.sendFile(candidate);
    }
  }

  // Fallback inline content matching Android package configuration
  res.setHeader('Content-Type', 'application/json');
  return res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.rozfm',
        sha256_cert_fingerprints: [
          'BF:0C:83:9B:98:AF:93:44:B3:FB:C7:1B:6A:19:58:CE:05:99:7E:75:6B:50:CE:D3:BA:A9:B8:53:16:22:78:15',
          '44:0D:B5:B6:7F:62:9C:80:2E:8E:C8:89:E8:56:8F:A5:7D:0B:65:50:25:15:30:EC:36:EC:BF:82:F9:55:13:F6',
          '58:C9:50:C4:74:17:7F:6A:13:60:E7:28:65:50:C8:1B:FB:2A:CC:DF:C1:05:E5:A7:43:1D:4C:03:7E:AD:54:2A',
        ],
      },
    },
  ]);
};

app.get('/.well-known/assetlinks.json', serveAssetLinks);
app.get('/.well-known/assetlinks', serveAssetLinks);
app.get('/assetlinks.json', serveAssetLinks);
app.get('/api/v1/.well-known/assetlinks.json', serveAssetLinks);
app.get('/api/.well-known/assetlinks.json', serveAssetLinks);

// Serve static .well-known directory
app.use('/.well-known', express.static(path.join(__dirname, '.well-known')));
app.use('/.well-known', express.static(path.join(__dirname, '..', '.well-known')));

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

// API Routes (v1 & alias /api)
app.use('/api/v1', apiV1Routes);
app.use('/api', apiV1Routes);

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