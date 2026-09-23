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
const AdminLanguageController = require('../controllers/admin/languageController');
const AdminRoleController = require('../controllers/admin/roleController');
const AdminAuthController = require('../controllers/admin/authController');
const AdminLocationController = require('../controllers/admin/locationController');
const AdminStreakSettingsController = require('../controllers/admin/streakSettingsController');
const AdminStoryAnalyticsController = require('../controllers/admin/storyAnalyticsController');
const AdminCreatorController = require('../controllers/admin/creatorController');
const AdminWithdrawalController = require('../controllers/admin/withdrawalController');
const AdminCreatorAnalyticsController = require('../controllers/admin/creatorAnalyticsController');
const AdminCreatorWithdrawalController = require('../controllers/admin/creatorWithdrawalController');
const AdminPublishedStoriesController = require('../controllers/admin/publishedStoriesController');
const AdminRevenueShareController = require('../controllers/admin/revenueShareController');

const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const upload = require('../middleware/uploadMiddleware');

// ── 0. Public Admin Auth Endpoints ───────────────────────────────────────────
router.post('/login', AdminAuthController.login);
router.post('/auth/login', AdminAuthController.login);

// Protect subsequent admin routes with authentication & admin privilege check
router.use(authMiddleware);
router.use(adminMiddleware);

// ── Protected Admin Auth Endpoints ──────────────────────────────────────────
router.post('/logout', AdminAuthController.logout);
router.post('/auth/logout', AdminAuthController.logout);

// ── 1. Admin Dashboard & Analytics ───────────────────────────────────────────
router.get('/dashboard', AdminDashboardController.index);
router.get('/story-analytics', AdminStoryAnalyticsController.getStoryAnalytics);
router.get('/stories/analytics', AdminStoryAnalyticsController.getStoryAnalytics);
router.get('/analytics/stories', AdminStoryAnalyticsController.getStoryAnalytics);

// ── 2. User Management ────────────────────────────────────────────────────────
router.get('/users', AdminUserController.index);
router.get('/users/:id', AdminUserController.show);
router.get('/users/:id/overview', AdminUserController.getOverview);
router.get('/users/:id/wallet-transactions', AdminUserController.getWalletTransactions);
router.get('/users/:id/listening-history', AdminUserController.getListeningHistory);
router.get('/users/:id/premium-status', AdminUserController.getPremiumStatus);
router.get('/users/:id/devices', AdminUserController.getDevices);
router.get('/users/:id/reports', AdminUserController.getReports);
router.post('/users', AdminUserController.store);
router.put('/users/:id', AdminUserController.update);
router.post('/users/:id', AdminUserController.update);
router.delete('/users/:id', AdminUserController.destroy);
router.post('/users/:id/wallet', AdminUserController.updateWallet);

// ── 3. Content Management (Stories & Episode Management) ───────────────────────────────
router.get('/stories', AdminContentController.listStories);
router.get('/stories/:id', AdminContentController.showStory);
router.post('/stories', upload.storyMedia, AdminContentController.storeStory);
router.put('/stories/:id', upload.storyMedia, AdminContentController.updateStory);
router.post('/stories/:id', upload.storyMedia, AdminContentController.updateStory);
router.put('/stories/:id/status', AdminContentController.updateStoryStatus);
router.post('/stories/:id/status', AdminContentController.updateStoryStatus);
router.delete('/stories/:id', AdminContentController.deleteStory);
// Story approval actions
router.post('/stories/:id/approve', AdminPublishedStoriesController.approve);
router.put('/stories/:id/approve', AdminPublishedStoriesController.approve);
router.post('/stories/:id/reject', AdminPublishedStoriesController.reject);
router.put('/stories/:id/reject', AdminPublishedStoriesController.reject);
router.post('/stories/:id/approval-status', AdminPublishedStoriesController.updateApprovalStatus);
router.put('/stories/:id/approval-status', AdminPublishedStoriesController.updateApprovalStatus);
router.get('/episodes', AdminContentController.listEpisodes);
router.get('/episodes/:id', AdminContentController.showEpisode);
router.post('/episodes', upload.episodeMedia, AdminContentController.storeEpisode);
router.put('/episodes/:id', upload.episodeMedia, AdminContentController.updateEpisode);
router.post('/episodes/:id', upload.episodeMedia, AdminContentController.updateEpisode);
router.delete('/episodes/:id', AdminContentController.deleteEpisode);

// ── 4. Category Management ───────────────────────────────────────────────────
router.get('/categories', AdminCategoryController.index);
router.post('/categories', upload.single('image'), AdminCategoryController.store);
router.put('/categories/:id', upload.single('image'), AdminCategoryController.update);
router.post('/categories/:id', upload.single('image'), AdminCategoryController.update);
router.delete('/categories/:id', AdminCategoryController.destroy);

