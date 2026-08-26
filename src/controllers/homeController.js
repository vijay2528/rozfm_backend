const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const { toStoryFieldsArray } = require('../utils/storyPresenter');

class HomeController {
  static async index(req, res) {
    try {
      const { search } = req.query;
      const userId = req.user ? req.user.id : null;

      // Handle Search query
      if (search) {
        const [searchResults] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published') AND (s.title LIKE ? OR s.description LIKE ?)
           ORDER BY s.listeners_count DESC, s.total_views DESC
           LIMIT 30`,
          [`%${search}%`, `%${search}%`]
        );

        const results = searchResults.map((s) => toStoryFieldsArray(s));
        return ApiResponse.success(res, { 'Top Results': results });
      }

      // Fetch user liked & bookmarked story IDs if authenticated
      let userLikedIds = new Set();
      let userBookmarkedIds = new Set();
      let preferredCategoryIds = [];

      if (userId) {
        const [likes] = await pool.query('SELECT story_id FROM story_likes WHERE user_id = ?', [userId]);
        likes.forEach((l) => userLikedIds.add(l.story_id));

        const [bookmarks] = await pool.query('SELECT story_id FROM bookmarks WHERE user_id = ?', [userId]);
        bookmarks.forEach((b) => userBookmarkedIds.add(b.story_id));

        const [prefCats] = await pool.query('SELECT category_id FROM user_categories WHERE user_id = ?', [userId]);
        preferredCategoryIds = prefCats.map((c) => c.category_id);
      }

      const mapStory = (s) =>
        toStoryFieldsArray(s, {
          isLiked: userLikedIds.has(s.id),
          isBookmarked: userBookmarkedIds.has(s.id),
        });

      // ── 1. Continue Listening ───────────────────────────────────────────────
      // Logic: In-progress listening (w.completed = 0) ordered by recent listening time
      let continueListening = [];
      if (userId) {
        const [clRows] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM watch_histories w
           JOIN stories s ON w.story_id = s.id
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE w.user_id = ? AND w.completed = 0 AND s.status = 'published'
           ORDER BY w.last_watched_at DESC
           LIMIT 10`,
          [userId]
        );
        continueListening = clRows.map(mapStory);
      }

      // ── 2. Recommended for You ─────────────────────────────────────────────
      // Logic: High likes/bookmarks & matching preferred categories if user logged in
      let recWhere = "s.status = 'published'";
      let recParams = [];
      if (preferredCategoryIds.length > 0) {
        recWhere += ' AND s.category_id IN (?)';
        recParams.push(preferredCategoryIds);
      }

      const [recRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count,
                (SELECT COUNT(*) FROM bookmarks bm WHERE bm.story_id = s.id) as bookmarks_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE ${recWhere}
         ORDER BY (likes_count + bookmarks_count) DESC, s.rating DESC, s.listeners_count DESC
         LIMIT 10`,
        recParams
      );

      let recommendedForYou = recRows.map(mapStory);
      // Fallback for recommended if fewer than 5
      if (recommendedForYou.length < 5) {
        const [fallbackRec] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published')
           ORDER BY s.rating DESC, s.listeners_count DESC
           LIMIT 10`
        );
        recommendedForYou = fallbackRec.map(mapStory);
      }

      // ── 3. Trending ─────────────────────────────────────────────────────────
      // Logic: High views & activity (views + listeners count)
      const [trendingRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.total_views DESC, s.listeners_count DESC
         LIMIT 10`
      );
      const trending = trendingRows.map(mapStory);

      // ── 4. New Releases ─────────────────────────────────────────────────────
      // Logic: Recently published stories (order by created_at DESC)
      const [newReleasesRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published') AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY s.total_views DESC, s.created_at DESC
         LIMIT 10`
      );

