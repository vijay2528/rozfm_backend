const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

/**
 * Format user record into mobile profile response matching Laravel admin-panel contract.
 * @param {Object} user - User database row
 * @returns {Object} Formatted profile fields
 */
function toProfileFieldsArray(user) {
  if (!user) return null;

  let profileImage = null;
  if (user.avatar_path) {
    if (user.avatar_path.startsWith('http://') || user.avatar_path.startsWith('https://')) {
      profileImage = user.avatar_path;
    } else {
      profileImage = `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${user.avatar_path.replace(/^\//, '')}`;
    }
  }

  return {
    user_id: user.id,
    name: user.name,
    email: user.email,
    mobile_number: user.phone,
    profile_image: profileImage,
    country: user.country || null,
    state: user.state || null,
    city: user.city || null,
    age_group: user.age_group || null,
    gender: user.gender || null,
    subscription_type: user.subscription_type || 'free',
    wallet_balance: parseFloat(user.wallet_balance || 0),
    language: user.locale || null,
    created_at: user.created_at ? new Date(user.created_at).toISOString() : null,
  };
}

module.exports = {
  toProfileFieldsArray,
};
