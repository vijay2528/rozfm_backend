const multer = require('multer');

// Store file in memory buffer for R2 upload
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
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

module.exports = upload;

