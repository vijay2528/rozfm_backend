const multer = require('multer');

// Store file in memory buffer for R2 upload
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!file) return cb(null, true);
  const mimetype = file.mimetype || '';
  const originalname = file.originalname || '';

  if (
    mimetype.startsWith('image/') ||
    mimetype.startsWith('audio/') ||
    mimetype.startsWith('video/') ||
    /\.(jpg|jpeg|png|webp|gif|mp3|wav|m4a|aac|ogg|flac|mp4|mkv|aac|opus)$/i.test(originalname)
  ) {
    cb(null, true);
  } else {
    cb(null, true); // Allow media uploads gracefully
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
  fileFilter: fileFilter,
});

// Middleware wrapper to handle Multer errors gracefully
const handleUpload = (multerMiddleware) => {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) {
        console.error('[Multer Error]:', err.message);
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed.',
        });
      }
      next();
    });
  };
};

upload.storyMedia = handleUpload(upload.any());
upload.episodeMedia = handleUpload(upload.any());

module.exports = upload;


