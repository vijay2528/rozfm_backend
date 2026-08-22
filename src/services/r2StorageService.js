const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const crypto = require('crypto');

const r2Client = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || 'auto',
  endpoint: process.env.AWS_ENDPOINT || 'https://a53fd3e169f03dd3d8f4ebb32906b818.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.AWS_BUCKET || 'rozfm';
const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

/**
 * Upload an in-memory file buffer to Cloudflare R2.
 * @param {Object} file - Multer file object (buffer, originalname, mimetype)
 * @param {string} folder - Destination folder (e.g. 'avatars')
 * @returns {Promise<string>} Public URL of uploaded object
 */
async function uploadToR2(file, folder = 'avatars') {
  if (!file || !file.buffer) {
    throw new Error('No file buffer provided for R2 upload.');
  }

  const ext = path.extname(file.originalname) || '.jpg';
  const filename = `${folder}/${crypto.randomBytes(16).toString('hex')}${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: filename,
    Body: file.buffer,
    ContentType: file.mimetype || 'image/jpeg',
  });

  await r2Client.send(command);

  // Return full public URL
  return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${filename}`;
}

/**
 * Delete an object from Cloudflare R2 by key or full URL.
 * @param {string} keyOrUrl 
 */
async function deleteFromR2(keyOrUrl) {
  if (!keyOrUrl) return;

  let key = keyOrUrl;
  if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
    const urlObj = new URL(keyOrUrl);
    key = urlObj.pathname.replace(/^\//, '');
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    await r2Client.send(command);
  } catch (err) {
    console.error(`Failed to delete key ${key} from R2:`, err.message);
  }
}

module.exports = {
  uploadToR2,
  deleteFromR2,
};