      let newReleases = newReleasesRows.map(mapStory);
      if (newReleases.length < 5) {
        const [fallbackNew] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published')
           ORDER BY s.created_at DESC
           LIMIT 10`
        );
        newReleases = fallbackNew.map(mapStory);
      }

      // ── 5. Top 10 ───────────────────────────────────────────────────────────
      // Logic: Highest total views, exactly top 10
      const [top10Rows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.total_views DESC, s.listeners_count DESC
         LIMIT 10`
      );
      const top10 = top10Rows.map(mapStory);

      // ── 6. Updated Today ────────────────────────────────────────────────────
      // Logic: Stories updated or created in the last 24 hours
      const [updatedTodayRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published') AND (s.updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) OR s.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))
         ORDER BY s.updated_at DESC
         LIMIT 10`
      );

      let updatedToday = updatedTodayRows.map(mapStory);
      if (updatedToday.length < 5) {
        const [fallbackUpdated] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published')
           ORDER BY s.updated_at DESC
           LIMIT 10`
        );
        updatedToday = fallbackUpdated.map(mapStory);
      }

      // ── 7. Because You Listened ─────────────────────────────────────────────
      // Logic: Based on user's recent listened story's category or author
      let becauseYouListened = [];
      let baseStoryTitle = null;

      if (userId) {
        const [lastWatched] = await pool.query(
          `SELECT w.story_id, s.category_id, s.title
           FROM watch_histories w
           JOIN stories s ON w.story_id = s.id
           WHERE w.user_id = ?
           ORDER BY w.last_watched_at DESC
           LIMIT 1`,
          [userId]
        );

        if (lastWatched.length > 0) {
          const recentStoryId = lastWatched[0].story_id;
          const recentCategoryId = lastWatched[0].category_id;
          baseStoryTitle = lastWatched[0].title;

          const [bylRows] = await pool.query(
            `SELECT s.*, c.category_name, u.name as author_name,
                    (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
             FROM stories s
             LEFT JOIN categories c ON s.category_id = c.id
             LEFT JOIN users u ON s.user_id = u.id
             WHERE s.status IN ('ongoing', 'completed', 'published') AND s.category_id = ? AND s.id != ?
             ORDER BY s.listeners_count DESC
             LIMIT 10`,
            [recentCategoryId, recentStoryId]
          );
          becauseYouListened = bylRows.map(mapStory);
        }
      }

      if (becauseYouListened.length === 0) {
        const [fallbackByl] = await pool.query(
          `SELECT s.*, c.category_name, u.name as author_name,
                  (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
           FROM stories s
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.status IN ('ongoing', 'completed', 'published')
           ORDER BY s.listeners_count DESC
           LIMIT 10`
        );
        becauseYouListened = fallbackByl.map(mapStory);
      }

      // ── 8. Popular ──────────────────────────────────────────────────────────
      // Logic: Generally most consumed stories by all users
      const [popularRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status IN ('ongoing', 'completed', 'published')
         ORDER BY s.listeners_count DESC, s.total_views DESC
         LIMIT 10`
      );
      const popular = popularRows.map(mapStory);

      // ── 9. Free Stories ──────────────────────────────────────────────────────
      // Logic: Stories where is_premium = 0
      const [freeRows] = await pool.query(
        `SELECT s.*, c.category_name, u.name as author_name,
                (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) as likes_count
         FROM stories s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.status = 'published' AND s.is_premium = 0
         ORDER BY s.listeners_count DESC
         LIMIT 10`
      );
      const freeStories = freeRows.map(mapStory);

      // Construct final response payload using Title Case section names
      return ApiResponse.success(res, {
        'Continue Listening': continueListening,
        'Recommended for You': recommendedForYou,
        'Trending': trending,
        'New Releases': newReleases,
        'Top 10': top10,
        'Updated Today': updatedToday,
        'Because You Listened': becauseYouListened,
        'Popular': popular,
        'Free Stories': freeStories,
        because_you_listened_title: baseStoryTitle,
      });
    } catch (error) {
      console.error('Home Feed Error:', error);
      return ApiResponse.error(res, 'Failed to fetch home feed.', 500);
    }
  }
}

module.exports = HomeController;
