const { pool } = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

function formatImageUrl(path) {
  if (!path) return null;
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${trimmed.replace(/^\//, '')}`;
}

const DEFAULT_BADGES = [
  {
    id: 1,
    key: 'premium_writer',
    badge_key: 'premium_writer',
    title: 'Premium Writer',
    description: 'You are a Premium Writer',
    requirement_text: 'You are a Premium Writer',
    target_value: 1,
    icon_type: 'star',
    theme_color: 'purple',
    badge_color_hex: '#8B5CF6',
    icon_url: `${PUBLIC_BASE_URL.replace(/\/$/, '')}/badges/premium_writer.png`,
    sort_order: 1,
  },
  {
    id: 2,
    key: 'rising_star',
    badge_key: 'rising_star',
    title: 'Rising Star',
    description: 'Reach 10K listeners',
    requirement_text: 'Reach 10K listeners',
    target_value: 10000,
    icon_type: 'star',
    theme_color: 'purple',
    badge_color_hex: '#A855F7',
    icon_url: `${PUBLIC_BASE_URL.replace(/\/$/, '')}/badges/rising_star.png`,
    sort_order: 2,
  },
  {
    id: 3,
    key: 'top_creator',
    badge_key: 'top_creator',
    title: 'Top Creator',
    description: 'Earn 50K plays in a month',
    requirement_text: 'Earn 50K plays in a month',
    target_value: 50000,
    icon_type: 'crown',
    theme_color: 'gold',
    badge_color_hex: '#F59E0B',
    icon_url: `${PUBLIC_BASE_URL.replace(/\/$/, '')}/badges/top_creator.png`,
    sort_order: 3,
  },
  {
    id: 4,
    key: 'consistent_writer',
    badge_key: 'consistent_writer',
    title: 'Consistent Writer',
    description: 'Upload 10 episodes in a month',
    requirement_text: 'Upload 10 episodes in a month',
    target_value: 10,
    icon_type: 'check',
    theme_color: 'teal',
    badge_color_hex: '#14B8A6',
    icon_url: `${PUBLIC_BASE_URL.replace(/\/$/, '')}/badges/consistent_writer.png`,
    sort_order: 4,
  },
  {
    id: 5,
    key: 'fan_favorite',
    badge_key: 'fan_favorite',
    title: 'Fan Favorite',
    description: 'Get 1000+ likes in a story',
    requirement_text: 'Get 1000+ likes in a story',
    target_value: 1000,
    icon_type: 'heart',
    theme_color: 'orange',
    badge_color_hex: '#F97316',
    icon_url: `${PUBLIC_BASE_URL.replace(/\/$/, '')}/badges/fan_favorite.png`,
    sort_order: 5,
  },
];

class BadgeController {
  /**
   * GET /api/v1/user/writer-badges
   * GET /api/v1/writer/badges
   * GET /api/v1/writers/:id/badges
   * Fetch writer badges with real-time criteria, progress, and unlocked status
   */
  static async getBadges(req, res) {
    try {
      const targetUserId =
        req.params?.id ||
        req.query?.user_id ||
        req.query?.id ||
        (req.user ? req.user.id : null);

      if (!targetUserId) {
        return ApiResponse.error(res, 'User ID is required.', 400);
      }

      const userIdNum = Number(targetUserId);

      // Verify user existence
      const [[user]] = await pool.query(
        'SELECT id, name, subscription_type, role, is_verified FROM users WHERE id = ? LIMIT 1',
        [userIdNum]
      );

      if (!user) {
        return ApiResponse.error(res, 'User not found.', 404);
      }

      // Fetch stored badges from writer_badges table if available
      let dbBadges = DEFAULT_BADGES;
      try {
        const [rows] = await pool.query(
          'SELECT * FROM writer_badges ORDER BY sort_order ASC, id ASC'
        );
        if (rows.length > 0) {
          dbBadges = rows.map((r) => ({
            id: r.id,
            key: r.badge_key,
            badge_key: r.badge_key,
            title: r.title,
            description: r.description,
            requirement_text: r.requirement_text || r.description,
            target_value: Number(r.target_value || 0),
            icon_type: r.icon_type || 'star',
            theme_color: r.theme_color || 'purple',
            badge_color_hex: r.badge_color_hex || '#8B5CF6',
            icon_url: formatImageUrl(r.icon_path) || `${PUBLIC_BASE_URL.replace(/\/$/, '')}/badges/${r.badge_key}.png`,
            sort_order: r.sort_order || 0,
          }));
        }
      } catch (_) {
        // Fall back to default badges if DB table isn't ready
      }

      // Check manually unlocked / saved badges in user_writer_badges
      let manualEarnedMap = new Map();
      try {
        const [earnedRows] = await pool.query(
          'SELECT badge_key, earned_at FROM user_writer_badges WHERE user_id = ?',
          [userIdNum]
        );
        earnedRows.forEach((r) => manualEarnedMap.set(r.badge_key, r.earned_at));
      } catch (_) {
        // Ignore if table not available
      }

      // Calculate dynamic criteria for this writer
      // 1. Premium status or premium stories count
      const [[{ premiumStoriesCount }]] = await pool.query(
        'SELECT COUNT(*) AS premiumStoriesCount FROM stories WHERE user_id = ? AND is_premium = 1',
        [userIdNum]
      );
      const isPremiumWriter =
        (user.subscription_type && user.subscription_type.toLowerCase() === 'premium') ||
        Number(premiumStoriesCount || 0) > 0;

      // 2. Total Listeners across all writer stories
      const [[{ totalListeners }]] = await pool.query(
        'SELECT COALESCE(SUM(listeners_count), 0) AS totalListeners FROM stories WHERE user_id = ?',
        [userIdNum]
      );
      const totalListenersCount = Number(totalListeners || 0);

      // 3. Plays in current month (and total plays)
      const [[{ monthlyPlays }]] = await pool.query(
        `SELECT COALESCE(SUM(total_views + listeners_count), 0) AS monthlyPlays 
         FROM stories 
         WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [userIdNum]
      );
      const [[{ totalPlaysAllTime }]] = await pool.query(
        `SELECT COALESCE(SUM(total_views + listeners_count), 0) AS totalPlaysAllTime 
         FROM stories 
         WHERE user_id = ?`,
        [userIdNum]
      );
      const currentPlaysCount = Math.max(Number(monthlyPlays || 0), Number(totalPlaysAllTime || 0));

      // 4. Episodes uploaded in last 30 days (and total episodes)
      const [[{ recentEpisodes }]] = await pool.query(
        `SELECT COUNT(e.id) AS recentEpisodes 
         FROM episodes e
         JOIN stories s ON e.story_id = s.id
         WHERE s.user_id = ? AND e.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [userIdNum]
      );
      const [[{ totalEpisodes }]] = await pool.query(
        `SELECT COUNT(e.id) AS totalEpisodes 
         FROM episodes e
         JOIN stories s ON e.story_id = s.id
         WHERE s.user_id = ?`,
        [userIdNum]
      );
      const currentEpisodesCount = Math.max(Number(recentEpisodes || 0), Number(totalEpisodes || 0));

      // 5. Max likes on any single story
      const [[{ maxStoryLikes }]] = await pool.query(
        `SELECT COALESCE(MAX(likes_count), 0) AS maxStoryLikes
         FROM (
           SELECT s.id, COUNT(sl.id) AS likes_count
           FROM stories s
           LEFT JOIN story_likes sl ON sl.story_id = s.id
           WHERE s.user_id = ?
           GROUP BY s.id
         ) story_counts`,
        [userIdNum]
      );
      const maxLikesCount = Number(maxStoryLikes || 0);

      // Map each badge to user metrics
      const badges = dbBadges.map((b) => {
        let current = 0;
        let target = b.target_value || 1;
        let isEarned = false;

        if (b.key === 'premium_writer') {
          current = isPremiumWriter ? 1 : 0;
          isEarned = isPremiumWriter;
        } else if (b.key === 'rising_star') {
          current = totalListenersCount;
          isEarned = current >= target;
        } else if (b.key === 'top_creator') {
          current = currentPlaysCount;
          isEarned = current >= target;
        } else if (b.key === 'consistent_writer') {
          current = currentEpisodesCount;
          isEarned = current >= target;
        } else if (b.key === 'fan_favorite') {
          current = maxLikesCount;
          isEarned = current >= target;
        }

        // If manually unlocked in DB, set isEarned to true
        if (manualEarnedMap.has(b.key)) {
          isEarned = true;
        }

        const percentage = Math.min(100, parseFloat(((current / (target || 1)) * 100).toFixed(1)));
        const earnedAt = manualEarnedMap.get(b.key) || (isEarned ? new Date().toISOString() : null);

        return {
          id: b.id,
          key: b.key,
          badge_key: b.key,
          title: b.title,
          description: b.description,
          requirement_text: b.requirement_text,
          icon_type: b.icon_type,
          theme_color: b.theme_color,
          badge_color_hex: b.badge_color_hex,
          icon_url: b.icon_url,
          is_earned: isEarned,
          is_locked: !isEarned,
          earned_at: earnedAt,
          progress: {
            current: current,
            target: target,
            percentage: percentage,
          },
        };
      });

      const earnedCount = badges.filter((b) => b.is_earned).length;

      return ApiResponse.success(
        res,
        {
          user_id: userIdNum,
          total_badges: badges.length,
          earned_badges_count: earnedCount,
          badges: badges,
        },
        'Writer badges fetched successfully.'
      );
    } catch (error) {
      console.error('Writer Badges Error:', error);
      return ApiResponse.error(res, 'Failed to fetch writer badges.', 500);
    }
  }

  /**
   * POST /api/v1/user/writer-badges/claim
   * Claim / Unlock a badge manually
   */
  static async claimBadge(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      const { badge_key } = req.body;

      if (!userId) {
        return ApiResponse.error(res, 'User ID is required.', 400);
      }
      if (!badge_key) {
        return ApiResponse.error(res, 'Badge key is required.', 400);
      }

      await pool.query(
        `INSERT INTO user_writer_badges (user_id, badge_key, earned_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE earned_at = VALUES(earned_at)`,
        [userId, badge_key]
      );

      return ApiResponse.success(
        res,
        { user_id: userId, badge_key: badge_key, is_earned: true },
        'Badge unlocked successfully.'
      );
    } catch (error) {
      console.error('Claim Badge Error:', error);
      return ApiResponse.error(res, 'Failed to claim badge.', 500);
    }
  }
}

module.exports = BadgeController;
