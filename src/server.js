/**
 * Server Entry Point
 */
require('dotenv').config();
const app = require('./app');
const { checkConnection } = require('./config/db');

const PORT = process.env.PORT || 5000;

// Verify MySQL Database connection, then start server
const startServer = async () => {
  try {
    await checkConnection();

    const server = app.listen(PORT, () => {
      console.log(`=================================`);
      console.log(`🚀 ROZ FM Backend Running`);
      console.log(`Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`Port        : ${PORT}`);
      console.log(`API Base    : http://localhost:${PORT}/api/v1`);
      console.log(`API Health  : http://localhost:${PORT}/api/health`);
      console.log(`=================================`);
    });

    // Configure 10-minute socket timeouts for large audio file uploads (e.g. 100MB+)
    server.timeout = 10 * 60 * 1000;
    server.headersTimeout = 10 * 60 * 1000 + 5000;
    server.requestTimeout = 10 * 60 * 1000;

    // Handle Unhandled Rejections & Uncaught Exceptions
    process.on('unhandledRejection', (err) => {
      console.error(`[Unhandled Rejection] ${err.message}`);
    });

    process.on('SIGTERM', () => {
      console.log('SIGTERM received. Shutting down gracefully...');
      server.close(() => console.log('Process terminated.'));
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

startServer();
