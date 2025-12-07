/**
 * Stepmania99 Multiplayer WebSocket Server
 *
 * Handles room management, player synchronization, and attack distribution
 * for the battle royale multiplayer mode.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { randomBytes } from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 3001;
const MAX_PLAYERS_PER_ROOM = 8;
const ROOM_CODE_LENGTH = 6;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const COUNTDOWN_DURATION = 5000; // 5 seconds before game starts

// ============================================================================
// State Management
// ============================================================================

/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {Map<WebSocket, PlayerConnection>} */
const connections = new Map();

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
 * @typedef {Object} Room
 * @property {string} code
 * @property {Map<string, Player>} players
 * @property {'waiting'|'countdown'|'playing'|'results'} state
 * @property {string|undefined} songId
 * @property {string|undefined} difficulty
 * @property {number|undefined} gameStartTime
 * @property {number} maxPlayers
 * @property {number} eliminationOrder
 */

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a random room code
 * @returns {string}
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars
  let code = '';
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Generate a unique player ID
 * @returns {string}
 */
function generatePlayerId() {
  return randomBytes(8).toString('hex');
}

/**
 * Generate a unique attack ID
 * @returns {string}
 */
function generateAttackId() {
  return randomBytes(4).toString('hex');
}

/**
 * Send a message to a WebSocket client
 * @param {WebSocket} ws
 * @param {Object} message
 */
