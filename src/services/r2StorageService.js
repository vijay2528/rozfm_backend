const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
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
 * Upload an in-memory file buffer to Cloudflare R2 using single or multipart upload.
 * @param {Object} file - Multer file object (buffer, originalname, mimetype)
 * @param {string} folder - Destination folder (e.g. 'episodes')
 * @returns {Promise<string>} Public URL of uploaded object
 */
async function uploadToR2(file, folder = 'avatars') {
  if (!file || !file.buffer) {
    throw new Error('No file buffer provided for R2 upload.');
  }

  const ext = path.extname(file.originalname) || (file.mimetype && file.mimetype.includes('audio') ? '.mp3' : '.jpg');
  const filename = `${folder}/${crypto.randomBytes(16).toString('hex')}${ext}`;
  const contentType = file.mimetype || 'application/octet-stream';
  const buffer = file.buffer;
  const fileSize = buffer.length;

  // Use multipart upload for files larger than 10MB (e.g., 100MB audio files)
  const MULTIPART_THRESHOLD = 10 * 1024 * 1024; // 10MB

  if (fileSize > MULTIPART_THRESHOLD) {
    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
    const createRes = await r2Client.send(
      new CreateMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: filename,
        ContentType: contentType,
      })
    );

    const uploadId = createRes.UploadId;
    const parts = [];

    try {
      let partNumber = 1;
      for (let start = 0; start < fileSize; start += CHUNK_SIZE) {
        const end = Math.min(start + CHUNK_SIZE, fileSize);
        const chunkBuffer = buffer.subarray(start, end);

        const partRes = await r2Client.send(
          new UploadPartCommand({
            Bucket: BUCKET_NAME,
            Key: filename,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: chunkBuffer,
          })
        );

        parts.push({
          ETag: partRes.ETag,
          PartNumber: partNumber,
        });

        partNumber++;
      }

      await r2Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: BUCKET_NAME,
          Key: filename,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        })
      );
    } catch (err) {
      // Clean up incomplete multipart upload on failure
      try {
        await r2Client.send(
          new AbortMultipartUploadCommand({
            Bucket: BUCKET_NAME,
            Key: filename,
            UploadId: uploadId,
          })
        );
      } catch (_) {}
      throw err;
    }
  } else {
    // Single-part upload for smaller files (< 10MB)
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filename,
      Body: buffer,
      ContentType: contentType,
    });
    await r2Client.send(command);
  }

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
