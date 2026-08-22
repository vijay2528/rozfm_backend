const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const MeController = require('../controllers/meController');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// ── Public Routes ─────────────────────────────────────────────────────────────
router.post('/auth/register', AuthController.register);
router.post('/auth/login', AuthController.login);
router.post('/auth/verify-otp', AuthController.verifyOtp);

// ── Authenticated User Routes ──────────────────────────────────────────────────
router.use(authMiddleware);

router.post('/auth/logout', AuthController.logout);

// Profile endpoints (supports both /me and /user/profile for full compatibility)
router.get('/me', MeController.show);
router.put('/me', upload.single('image'), MeController.update);
router.post('/me', upload.single('image'), MeController.update);

router.get('/user/profile', MeController.show);
router.put('/user/profile', upload.single('image'), MeController.update);
router.post('/user/profile', upload.single('image'), MeController.update);

module.exports = router;
