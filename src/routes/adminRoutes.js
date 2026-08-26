const express = require('express');
const router = express.Router();

const AdminDashboardController = require('../controllers/admin/dashboardController');
const AdminUserController = require('../controllers/admin/userController');
const AdminContentController = require('../controllers/admin/contentController');
const AdminCategoryController = require('../controllers/admin/categoryController');
const AdminBannerController = require('../controllers/admin/bannerController');
const AdminMonetizationController = require('../controllers/admin/monetizationController');
const AdminModerationController = require('../controllers/admin/moderationController');
const AdminSettingsController = require('../controllers/admin/settingsController');

const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const upload = require('../middleware/uploadMiddleware');

// Protect all admin routes with authentication & admin privilege check
router.use(authMiddleware);
router.use(adminMiddleware);

// ── 1. Admin Dashboard ────────────────────────────────────────────────────────
router.get('/dashboard', AdminDashboardController.index);

// ── 2. User Management ────────────────────────────────────────────────────────
router.get('/users', AdminUserController.index);
router.get('/users/:id', AdminUserController.show);
router.put('/users/:id', AdminUserController.update);
router.post('/users/:id', AdminUserController.update);
router.post('/users/:id/wallet', AdminUserController.updateWallet);

// ── 3. Content Management (Stories & Episodes) ───────────────────────────────
router.get('/stories', AdminContentController.listStories);
router.put('/stories/:id/status', AdminContentController.updateStoryStatus);
router.post('/stories/:id/status', AdminContentController.updateStoryStatus);
router.delete('/stories/:id', AdminContentController.deleteStory);
router.get('/episodes', AdminContentController.listEpisodes);
router.delete('/episodes/:id', AdminContentController.deleteEpisode);

// ── 4. Category Management ───────────────────────────────────────────────────
router.get('/categories', AdminCategoryController.index);
router.post('/categories', upload.single('image'), AdminCategoryController.store);
router.put('/categories/:id', upload.single('image'), AdminCategoryController.update);
router.post('/categories/:id', upload.single('image'), AdminCategoryController.update);
router.delete('/categories/:id', AdminCategoryController.destroy);

// ── 5. Banners Management ────────────────────────────────────────────────────
router.get('/banners', AdminBannerController.index);
router.post('/banners', upload.single('image'), AdminBannerController.store);
router.put('/banners/:id', upload.single('image'), AdminBannerController.update);
router.post('/banners/:id', upload.single('image'), AdminBannerController.update);
router.delete('/banners/:id', AdminBannerController.destroy);

// ── 6. Monetization & Financials ─────────────────────────────────────────────
router.get('/plans', AdminMonetizationController.listPlans);
router.post('/plans', AdminMonetizationController.storePlan);
router.put('/plans/:id', AdminMonetizationController.updatePlan);
router.delete('/plans/:id', AdminMonetizationController.deletePlan);

router.get('/coin-packs', AdminMonetizationController.listPacks);
router.post('/coin-packs', AdminMonetizationController.storePack);
router.put('/coin-packs/:id', AdminMonetizationController.updatePack);
router.delete('/coin-packs/:id', AdminMonetizationController.deletePack);

router.get('/transactions', AdminMonetizationController.listTransactions);

// ── 7. Content Moderation (Reviews & Comments) ───────────────────────────────
router.get('/reviews', AdminModerationController.listReviews);
router.delete('/reviews/:id', AdminModerationController.deleteReview);
router.get('/comments', AdminModerationController.listComments);
router.delete('/comments/:id', AdminModerationController.deleteComment);

// ── 8. Notifications & System Settings ───────────────────────────────────────
router.get('/settings', AdminSettingsController.getSettings);
router.post('/settings', AdminSettingsController.updateSettings);
router.post('/notifications/send', AdminSettingsController.sendNotification);

router.post('/faqs', AdminSettingsController.storeFaq);
router.put('/faqs/:id', AdminSettingsController.updateFaq);
router.delete('/faqs/:id', AdminSettingsController.deleteFaq);

module.exports = router;
