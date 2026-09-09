const express = require('express');
const router = express.Router();

const AuthController = require('../controllers/authController');
const MeController = require('../controllers/meController');
const CategoryController = require('../controllers/categoryController');
const ConfigController = require('../controllers/configController');
const BannerController = require('../controllers/bannerController');
const StoryController = require('../controllers/storyController');
const EpisodeController = require('../controllers/episodeController');
const HomeController = require('../controllers/homeController');
const SectionController = require('../controllers/sectionController');
const ReviewController = require('../controllers/reviewController');
const CommentController = require('../controllers/commentController');
const BookmarkController = require('../controllers/bookmarkController');
const WatchHistoryController = require('../controllers/watchHistoryController');
const PlanController = require('../controllers/planController');
const CoinPackController = require('../controllers/coinPackController');
const WalletController = require('../controllers/walletController');
const RazorpayController = require('../controllers/razorpayController');
const SubscriptionController = require('../controllers/subscriptionController');
const LocationController = require('../controllers/locationController');
const UserController = require('../controllers/userController');
const BankController = require('../controllers/bankController');
const StreakController = require('../controllers/streakController');

const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// ── Public Routes ─────────────────────────────────────────────────────────────

// Auth
router.post('/auth/register', AuthController.register);
router.post('/auth/login', AuthController.login);
router.post('/auth/verify-otp', AuthController.verifyOtp);

// Config, Languages, FAQs & Legal
router.get('/config', ConfigController.show);
router.get('/languages', ConfigController.languages);
router.get('/getlanguages', ConfigController.languages);
router.get('/getlanguage', ConfigController.languages);
router.get('/faqs', ConfigController.faqs);
router.get('/support-faqs', ConfigController.supportFaqs);
router.get('/legal/copyright', ConfigController.legalCopyright);
router.get('/legal/privacy', ConfigController.legalPrivacy);
router.get('/legal/terms', ConfigController.legalTerms);
router.get('/legal/security-advice', ConfigController.legalSecurityAdvice);

// Location (Country, State, City)
router.get('/countries', LocationController.getCountries);
router.get('/countries/:id', LocationController.getCountryById);
router.get('/countries/:countryId/states', LocationController.getStates);
router.get('/countries/:countryId/cities', LocationController.getCities);
router.get('/states', LocationController.getStates);
router.get('/states/:id', LocationController.getStateById);
router.get('/states/:stateId/cities', LocationController.getCities);
router.get('/cities', LocationController.getCities);
router.get('/cities/:id', LocationController.getCityById);

// Home, Banners, Plans & Categories
router.get('/home', HomeController.index);
router.get('/banners', BannerController.index);
router.get('/categories', CategoryController.index);
router.get('/plans', PlanController.index);
router.get('/coin-packs', CoinPackController.index);

// Section Drill-downs
router.get('/sections/trending', SectionController.trending);
router.get('/sections/popular', SectionController.popular);
router.get('/sections/top-rated', SectionController.topRated);
router.get('/sections/top-picks', SectionController.topPicks);

// Stories & Episodes Details (Public)
router.get('/stories', StoryController.index);
router.get('/stories/:id', authMiddleware.optional, StoryController.show);
router.get('/stories/:storyId/episodes', authMiddleware.optional, EpisodeController.index);
router.get('/episodes', authMiddleware.optional, EpisodeController.index);
router.get('/stories/:id/reviews', ReviewController.index);
router.get('/stories/:id/comments', CommentController.index);
router.get('/comments/:id/replies', CommentController.replies);
router.get('/episodes/:id', authMiddleware.optional, EpisodeController.show);

// User Profile Details (Public / Optional Auth)
router.get('/users/:id', authMiddleware.optional, UserController.show);
router.get('/users/:id/profile', authMiddleware.optional, UserController.show);
router.get('/users/:id/stories', UserController.getUserStories);
router.get('/users/:id/reviews', UserController.getUserReviews);
router.get('/users/:id/followers', authMiddleware.optional, UserController.getFollowers);
router.get('/users/:id/following', authMiddleware.optional, UserController.getFollowing);

// ── Authenticated User Routes ──────────────────────────────────────────────────
router.use(authMiddleware);

// Auth Logout
router.post('/auth/logout', AuthController.logout);

// Profile
router.get('/me', MeController.show);
router.put('/me', upload.single('image'), MeController.update);
router.post('/me', upload.single('image'), MeController.update);

router.get('/user/profile', MeController.show);
router.put('/user/profile', upload.single('image'), MeController.update);
router.post('/user/profile', upload.single('image'), MeController.update);

router.post('/user/select-language', MeController.selectLanguage);
router.post('/user/delete-account', MeController.deleteAccount);
router.post('/user/update-phone', MeController.requestPhoneUpdate);
router.post('/user/update-phone/verify', MeController.verifyPhoneUpdate);
router.get('/user/notifications/settings', MeController.getNotificationSettings);
router.post('/user/notifications/settings', MeController.updateNotificationSettings);