function send(ws, message) {
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
function broadcast(room, message, excludePlayerId = null) {
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
function getRoomState(room) {
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
function countAlivePlayers(room) {
  let count = 0;
  for (const player of room.players.values()) {
    if (player.isAlive) count++;
  }
  return count;
}

// ============================================================================
// Room Management
// ============================================================================

/**
 * Create a new room
 * @param {WebSocket} ws
 * @param {string} playerName
 */
function createRoom(ws, playerName) {
  const playerId = generatePlayerId();
  let roomCode;

  // Ensure unique room code
  do {
    roomCode = generateRoomCode();
  } while (rooms.has(roomCode));

  /** @type {Player} */
  const player = {
    id: playerId,
    name: playerName,
    isHost: true,
    isReady: false,
    health: 100,
    combo: 0,
    score: 0,
    isAlive: true,
    ws,
  };

  /** @type {Room} */
  const room = {
    code: roomCode,
    players: new Map([[playerId, player]]),
    state: 'waiting',
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    eliminationOrder: 0,
  };

  rooms.set(roomCode, room);
  connections.set(ws, { id: playerId, name: playerName, roomCode, isAlive: true });

  send(ws, {
    type: 'room-created',
    room: getRoomState(room),
    playerId,
  });

  console.log(`Room ${roomCode} created by ${playerName} (${playerId})`);
}

/**
 * Join an existing room
 * @param {WebSocket} ws
 * @param {string} roomCode
 * @param {string} playerName
 */
function joinRoom(ws, roomCode, playerName) {
  const room = rooms.get(roomCode.toUpperCase());

  if (!room) {
    send(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  if (room.state !== 'waiting') {
    send(ws, { type: 'error', message: 'Game already in progress' });
    return;
  }

  if (room.players.size >= room.maxPlayers) {
    send(ws, { type: 'error', message: 'Room is full' });
    return;
  }

  const playerId = generatePlayerId();

  /** @type {Player} */
  const player = {
    id: playerId,
    name: playerName,
    isHost: false,
    isReady: false,
    health: 100,
    combo: 0,
    score: 0,
    isAlive: true,
    ws,
  };

  room.players.set(playerId, player);
  connections.set(ws, { id: playerId, name: playerName, roomCode: room.code, isAlive: true });

  // Notify existing players
  broadcast(room, {
    type: 'player-joined',
    player: {
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      isReady: player.isReady,
      health: player.health,
      combo: player.combo,
      score: player.score,
      isAlive: player.isAlive,
    },
  }, playerId);

  // Send room state to new player
  send(ws, {
    type: 'room-joined',
    room: getRoomState(room),
    playerId,
  });

  console.log(`${playerName} (${playerId}) joined room ${roomCode}`);
}

/**
 * Handle player leaving a room
 * @param {WebSocket} ws
 */
function leaveRoom(ws) {
  const conn = connections.get(ws);
  if (!conn || !conn.roomCode) return;

  const room = rooms.get(conn.roomCode);
  if (!room) return;

  const player = room.players.get(conn.id);
  if (!player) return;

  room.players.delete(conn.id);
  conn.roomCode = null;

  console.log(`${conn.name} (${conn.id}) left room ${room.code}`);

  // If room is empty, delete it
  if (room.players.size === 0) {
    rooms.delete(room.code);
    console.log(`Room ${room.code} deleted (empty)`);
    return;
  }

  // If host left, assign new host
  let newHostId = null;
  if (player.isHost) {
    const newHost = room.players.values().next().value;
    if (newHost) {
      newHost.isHost = true;
      newHostId = newHost.id;
      console.log(`New host: ${newHost.name} (${newHost.id})`);
    }
  }

  // Notify remaining players
  broadcast(room, {
    type: 'player-left',
    playerId: conn.id,
    newHostId,
  });

  // If game is playing and player was alive, check for game end
  if (room.state === 'playing' && player.isAlive) {
    checkGameEnd(room);
  }
}

// ============================================================================
// Game Flow
// ============================================================================

/**
 * Toggle player ready status
 * @param {WebSocket} ws
 */
function toggleReady(ws) {
  const conn = connections.get(ws);
  if (!conn || !conn.roomCode) return;

  const room = rooms.get(conn.roomCode);
  if (!room || room.state !== 'waiting') return;

  const player = room.players.get(conn.id);
  if (!player) return;

  player.isReady = !player.isReady;

  broadcast(room, {
    type: 'room-updated',
    room: getRoomState(room),
  });
}

/**
 * Select song for the room (host only)
 * @param {WebSocket} ws
 * @param {string} songId
 * @param {string} difficulty
 */
function selectSong(ws, songId, difficulty) {
  const conn = connections.get(ws);
  if (!conn || !conn.roomCode) return;

  const room = rooms.get(conn.roomCode);
  if (!room || room.state !== 'waiting') return;

  const player = room.players.get(conn.id);
  if (!player || !player.isHost) {
    send(ws, { type: 'error', message: 'Only host can select song' });
    return;
  }

  room.songId = songId;
  room.difficulty = difficulty;

  broadcast(room, {
    type: 'room-updated',
    room: getRoomState(room),
  });
}

/**
 * Start the game (host only)
 * @param {WebSocket} ws
 */
function startGame(ws) {
  const conn = connections.get(ws);
  if (!conn || !conn.roomCode) return;

  const room = rooms.get(conn.roomCode);
  if (!room || room.state !== 'waiting') return;

  const player = room.players.get(conn.id);
  if (!player || !player.isHost) {
    send(ws, { type: 'error', message: 'Only host can start game' });
    return;
  }

  if (!room.songId || !room.difficulty) {
    send(ws, { type: 'error', message: 'Please select a song first' });
    return;
  }

  // Check if at least 2 players
  if (room.players.size < 2) {
    send(ws, { type: 'error', message: 'Need at least 2 players to start' });
    return;
  }

  // Check if all players are ready (except host)
  for (const p of room.players.values()) {
    if (!p.isHost && !p.isReady) {
      send(ws, { type: 'error', message: 'Not all players are ready' });
      return;
    }
  }

  // Start countdown
  room.state = 'countdown';
  room.eliminationOrder = room.players.size;

  // Reset all players
  for (const p of room.players.values()) {
    p.health = 100;
    p.combo = 0;
    p.score = 0;
    p.isAlive = true;
    p.placement = undefined;
  }

  const startTime = Date.now() + COUNTDOWN_DURATION;
  room.gameStartTime = startTime;

  broadcast(room, {
    type: 'game-starting',
    startTime,
  });

  console.log(`Game starting in room ${room.code} at ${startTime}`);

  // After countdown, start game
  setTimeout(() => {
    if (room.state === 'countdown') {
      room.state = 'playing';
      broadcast(room, { type: 'game-started' });
      console.log(`Game started in room ${room.code}`);
    }
  }, COUNTDOWN_DURATION);
}

/**
 * Update player state during gameplay
 * @param {WebSocket} ws
 * @param {number} health
 * @param {number} combo
 * @param {number} score
 */
function updatePlayerState(ws, health, combo, score) {
  const conn = connections.get(ws);
  if (!conn || !conn.roomCode) return;

  const room = rooms.get(conn.roomCode);
  if (!room || room.state !== 'playing') return;

  const player = room.players.get(conn.id);
  if (!player || !player.isAlive) return;

  player.health = health;
  player.combo = combo;
  player.score = score;

  // Broadcast to other players
  broadcast(room, {
    type: 'player-state',
    playerId: player.id,
    health,
    combo,
    score,
  }, player.id);
}

/**
 * Handle player death
 * @param {WebSocket} ws
 */
function handlePlayerDeath(ws) {
  const conn = connections.get(ws);
  if (!conn || !conn.roomCode) return;

  const room = rooms.get(conn.roomCode);
  if (!room || room.state !== 'playing') return;

  const player = room.players.get(conn.id);
  if (!player || !player.isAlive) return;

  player.isAlive = false;
  player.placement = room.eliminationOrder;
  room.eliminationOrder--;

  console.log(`${player.name} eliminated (placement: ${player.placement})`);

  broadcast(room, {
    type: 'player-eliminated',
    playerId: player.id,
    placement: player.placement,
  });

  checkGameEnd(room);
}

/**
 * Handle attack from player
 * @param {WebSocket} ws
 * @param {Object} attackData
 */
function handleAttack(ws, attackData) {
  const conn = connections.get(ws);
  if (!conn || !conn.roomCode) return;

  const room = rooms.get(conn.roomCode);
  if (!room || room.state !== 'playing') return;

  const player = room.players.get(conn.id);
  if (!player || !player.isAlive) return;

  const attack = {
    id: generateAttackId(),
    direction: attackData.direction,
    timeOffset: attackData.timeOffset,
    fromPlayerId: player.id,
    fromPlayerName: player.name,
  };

  // Send attack to a random alive opponent
  const aliveOpponents = Array.from(room.players.values()).filter(
    p => p.id !== player.id && p.isAlive
  );

  if (aliveOpponents.length > 0) {
    const target = aliveOpponents[Math.floor(Math.random() * aliveOpponents.length)];
    send(target.ws, {
      type: 'attack-received',
      attack,
    });
  }
}

/**
 * Handle game finished for a player
 * @param {WebSocket} ws
 * @param {number} score
 */
function handleGameFinished(ws, score) {
  const conn = connections.get(ws);
  if (!conn || !conn.roomCode) return;

  const room = rooms.get(conn.roomCode);
  if (!room || room.state !== 'playing') return;

  const player = room.players.get(conn.id);
  if (!player) return;

  player.score = score;

  // If player is still alive when song ends, they survived
  if (player.isAlive) {
    player.placement = 1; // Will be adjusted below
  }

  checkGameEnd(room);
}

/**
 * Check if game should end
 * @param {Room} room
 */
function checkGameEnd(room) {
  const alivePlayers = Array.from(room.players.values()).filter(p => p.isAlive);

  // Game ends when 0 or 1 players remain
  if (alivePlayers.length <= 1) {
    endGame(room);
  }
}

/**
 * End the game and calculate final placements
 * @param {Room} room
 */
function endGame(room) {
  room.state = 'results';

  // Calculate final placements based on survival and score
  const players = Array.from(room.players.values());

  // Sort by: alive first, then by score (descending)
  players.sort((a, b) => {
    if (a.isAlive !== b.isAlive) {
      return a.isAlive ? -1 : 1;
    }
    return b.score - a.score;
  });

  // Assign final placements for survivors
  let placement = 1;
  for (const player of players) {
    if (player.isAlive) {
      player.placement = placement++;
    }
  }

  const finalPlacements = players.map(p => ({
    playerId: p.id,
    placement: p.placement || room.players.size,
    score: p.score,
  }));

  broadcast(room, {
    type: 'game-ended',
    finalPlacements,
  });

  console.log(`Game ended in room ${room.code}`, finalPlacements);

  // Reset room to waiting state after a delay
  setTimeout(() => {
    if (room.state === 'results') {
      room.state = 'waiting';
      room.songId = undefined;
      room.difficulty = undefined;
      room.gameStartTime = undefined;

      // Reset all players
      for (const player of room.players.values()) {
        player.isReady = false;
        player.health = 100;
        player.combo = 0;
        player.score = 0;
        player.isAlive = true;
        player.placement = undefined;
      }

      broadcast(room, {
        type: 'room-updated',
        room: getRoomState(room),
      });
    }
  }, 10000); // 10 second delay before resetting
}

// ============================================================================
// WebSocket Server Setup
// ============================================================================

const server = createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      connections: connections.size,
    }));
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('New connection');

  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(ws, message);
    } catch (err) {
      console.error('Invalid message:', err);
      send(ws, { type: 'error', message: 'Invalid message format' });
    }
  });

  ws.on('close', () => {
    console.log('Connection closed');
    leaveRoom(ws);
    connections.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

/**
 * Handle incoming message
 * @param {WebSocket} ws
 * @param {Object} message
 */
function handleMessage(ws, message) {
  switch (message.type) {
    case 'create-room':
      createRoom(ws, message.playerName);
      break;

    case 'join-room':
      joinRoom(ws, message.roomCode, message.playerName);
      break;

    case 'leave-room':
      leaveRoom(ws);
      break;

    case 'toggle-ready':
      toggleReady(ws);
      break;

    case 'select-song':
      selectSong(ws, message.songId, message.difficulty);
      break;

    case 'start-game':
      startGame(ws);
      break;

    case 'player-update':
      updatePlayerState(ws, message.health, message.combo, message.score);
      break;

    case 'player-died':
      handlePlayerDeath(ws);
      break;

    case 'send-attack':
      handleAttack(ws, message.attack);
      break;

    case 'game-finished':
      handleGameFinished(ws, message.score);
      break;

    case 'ping':
      send(ws, { type: 'pong' });
      break;

    default:
      console.warn('Unknown message type:', message.type);
  }
}

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      leaveRoom(ws);
      connections.delete(ws);
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeat);
});

// ============================================================================
// Start Server
// ============================================================================

server.listen(PORT, () => {
  console.log(`Stepmania99 server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});
