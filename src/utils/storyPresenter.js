const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

function resolveUrl(pathStr) {
  if (!pathStr) return null;
  if (pathStr.startsWith('http://') || pathStr.startsWith('https://')) {
    return pathStr;
  }
  return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${pathStr.replace(/^\//, '')}`;
}

function toEpisodeFieldsArray(episode, storyTitle = null, isUnlocked = true) {
  const durationMins = episode.duration_minutes !== null && episode.duration_minutes !== undefined
    ? Number(episode.duration_minutes)
    : (episode.duration_seconds ? Number((episode.duration_seconds / 60).toFixed(2)) : null);

  const hasAudio = Boolean(episode.audio_path);
  const audioUrl = isUnlocked || !episode.is_premium ? resolveUrl(episode.audio_path) : null;
  const coinVal = episode.coins !== null && episode.coins !== undefined ? Number(episode.coins) : 25;

  return {
    episode_id: Number(episode.id),
    story_id: Number(episode.story_id),
    created_by: episode.created_by ? Number(episode.created_by) : null,
    story_title: storyTitle || episode.story_title || null,
    episode_no: Number(episode.position || 1),
    title: episode.title,
    audio_title: episode.audio_title || episode.title,
    description: episode.description || null,
    publish_as: episode.publish_as || 'publish_now',
    scheduled_at: episode.scheduled_at || null,
    tags: episode.tags || null,
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
  } = options;

  const coverUrl = resolveUrl(story.cover_image_path);
  const bannerUrl = resolveUrl(story.banner_image_path);

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
    total_episodes: Number(story.episodes_count || 0),
    listeners: Number(story.listeners_count || 0),
    total_views: Number(story.total_views || 0),
    status: story.status || 'published',
    rating: Number(story.rating || 0.0),
    is_premium: Boolean(story.is_premium),
    likes_count: Number(story.likes_count || 0),
    is_liked: Boolean(isLiked),
    is_bookmarked: Boolean(isBookmarked),
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
  toStoryFieldsArray,
  toEpisodeFieldsArray,
};
