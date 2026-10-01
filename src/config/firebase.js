/**
 * Firebase Admin SDK Initialization
 * Singleton — initialized once and reused across the app.
 * Compatible with firebase-admin v12 modular API.
 */
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');

const serviceAccountPath = path.resolve(
  __dirname,
  '../../rozfm-d8966-firebase-adminsdk-fbsvc-1716955377.json'
);
const serviceAccount = require(serviceAccountPath);

// Initialize only once (safe for hot-reload / multiple requires)
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
  console.log('[Firebase] Admin SDK initialized for project:', serviceAccount.project_id);
}

const firebaseApp = getApp();

module.exports = {
  firebaseApp,
  getMessaging,
};
