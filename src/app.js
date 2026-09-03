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

// Auto-detect and fix multipart form-data requests sent with application/json header
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('boundary=')) {
    const boundary = contentType.substring(contentType.indexOf('boundary='));
    req.headers['content-type'] = `multipart/form-data; ${boundary}`;
    return next();
  }

  if (['POST', 'PUT', 'PATCH'].includes(req.method) && contentType) {
    let peeked = false;

    const onData = (chunk) => {
      if (peeked) return;
      peeked = true;

      req.removeListener('data', onData);
      req.unshift(chunk);

      const str = chunk.toString('utf8', 0, 100).trim();
      if (str.startsWith('----------------------------') || str.startsWith('------') || str.startsWith('--')) {
        const firstLine = str.split('\r\n')[0].trim();
        const boundary = firstLine.replace(/^--/, '');
        if (boundary) {
          req.headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
        } else {
          delete req.headers['content-type'];
        }
      }
      next();
    };

    req.once('data', onData);

    setImmediate(() => {
      if (!peeked) {
        req.removeListener('data', onData);
        next();
      }
    });
    return;
  }

  next();
});

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

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