// User Followers / Following (Current Authenticated User)
router.get('/user/followers', UserController.getFollowers);
router.get('/user/following', UserController.getFollowing);

// User Follow / Unfollow
router.post('/users/:id/follow', UserController.follow);
router.post('/user/:id/follow', UserController.follow);
router.post('/users/:id/unfollow', UserController.unfollow);
router.post('/user/:id/unfollow', UserController.unfollow);
router.delete('/users/:id/follow', UserController.unfollow);
router.delete('/user/:id/follow', UserController.unfollow);
router.delete('/users/:id/unfollow', UserController.unfollow);
router.delete('/user/:id/unfollow', UserController.unfollow);
router.post('/users/:id/toggle-follow', UserController.toggleFollow);
router.post('/user/:id/toggle-follow', UserController.toggleFollow);

// User Category Preferences, Reviews & Liked Content
router.get('/user/categories', CategoryController.userPreferences);
router.put('/user/categories', CategoryController.updateUserPreferences);
router.post('/user/categories', CategoryController.updateUserPreferences);
router.get('/user/reviews', ReviewController.userReviews);
router.get('/user/liked-stories', StoryController.likedStories);
router.get('/stories/liked', StoryController.likedStories);

// Story & Episode Creation / Edit (Authenticated)
router.post('/stories', upload.storyMedia, StoryController.store);
router.post('/stories/:id', upload.storyMedia, StoryController.update);

router.post('/episodes', upload.episodeMedia, EpisodeController.store);
router.post('/stories/:storyId/episodes', upload.episodeMedia, EpisodeController.store);
router.put('/episodes/:id', upload.episodeMedia, EpisodeController.update);
router.post('/episodes/:id', upload.episodeMedia, EpisodeController.update);

// Interactions & Engagement
router.post('/stories/:id/reviews', ReviewController.store);
router.post('/stories/:id/comments', CommentController.store);
router.post('/stories/:id/like', StoryController.toggleLike);
router.post('/stories/:id/share', StoryController.share);
router.post('/comments/:id/like', CommentController.toggleLike);
router.post('/stories/:id/bookmark', BookmarkController.toggle);
router.get('/bookmarks', BookmarkController.index);

// Watch History & Playback Progress Tracking
router.get('/watch-history', WatchHistoryController.index);
router.post('/watch-history/track', WatchHistoryController.trackProgress);
router.post('/watch-history/track-progress', WatchHistoryController.trackProgress);
router.post('/watch-history/track-minutes', WatchHistoryController.trackMinutes);
router.delete('/watch-history', WatchHistoryController.clear);
router.delete('/watch-history/:id', WatchHistoryController.destroy);

router.post('/episodes/:id/track-progress', WatchHistoryController.trackProgress);
router.post('/episodes/:id/play-duration', WatchHistoryController.updatePlayDuration);
router.post('/episodes/play-duration', WatchHistoryController.updatePlayDuration);
router.post('/episodes/:id/update-play-duration', WatchHistoryController.updatePlayDuration);
router.post('/episodes/update-play-duration', WatchHistoryController.updatePlayDuration);
router.post('/episode/play-duration', WatchHistoryController.updatePlayDuration);
router.get('/episodes/:id/progress', WatchHistoryController.getEpisodeProgress);
router.get('/stories/:id/progress', WatchHistoryController.getStoryProgress);
router.get('/user/listening-stats', WatchHistoryController.getUserListeningStats);
router.post('/episodes/:id/unlock', EpisodeController.unlock);

// Streak & Daily Goal API
router.get('/streak', StreakController.index);
router.post('/streak/claim-daily', StreakController.claimDailyReward);
router.post('/streak/claim-milestone', StreakController.claimMilestone);
router.post('/streak/use-shield', StreakController.useShield);
router.get('/streak/activity', StreakController.getActivityCalendar);
router.get('/streak/date-details', StreakController.getDateDetails);

// Wallet & Monetization
router.get('/wallet', WalletController.show);
router.post('/wallet/purchase-coins', WalletController.purchase);
router.get('/wallet/daily-claim', WalletController.dailyClaimStatus);
router.post('/wallet/daily-claim', WalletController.dailyClaim);
router.get('/wallet/transactions', WalletController.transactions);

// Bank Details
router.get('/user/bank-details', BankController.show);
router.get('/bank-details', BankController.show);
router.post('/user/bank-details', BankController.store);
router.put('/user/bank-details', BankController.store);
router.post('/bank-details', BankController.store);
router.put('/bank-details', BankController.store);
router.delete('/user/bank-details', BankController.destroy);
router.delete('/bank-details', BankController.destroy);

// Payments & Subscriptions
router.post('/payments/razorpay/order', RazorpayController.createOrder);
router.post('/payments/razorpay/verify', RazorpayController.verifyPayment);
router.get('/subscriptions', SubscriptionController.index);
router.post('/subscriptions', SubscriptionController.store);

module.exports = router;
