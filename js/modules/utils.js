/**
 * Arena Royale - Utility Functions Module
 * Common helper functions used throughout the game
 */

// Format time as M:SS
function fmt(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

// Format large numbers with commas
function formatNumber(num) {
  return num.toLocaleString();
}

// Format time remaining (for cooldowns, etc)
function formatTimeRemaining(ms) {
  if (ms <= 0) return 'Ready!';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  const secs = Math.floor((ms % (60 * 1000)) / 1000);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

// Get upgrade cost for a card based on level and rarity
function getUpgradeCost(level, rarity) {
  const base = { common: 10, rare: 20, epic: 40, legendary: 80, champion: 150 };
  return Math.floor((base[rarity] || 10) * (level * 1.5));
}

// Get random element from array
function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Shuffle array (Fisher-Yates)
function shuffle(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Clamp value between min and max
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Linear interpolation
function lerp(start, end, t) {
  return start + (end - start) * t;
}

// Distance between two points
function distance(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// Normalize role strings for comparison
function normalizeRole(role) {
  if (!role) return 'Member';
  const r = role.toLowerCase().replace(/[-_]/g, '');
  if (r === 'leader') return 'Leader';
  if (r === 'coleader' || r === 'co-leader') return 'Co-Leader';
  if (r === 'elder') return 'Elder';
  return 'Member';
}

// Get role icon
function getRoleIcon(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'Leader') return '👑';
  if (normalized === 'Co-Leader') return '⭐';
  if (normalized === 'Elder') return '🛡️';
  return '👤';
}

// Check if role is leader
function isLeaderRole(role) {
  return normalizeRole(role) === 'Leader';
}

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle function
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Generate UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Deep clone object
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Export to global scope
window.GameUtils = {
  fmt,
  formatNumber,
  formatTimeRemaining,
  getUpgradeCost,
  randomElement,
  shuffle,
  clamp,
  lerp,
  distance,
  normalizeRole,
  getRoleIcon,
  isLeaderRole,
  debounce,
  throttle,
  generateUUID,
  deepClone
};
