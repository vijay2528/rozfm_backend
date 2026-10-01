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
  // 1. Try local dev file paths
  const candidatePaths = [
    path.resolve(__dirname, '../../rozfm-d8966-firebase-adminsdk-fbsvc-1716955377.json'),
    path.resolve(__dirname, '../../../rozfm-d8966-firebase-adminsdk-fbsvc-1716955377.json'),
    path.resolve(process.cwd(), 'rozfm-d8966-firebase-adminsdk-fbsvc-1716955377.json'),
  ];
  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      return require(filePath);
    }
  }

  // 2. Fall back to environment variable (production server)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      console.warn('[Firebase] Warning: FIREBASE_SERVICE_ACCOUNT_JSON env variable is not valid JSON.');
      return null;
    }
  }

  return null;
}

// Initialize only once (safe for hot-reload / multiple requires)
if (!getApps().length) {
  const serviceAccount = loadServiceAccount();
  if (serviceAccount) {
    initializeApp({
      credential: cert(serviceAccount),
    });
    console.log('[Firebase] Admin SDK initialized for project:', serviceAccount.project_id);
  } else {
    console.warn('[Firebase] Notice: Service account not found. Push notifications will be skipped.');
  }
}

const firebaseApp = getApps().length ? getApp() : null;

module.exports = {
  firebaseApp,
  getMessaging: () => (getApps().length ? getMessaging() : {
    send: async () => null,
    sendEachForMulticast: async () => ({ successCount: 0, failureCount: 0, responses: [] }),
  }),
};
