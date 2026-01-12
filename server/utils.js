/**
 * Server Utility Functions
 *
 * Common utilities used across the server.
 */

import { randomBytes } from 'crypto';
import { WebSocket } from 'ws';
import { ROOM_CODE_LENGTH } from './config.js';

/**
 * Generate a random room code (rejection sampling to avoid modulo bias)
 * @returns {string}
 */
export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars (power of 2 for no bias)
  let code = '';
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[bytes[i] % 32];
  }
  return code;
}

/**
 * Generate a unique player ID
 * @returns {string}
 */
export function generatePlayerId() {
  return randomBytes(8).toString('hex');
}

/**
 * Generate a unique attack ID
 * @returns {string}
 */
export function generateAttackId() {
  return randomBytes(4).toString('hex');
}

/**
 * Send a message to a WebSocket client
 * @param {WebSocket} ws
 * @param {Object} message
 */
export function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast a message to all players in a room
 * @param {Room} room
 * @param {Object} message
 * @param {string|null} excludePlayerId
 */
export function broadcast(room, message, excludePlayerId = null) {
  for (const player of room.players.values()) {
    if (player.id !== excludePlayerId) {
      send(player.ws, message);
    }
  }
}

/**
 * Get room state without WebSocket references (for sending to clients)
 * @param {Room} room
 * @returns {Object}
 */
export function getRoomState(room) {
  return {
    code: room.code,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      isReady: p.isReady,
      health: p.health,
      combo: p.combo,
      score: p.score,
      isAlive: p.isAlive,
      placement: p.placement,
    })),
    state: room.state,
    songId: room.songId,
    difficulty: room.difficulty,
    gameStartTime: room.gameStartTime,
    maxPlayers: room.maxPlayers,
  };
}

/**
 * Count alive players in a room
 * @param {Room} room
 * @returns {number}
 */
export function countAlivePlayers(room) {
  let count = 0;
  for (const player of room.players.values()) {
    if (player.isAlive) count++;
  }
  return count;
}
