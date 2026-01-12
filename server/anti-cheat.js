/**
 * Anti-Cheat System
 *
 * Server-side validation to prevent score manipulation and cheating.
 */

import {
  MAX_HEALTH_INCREASE,
  MAX_COMBO_INCREASE_PER_UPDATE,
  MAX_SCORE_INCREASE_PER_UPDATE,
  SCORE_TOLERANCE_PERCENT,
} from './config.js';

/**
 * Server-side game state tracking for anti-cheat
 * @type {Map<string, { lastHealth: number, lastCombo: number, lastScore: number, updateCount: number, lastSeq: number }>}
 */
export const playerGameTracking = new Map();

/**
 * Initialize tracking for a player at game start
 * @param {string} playerId
 */
export function initPlayerTracking(playerId) {
  playerGameTracking.set(playerId, {
    lastHealth: 100,
    lastCombo: 0,
    lastScore: 0,
    updateCount: 0,
    lastSeq: 0,
  });
}

/**
 * Clean up tracking for a player
 * @param {string} playerId
 */
export function cleanupPlayerTracking(playerId) {
  playerGameTracking.delete(playerId);
}

/**
 * Check if sequence number is valid (not duplicate/out-of-order)
 * @param {string} playerId
 * @param {number} seq
 * @returns {boolean}
 */
export function checkSequence(playerId, seq) {
  const tracking = playerGameTracking.get(playerId);
  if (!tracking || seq <= 0) return true;

  if (seq <= tracking.lastSeq) {
    return false; // Duplicate or out-of-order
  }
  tracking.lastSeq = seq;
  return true;
}

/**
 * Validate player state update against server-side tracking
 * @param {string} playerId
 * @param {number} health
 * @param {number} combo
 * @param {number} score
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePlayerStateUpdate(playerId, health, combo, score) {
  const tracking = playerGameTracking.get(playerId);
  if (!tracking) {
    return { valid: true };
  }

  // Health can only decrease (with small tolerance)
  if (health > tracking.lastHealth + MAX_HEALTH_INCREASE) {
    console.warn(`Anti-cheat: Player ${playerId} health increased suspiciously: ${tracking.lastHealth} -> ${health}`);
    return { valid: false, error: 'Suspicious health increase' };
  }

  // Combo can increase by reasonable amount or reset to 0
  if (combo !== 0 && combo > tracking.lastCombo + MAX_COMBO_INCREASE_PER_UPDATE) {
    console.warn(`Anti-cheat: Player ${playerId} combo increased suspiciously: ${tracking.lastCombo} -> ${combo}`);
    return { valid: false, error: 'Suspicious combo increase' };
  }

  // Score can only increase
  if (score < tracking.lastScore) {
    console.warn(`Anti-cheat: Player ${playerId} score decreased: ${tracking.lastScore} -> ${score}`);
    return { valid: false, error: 'Score cannot decrease' };
  }

  // Score increase should be reasonable
  if (score > tracking.lastScore + MAX_SCORE_INCREASE_PER_UPDATE) {
    console.warn(`Anti-cheat: Player ${playerId} score increased suspiciously: ${tracking.lastScore} -> ${score}`);
    return { valid: false, error: 'Suspicious score increase' };
  }

  return { valid: true };
}

/**
 * Update tracking with new values
 * @param {string} playerId
 * @param {number} health
 * @param {number} combo
 * @param {number} score
 */
export function updateTracking(playerId, health, combo, score) {
  const tracking = playerGameTracking.get(playerId);
  if (tracking) {
    tracking.lastHealth = health;
    tracking.lastCombo = combo;
    tracking.lastScore = score;
    tracking.updateCount++;
  }
}

/**
 * Correct invalid values to last known good values
 * @param {string} playerId
 * @param {number} health
 * @param {number} combo
 * @param {number} score
 * @returns {{ health: number, combo: number, score: number }}
 */
export function correctInvalidValues(playerId, health, combo, score) {
  const tracking = playerGameTracking.get(playerId);
  if (!tracking) {
    return { health, combo, score };
  }

  return {
    health: Math.min(health, tracking.lastHealth + MAX_HEALTH_INCREASE),
    combo: (combo !== 0 && combo > tracking.lastCombo + MAX_COMBO_INCREASE_PER_UPDATE)
      ? tracking.lastCombo
      : combo,
    score: Math.max(tracking.lastScore, Math.min(score, tracking.lastScore + MAX_SCORE_INCREASE_PER_UPDATE)),
  };
}

/**
 * Validate final score against tracked score
 * @param {string} playerId
 * @param {number} claimedScore
 * @returns {number} The validated score
 */
export function validateFinalScore(playerId, claimedScore) {
  const tracking = playerGameTracking.get(playerId);
  if (!tracking) {
    return claimedScore;
  }

  const tolerance = tracking.lastScore * SCORE_TOLERANCE_PERCENT;
  if (claimedScore > tracking.lastScore + tolerance) {
    console.warn(`Anti-cheat: Player ${playerId} final score suspicious: tracked=${tracking.lastScore}, claimed=${claimedScore}`);
    return tracking.lastScore;
  }

  return claimedScore;
}
