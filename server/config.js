/**
 * Server Configuration
 *
 * Centralized configuration for the multiplayer server.
 */

export const PORT = process.env.PORT || 3001;
export const MAX_PLAYERS_PER_ROOM = 8;
export const ROOM_CODE_LENGTH = 8;
export const HEARTBEAT_INTERVAL = 30000; // 30 seconds
export const COUNTDOWN_DURATION = 5000; // 5 seconds
export const MAX_TOTAL_ROOMS = 1000;
export const ROOM_EXPIRY_MS = 3600000; // 1 hour
export const ROOM_CLEANUP_INTERVAL = 60000; // 1 minute

// CORS configuration
export const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
]);

// Rate limiting configuration
export const RATE_LIMITS = {
  global: { max: 30, windowMs: 1000 },
  'create-room': { max: 1, windowMs: 5000 },
  'player-update': { max: 15, windowMs: 1000 },
  'send-attack': { max: 5, windowMs: 1000 },
  'host-navigation': { max: 10, windowMs: 1000 },
};

// Validation constants
export const MAX_PLAYER_NAME_LENGTH = 30;
export const PLAYER_NAME_REGEX = /^[a-zA-Z0-9_\- ]{1,30}$/;
export const VALID_DIFFICULTIES = ['Beginner', 'Easy', 'Medium', 'Hard', 'Challenge'];

// Attack system constants
export const ATTACK_COMBO_COST = 50;
export const VALID_ATTACK_DIRECTIONS = ['left', 'down', 'up', 'right'];
export const MAX_ATTACK_TIME_OFFSET = 5000;

// Anti-cheat constants
export const MAX_HEALTH_INCREASE = 5;
export const MAX_COMBO_INCREASE_PER_UPDATE = 20;
export const MAX_SCORE_INCREASE_PER_UPDATE = 50000;
export const SCORE_TOLERANCE_PERCENT = 0.05;

// Security constants
export const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Global rate limiter config
export const GLOBAL_RATE_LIMIT = {
  MAX_MESSAGES_PER_SECOND: 5000,
};
