const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

function resolveUrl(pathStr) {
  if (!pathStr) return null;
  if (pathStr.startsWith('http://') || pathStr.startsWith('https://')) {
    return pathStr;
  }
  return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${pathStr.replace(/^\//, '')}`;
}

function formatNumber(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) {
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (n >= 1000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return n.toString();
}

function formatDuration(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${remSec}s`;
  }
  return `${remSec}s`;
}

function toEpisodeFieldsArray(episode, storyTitle = null, isUnlocked = true) {
  const durationMins = episode.duration_minutes !== null && episode.duration_minutes !== undefined
    ? Number(episode.duration_minutes)
    : (episode.duration_seconds ? Number((episode.duration_seconds / 60).toFixed(2)) : null);

  const hasAudio = Boolean(episode.audio_path);
  const audioUrl = isUnlocked || !episode.is_premium ? resolveUrl(episode.audio_path) : null;
  const coinVal = episode.coins !== null && episode.coins !== undefined ? Number(episode.coins) : 25;
  const storyImageUrl = resolveUrl(episode.story_cover_image_path || episode.cover_image_path || episode.story_image || episode.cover_image);

  return {
    episode_id: Number(episode.id),
    story_id: Number(episode.story_id),
    created_by: episode.created_by ? Number(episode.created_by) : null,
    story_title: storyTitle || episode.story_title || null,
    story_image: storyImageUrl,
    story_cover_image: storyImageUrl,
    cover_image: storyImageUrl,
    episode_no: Number(episode.position || 1),
    title: episode.title,
    audio_title: episode.audio_title || episode.title,
    description: episode.description || null,
    publish_as: episode.publish_as || 'publish_now',
    scheduled_at: episode.scheduled_at || null,
    duration_seconds: Number(episode.duration_seconds || 0),
    duration_minutes: durationMins,
    type: episode.is_premium ? 'premium' : 'free',
    coins: coinVal,
    is_premium: Boolean(episode.is_premium),
    is_unlocked: Boolean(isUnlocked || !episode.is_premium),
    audio_file: audioUrl,
    audio_status: hasAudio ? 'uploaded' : 'missing',
    published_date: episode.published_at || episode.created_at,
    plays: Number(episode.plays_count || 0),
  };
}

function toStoryFieldsArray(story, options = {}) {
  const {
    isLiked = false,
    isBookmarked = false,
    episodes = null,
    userUnlockedEpisodeIds = new Set(),
    performance = null,
    completionRate = null,
    avgListeningTime = null,
  } = options;

  const coverUrl = resolveUrl(story.cover_image_path);
  const bannerUrl = resolveUrl(story.banner_image_path);

  const totalViews = Number(story.total_views || 0);
  const listenersCount = Number(story.listeners_count || 0);
  const likesCount = Number(story.likes_count || 0);
  const sharesCount = Number(story.shares_count || 0);

  const statusStr = story.status || 'published';
  const isLive = ['published', 'ongoing', 'completed', 'live'].includes(statusStr.toLowerCase());

  const performanceObj = performance || {
    plays: {
      count: totalViews,
      formatted: formatNumber(totalViews),
      growth: '0%',
    },
    listeners: {
      count: listenersCount,
      formatted: formatNumber(listenersCount),
      growth: '0%',
    },
    likes: {
      count: likesCount,
      formatted: formatNumber(likesCount),
      growth: '0%',
    },
    shares: {
      count: sharesCount,
      formatted: formatNumber(sharesCount),
      growth: '0%',
    },
  };

  const compRateVal = completionRate !== null && completionRate !== undefined
    ? Number(completionRate)
    : Number(story.completion_rate || 0);

  const completionRateObj = {
    rate: compRateVal,
    formatted: `${compRateVal}%`,
  };

  const avgSecsVal = avgListeningTime !== null && avgListeningTime !== undefined
    ? Number(avgListeningTime)
    : Number(story.avg_listening_time || 0);

  const avgListeningTimeObj = {
    seconds: avgSecsVal,
    formatted: formatDuration(avgSecsVal),
  };

  const data = {
    story_id: Number(story.id),
    title: story.title,
    description: story.description || null,
    cover_image: coverUrl,
    banner_image: bannerUrl,
    category: story.category_name || story.genre || null,
    genre: story.category_name || story.genre || null,
    author: story.author_name || story.author || null,
    author_id: Number(story.user_id || 0),
    language: story.language || 'en',
    tags: story.tags || null,
    total_episodes: Number(story.episodes_count || 0),
    listeners: listenersCount,
    total_views: totalViews,
    status: statusStr,
    is_live: isLive,
    rating: Number(story.rating || 0.0),
    is_premium: Boolean(story.is_premium),
    likes_count: likesCount,
    shares_count: sharesCount,
    is_liked: Boolean(isLiked),
    is_bookmarked: Boolean(isBookmarked),
    performance: performanceObj,
    completion_rate: completionRateObj,
    avg_listening_time: avgListeningTimeObj,
    created_at: story.created_at,
  };

  if (Array.isArray(episodes)) {
    data.episodes = episodes.map((ep) =>
      toEpisodeFieldsArray(ep, story.title, userUnlockedEpisodeIds.has(Number(ep.id)))
    );
  }

  return data;
}

module.exports = {
  resolveUrl,
  formatNumber,
  formatDuration,
  toStoryFieldsArray,
  toEpisodeFieldsArray,
};
