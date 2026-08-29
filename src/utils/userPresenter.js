const { pool } = require('../config/db');

const PUBLIC_BASE_URL = process.env.R2_PUBLIC_URL || 'https://files.rozfm.com';

/**
 * Check if a string is a dummy/placeholder name or email.
 */
function isDummyName(name) {
  if (!name || typeof name !== 'string') return true;
  const trimmed = name.trim();
  return trimmed === '' || /^(User|User \d+|phone_\d+)$/i.test(trimmed);
}

function isDummyEmail(email) {
  if (!email || typeof email !== 'string') return true;
  const trimmed = email.trim().toLowerCase();
  return trimmed === '' || trimmed.endsWith('@app.local') || trimmed.startsWith('phone_');
}

/**
 * Check if all required profile data is filled for a user.
 * @param {Object} user - User database row
 * @returns {String} "yes" or "no"
 */
function checkIsProfileComplete(user) {
  if (!user) return 'no';

  const nameValid = !isDummyName(user.name);
  const emailValid = !isDummyEmail(user.email);
  const phoneValid = Boolean(user.phone && user.phone.trim() !== '');
  const countryValid = Boolean(user.country && user.country.trim() !== '');
  const stateValid = Boolean(user.state && user.state.trim() !== '');
  const cityValid = Boolean(user.city && user.city.trim() !== '');
  const ageGroupValid = Boolean(user.age_group && user.age_group.trim() !== '');
  const genderValid = Boolean(user.gender && user.gender.trim() !== '');

  const isComplete = nameValid && emailValid && phoneValid && countryValid && stateValid && cityValid && ageGroupValid && genderValid;
  return isComplete ? 'yes' : 'no';
}

/**
 * Check if a user has selected categories.
 * @param {Number|String} userId - User ID
 * @returns {Promise<String>} "yes" or "no"
 */
async function checkIsCategorySelected(userId) {
  if (!userId) return 'no';
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS count FROM user_categories WHERE user_id = ?', [userId]);
    return (rows && rows[0] && rows[0].count > 0) ? 'yes' : 'no';
  } catch (error) {
    console.error('Error checking category selection:', error);
    return 'no';
  }
}

/**
 * Format user record into mobile profile response matching Laravel admin-panel contract.
 * @param {Object} user - User database row
 * @param {Object} [extra] - Additional fields like isProfileComplete, isCategorySelected
 * @returns {Object} Formatted profile fields
 */
function toProfileFieldsArray(user, extra = {}) {
  if (!user) return null;

  let profileImage = null;
  if (user.avatar_path) {
    if (user.avatar_path.startsWith('http://') || user.avatar_path.startsWith('https://')) {
      profileImage = user.avatar_path;
    } else {
      profileImage = `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${user.avatar_path.replace(/^\//, '')}`;
    }
  }

  const cleanName = isDummyName(user.name) ? null : user.name.trim();
  const cleanEmail = isDummyEmail(user.email) ? null : user.email.trim();

  const profileData = {
    user_id: user.id,
    name: cleanName,
    email: cleanEmail,
    mobile_number: user.phone || null,
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

  if (extra.isProfileComplete !== undefined) {
    profileData.isProfileComplete = extra.isProfileComplete;
  }
  if (extra.isCategorySelected !== undefined) {
    profileData.isCategorySelected = extra.isCategorySelected;
  }

  return profileData;
}

module.exports = {
  toProfileFieldsArray,
  checkIsProfileComplete,
  checkIsCategorySelected,
  isDummyName,
  isDummyEmail,
};
