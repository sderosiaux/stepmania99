/**
 * Rate Limiting
 *
 * Protects the server from abuse and DDoS attacks.
 */

import { RATE_LIMITS, GLOBAL_RATE_LIMIT } from './config.js';

/** @type {Map<WebSocket, Map<string, { count: number, resetTime: number }>>} */
const rateLimiters = new Map();

/**
 * Global server-wide rate limiter
 */
export const globalRateLimiter = {
  count: 0,
  windowStart: Date.now(),

  check() {
    const now = Date.now();
    if (now - this.windowStart > 1000) {
      this.count = 0;
      this.windowStart = now;
    }
    this.count++;
    return this.count <= GLOBAL_RATE_LIMIT.MAX_MESSAGES_PER_SECOND;
  },
};

/**
 * Check rate limit for a specific action
 * @param {WebSocket} ws
 * @param {string} action
 * @returns {boolean} true if allowed, false if rate limited
 */
export function checkRateLimit(ws, action) {
  const now = Date.now();
  const config = RATE_LIMITS[action] || RATE_LIMITS.global;

  if (!rateLimiters.has(ws)) {
    rateLimiters.set(ws, new Map());
  }

  const wsLimits = rateLimiters.get(ws);

  if (!wsLimits.has(action)) {
    wsLimits.set(action, { count: 0, resetTime: now + config.windowMs });
  }

  const limit = wsLimits.get(action);

  if (now > limit.resetTime) {
    limit.count = 0;
    limit.resetTime = now + config.windowMs;
  }

  if (limit.count >= config.max) {
    return false;
  }

  limit.count++;
  return true;
}

/**
 * Clean up rate limiter for disconnected client
 * @param {WebSocket} ws
 */
export function cleanupRateLimiter(ws) {
  rateLimiters.delete(ws);
}
