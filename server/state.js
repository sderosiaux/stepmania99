/**
 * Server State Management
 *
 * Centralized state for rooms and connections.
 */

/**
 * @typedef {Object} PlayerConnection
 * @property {string} id
 * @property {string} name
 * @property {string|null} roomCode
 * @property {boolean} isAlive
 */

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {boolean} isHost
 * @property {boolean} isReady
 * @property {number} health
 * @property {number} combo
 * @property {number} score
 * @property {boolean} isAlive
 * @property {number|undefined} placement
 * @property {WebSocket} ws
 */

/**
 * @typedef {Object} HostNavigationState
 * @property {number} packIndex
 * @property {number} songIndex
 * @property {string|undefined} songId
 * @property {string|undefined} difficulty
 */

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {Map<string, Player>} players
 * @property {'waiting'|'countdown'|'playing'|'results'} state
 * @property {string|undefined} songId
 * @property {string|undefined} difficulty
 * @property {number|undefined} gameStartTime
 * @property {number} maxPlayers
 * @property {number} eliminationOrder
 * @property {HostNavigationState|undefined} hostNavigation
 * @property {number} createdAt
 * @property {number} lastActivity
 */

/** @type {Map<string, Room>} */
export const rooms = new Map();

/** @type {Map<WebSocket, PlayerConnection>} */
export const connections = new Map();

/**
 * Get a room by code
 * @param {string} code
 * @returns {Room|undefined}
 */
export function getRoom(code) {
  return rooms.get(code);
}

/**
 * Get connection info for a WebSocket
 * @param {WebSocket} ws
 * @returns {PlayerConnection|undefined}
 */
export function getConnection(ws) {
  return connections.get(ws);
}

/**
 * Add a new room
 * @param {Room} room
 */
export function addRoom(room) {
  rooms.set(room.code, room);
}

/**
 * Remove a room
 * @param {string} code
 */
export function removeRoom(code) {
  rooms.delete(code);
}

/**
 * Add a new connection
 * @param {WebSocket} ws
 * @param {PlayerConnection} connection
 */
export function addConnection(ws, connection) {
  connections.set(ws, connection);
}

/**
 * Remove a connection
 * @param {WebSocket} ws
 */
export function removeConnection(ws) {
  connections.delete(ws);
}

/**
 * Get total room count
 * @returns {number}
 */
export function getRoomCount() {
  return rooms.size;
}

/**
 * Get total connection count
 * @returns {number}
 */
export function getConnectionCount() {
  return connections.size;
}

/**
 * Iterate over all rooms
 * @returns {IterableIterator<[string, Room]>}
 */
export function getAllRooms() {
  return rooms.entries();
}
