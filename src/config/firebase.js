/**
 * Firebase Admin SDK Initialization
 * Singleton — initialized once and reused across the app.
 * Compatible with firebase-admin v12 modular API.
 *
 * Service account loading priority:
 *  1. JSON file on disk (local dev)
 *  2. FIREBASE_SERVICE_ACCOUNT_JSON env variable (production / Hostinger)
 */
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');
const fs = require('fs');

function loadServiceAccount() {
  // 1. Try the JSON file first (local dev)
  const filePath = path.resolve(
    __dirname,
    '../../rozfm-d8966-firebase-adminsdk-fbsvc-1716955377.json'
  );
  if (fs.existsSync(filePath)) {
    return require(filePath);
  }

  // 2. Fall back to environment variable (production server)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('[Firebase] FIREBASE_SERVICE_ACCOUNT_JSON env variable is not valid JSON.');
    }
  }

  throw new Error(
    '[Firebase] Service account not found. ' +
    'Either place the JSON file in the project root or set FIREBASE_SERVICE_ACCOUNT_JSON env variable.'
  );
}

// Initialize only once (safe for hot-reload / multiple requires)
if (!getApps().length) {
  const serviceAccount = loadServiceAccount();
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