// ── 5. Banners Management ────────────────────────────────────────────────────
router.get('/banners', AdminBannerController.index);
router.get('/banners/:id', AdminBannerController.show);
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
router.get('/coin-packs/:id', AdminMonetizationController.showPack);
router.post('/coin-packs', AdminMonetizationController.storePack);
router.put('/coin-packs/:id', AdminMonetizationController.updatePack);
router.post('/coin-packs/:id', AdminMonetizationController.updatePack);
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
router.get('/streak-settings', AdminStreakSettingsController.getSettings);
router.post('/streak-settings', AdminStreakSettingsController.updateSettings);
router.put('/streak-settings', AdminStreakSettingsController.updateSettings);
router.post('/notifications/send', AdminSettingsController.sendNotification);

router.post('/faqs', AdminSettingsController.storeFaq);
router.put('/faqs/:id', AdminSettingsController.updateFaq);
router.delete('/faqs/:id', AdminSettingsController.deleteFaq);

// ── 9. Language Management ───────────────────────────────────────────────────
router.get('/languages', AdminLanguageController.index);

// ── 10. User Roles & Permissions Management ──────────────────────────────────
router.get('/roles', AdminRoleController.index);

// ── 11. Location Management (Countries, States, Cities) ──────────────────────
router.get('/countries', AdminLocationController.listCountries);
router.post('/countries', AdminLocationController.storeCountry);
router.put('/countries/:id', AdminLocationController.updateCountry);
router.delete('/countries/:id', AdminLocationController.deleteCountry);

router.get('/states', AdminLocationController.listStates);
router.post('/states', AdminLocationController.storeState);
router.put('/states/:id', AdminLocationController.updateState);
router.delete('/states/:id', AdminLocationController.deleteState);

router.get('/cities', AdminLocationController.listCities);
router.post('/cities', AdminLocationController.storeCity);
router.put('/cities/:id', AdminLocationController.updateCity);
router.delete('/cities/:id', AdminLocationController.deleteCity);

// ── 12. Creator Management ───────────────────────────────────────────────────
router.get('/creators', AdminCreatorController.index);

// Creator Analytics — must be declared BEFORE /creators/:id to avoid param capture
router.get('/creators/analytics', AdminCreatorAnalyticsController.getAnalytics);

router.get('/creators/:id', AdminCreatorController.show);
router.post('/creators', upload.single('avatar'), AdminCreatorController.store);
router.post('/creators/invite', AdminCreatorController.store);
router.put('/creators/:id', upload.single('avatar'), AdminCreatorController.update);
router.post('/creators/:id', upload.single('avatar'), AdminCreatorController.update);
router.put('/creators/:id/status', AdminCreatorController.updateStatus);
router.post('/creators/:id/status', AdminCreatorController.updateStatus);
router.delete('/creators/:id', AdminCreatorController.destroy);

// ── 14. Creator Withdrawal Management ───────────────────────────────────────
// List & detail
router.get('/creator-withdrawals', AdminCreatorWithdrawalController.index);
router.get('/creator-withdrawals/:id', AdminCreatorWithdrawalController.show);
// Generic process action (approve / paid / rejected / pending)
router.put('/creator-withdrawals/:id', AdminCreatorWithdrawalController.processWithdrawal);
router.post('/creator-withdrawals/:id', AdminCreatorWithdrawalController.processWithdrawal);
router.put('/creator-withdrawals/:id/action', AdminCreatorWithdrawalController.processWithdrawal);
router.post('/creator-withdrawals/:id/action', AdminCreatorWithdrawalController.processWithdrawal);
// Shortcut approve & reject endpoints
router.post('/creator-withdrawals/:id/approve', AdminCreatorWithdrawalController.approve);
router.put('/creator-withdrawals/:id/approve', AdminCreatorWithdrawalController.approve);
router.post('/creator-withdrawals/:id/reject', AdminCreatorWithdrawalController.reject);
router.put('/creator-withdrawals/:id/reject', AdminCreatorWithdrawalController.reject);

// ── 15. Withdrawal Management (all writers) ─────────────────────────────────
router.get('/withdrawals', AdminWithdrawalController.index);
router.get('/withdrawals/:id', AdminWithdrawalController.show);
router.put('/withdrawals/:id', AdminWithdrawalController.processWithdrawal);
router.post('/withdrawals/:id', AdminWithdrawalController.processWithdrawal);
router.post('/withdrawals/:id/action', AdminWithdrawalController.processWithdrawal);
router.put('/withdrawals/:id/action', AdminWithdrawalController.processWithdrawal);
router.delete('/withdrawals/:id', AdminWithdrawalController.destroy);

// ── 16. Published Stories (is_approved = Approved) ───────────────────────────
router.get('/published-stories', AdminPublishedStoriesController.index);
router.get('/published-stories/:id', AdminPublishedStoriesController.show);

// ── 17. Pending Stories (is_approved = Pending) ──────────────────────────────
router.get('/pending-stories', AdminPublishedStoriesController.pendingStories);
router.get('/pending-stories/:id', AdminPublishedStoriesController.show);

// ── 18. Revenue Share Management (Per-creator revenue split) ───────────────────
router.get('/revenue-shares/export', AdminRevenueShareController.exportData);
router.get('/revenue-share/export', AdminRevenueShareController.exportData);
router.get('/revenue-shares', AdminRevenueShareController.index);
router.get('/revenue-share', AdminRevenueShareController.index);

module.exports = router;
