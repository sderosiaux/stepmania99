/**
 * Input Validation Functions
 *
 * Centralized validation for all incoming data.
 */

import {
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_NAME_REGEX,
  ROOM_CODE_LENGTH,
  VALID_DIFFICULTIES,
  VALID_ATTACK_DIRECTIONS,
  MAX_ATTACK_TIME_OFFSET,
  DANGEROUS_KEYS,
} from './config.js';

/**
 * Safe JSON parse that prevents prototype pollution attacks
 * @param {string} text
 * @returns {Object}
 */
export function safeJsonParse(text) {
  return JSON.parse(text, (key, value) => {
    if (DANGEROUS_KEYS.has(key)) {
      return undefined;
    }
    return value;
  });
}

/**
 * Sanitize string input (remove HTML/script tags)
 * @param {string} input
 * @returns {string}
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, MAX_PLAYER_NAME_LENGTH);
}

/**
 * Validate player name
 * @param {string} name
 * @returns {{ valid: boolean, error?: string, value?: string }}
 */
export function validatePlayerName(name) {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Player name must be a string' };
  }
  const sanitized = sanitizeString(name);
  if (sanitized.length === 0) {
    return { valid: false, error: 'Player name cannot be empty' };
  }
  if (!PLAYER_NAME_REGEX.test(sanitized)) {
    return { valid: false, error: 'Player name contains invalid characters' };
  }
  return { valid: true, value: sanitized };
}

/**
 * Validate room code
 * @param {string} code
 * @returns {{ valid: boolean, error?: string, value?: string }}
 */
export function validateRoomCode(code) {
  if (typeof code !== 'string') {
    return { valid: false, error: 'Room code must be a string' };
  }
  const upper = code.toUpperCase().trim();
  if (upper.length !== ROOM_CODE_LENGTH) {
    return { valid: false, error: `Room code must be ${ROOM_CODE_LENGTH} characters` };
  }
  if (!/^[A-Z0-9]+$/.test(upper)) {
    return { valid: false, error: 'Room code contains invalid characters' };
  }
  return { valid: true, value: upper };
}

/**
 * Validate navigation state
 * @param {Object} nav
 * @returns {{ valid: boolean, error?: string, value?: Object }}
 */
export function validateNavigation(nav) {
  if (!nav || typeof nav !== 'object') {
    return { valid: false, error: 'Navigation must be an object' };
  }
  if (typeof nav.packIndex !== 'number' || !Number.isInteger(nav.packIndex) || nav.packIndex < 0) {
    return { valid: false, error: 'Invalid packIndex' };
  }
  if (typeof nav.songIndex !== 'number' || !Number.isInteger(nav.songIndex) || nav.songIndex < 0) {
    return { valid: false, error: 'Invalid songIndex' };
  }

  const value = {
    packIndex: nav.packIndex,
    songIndex: nav.songIndex,
  };

  if (nav.songId !== undefined) {
    if (typeof nav.songId !== 'string') {
      return { valid: false, error: 'songId must be a string' };
    }
    value.songId = sanitizeString(nav.songId);
  }
  if (nav.difficulty !== undefined) {
    if (!VALID_DIFFICULTIES.includes(nav.difficulty)) {
      return { valid: false, error: 'Invalid difficulty' };
    }
    value.difficulty = nav.difficulty;
  }
  return { valid: true, value };
}

/**
 * Validate player state update
 * @param {number} health
 * @param {number} combo
 * @param {number} score
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePlayerState(health, combo, score) {
  if (typeof health !== 'number' || health < 0 || health > 100) {
    return { valid: false, error: 'Invalid health value' };
  }
  if (typeof combo !== 'number' || combo < 0 || combo > 100000) {
    return { valid: false, error: 'Invalid combo value' };
  }
  if (typeof score !== 'number' || score < 0 || score > 10000000) {
    return { valid: false, error: 'Invalid score value' };
  }
  return { valid: true };
}

/**
 * Validate attack data
 * @param {Object} attackData
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAttackData(attackData) {
  if (!attackData || typeof attackData !== 'object') {
    return { valid: false, error: 'Attack data must be an object' };
  }
  if (!VALID_ATTACK_DIRECTIONS.includes(attackData.direction)) {
    return { valid: false, error: 'Invalid attack direction' };
  }
  if (typeof attackData.timeOffset !== 'number' ||
      attackData.timeOffset < 0 ||
      attackData.timeOffset > MAX_ATTACK_TIME_OFFSET) {
    return { valid: false, error: 'Invalid attack timeOffset' };
  }
  return { valid: true };
}
