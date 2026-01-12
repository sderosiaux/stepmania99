/**
 * Stepmania99 Multiplayer WebSocket Server
 *
 * Handles room management, player synchronization, and attack distribution
 * for the battle royale multiplayer mode.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

// Import configuration
import {
  PORT,
  MAX_PLAYERS_PER_ROOM,
  MAX_TOTAL_ROOMS,
  ROOM_EXPIRY_MS,
  ROOM_CLEANUP_INTERVAL,
  HEARTBEAT_INTERVAL,
  COUNTDOWN_DURATION,
  ALLOWED_ORIGINS,
  ATTACK_COMBO_COST,
} from './config.js';

// Import validation functions
import {
  safeJsonParse,
  validatePlayerName,
  validateRoomCode,
  validateNavigation,
  validatePlayerState,
  validateAttackData,
} from './validation.js';

// Import rate limiting
import {
  globalRateLimiter,
  checkRateLimit,
  cleanupRateLimiter,
} from './rate-limiter.js';

// Import anti-cheat system
import {
  initPlayerTracking,
  cleanupPlayerTracking,
  checkSequence,
  validatePlayerStateUpdate,
  updateTracking,
  correctInvalidValues,
  validateFinalScore,
} from './anti-cheat.js';

// Import utilities
import {
  generateRoomCode,
  generatePlayerId,
  generateAttackId,
  send,
  broadcast,
  getRoomState,
} from './utils.js';

// Import state management
import {
  rooms,
  connections,
  getRoom,
  getConnection,
  addRoom,
  removeRoom,
  addConnection,
  removeConnection,
  getRoomCount,
  getConnectionCount,
  getAllRooms,
} from './state.js';

// ============================================================================
// Room Management
// ============================================================================

/**
 * Create a new room
 * @param {WebSocket} ws
 * @param {string} playerName
 */
function createRoom(ws, playerName) {
  if (getRoomCount() >= MAX_TOTAL_ROOMS) {
    send(ws, { type: 'error', message: 'Server is at capacity. Please try again later.' });
    return;
  }

  const playerId = generatePlayerId();
  let roomCode;

  do {
    roomCode = generateRoomCode();
  } while (getRoom(roomCode));

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

  const now = Date.now();
  const room = {
    code: roomCode,
    players: new Map([[playerId, player]]),
    state: 'waiting',
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    eliminationOrder: 0,
    createdAt: now,
    lastActivity: now,
  };

  addRoom(room);
  addConnection(ws, { id: playerId, name: playerName, roomCode, isAlive: true });

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
  const room = getRoom(roomCode.toUpperCase());

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

  // Check for duplicate player name
  const lowerName = playerName.toLowerCase();
  for (const existingPlayer of room.players.values()) {
    if (existingPlayer.name.toLowerCase() === lowerName) {
      send(ws, { type: 'error', message: 'A player with this name is already in the room' });
      return;
    }
  }

  const playerId = generatePlayerId();

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
  room.lastActivity = Date.now();
  addConnection(ws, { id: playerId, name: playerName, roomCode: room.code, isAlive: true });

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

  send(ws, {
    type: 'room-joined',
    room: getRoomState(room),
    playerId,
    hostNavigation: room.hostNavigation,
  });

  console.log(`${playerName} (${playerId}) joined room ${roomCode}`);
}

/**
 * Handle player leaving a room
 * @param {WebSocket} ws
 */
function leaveRoom(ws) {
  const conn = getConnection(ws);
  if (!conn || !conn.roomCode) return;

  const room = getRoom(conn.roomCode);
  if (!room) return;

  const player = room.players.get(conn.id);
  if (!player) return;

  room.players.delete(conn.id);
  conn.roomCode = null;

  console.log(`${conn.name} (${conn.id}) left room ${room.code}`);

  if (room.players.size === 0) {
    removeRoom(room.code);
    console.log(`Room ${room.code} deleted (empty)`);
    return;
  }

  let newHostId = null;
  if (player.isHost) {
    const newHost = room.players.values().next().value;
    if (newHost) {
      newHost.isHost = true;
      newHostId = newHost.id;
      console.log(`New host: ${newHost.name} (${newHost.id})`);
    }
  }

  broadcast(room, {
    type: 'player-left',
    playerId: conn.id,
    newHostId,
  });

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
  const conn = getConnection(ws);
  if (!conn || !conn.roomCode) return;

  const room = getRoom(conn.roomCode);
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
  const conn = getConnection(ws);
  if (!conn || !conn.roomCode) return;

  const room = getRoom(conn.roomCode);
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
  const conn = getConnection(ws);
  if (!conn || !conn.roomCode) return;

  const room = getRoom(conn.roomCode);
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

  if (room.players.size < 2) {
    send(ws, { type: 'error', message: 'Need at least 2 players to start' });
    return;
  }

  for (const p of room.players.values()) {
    if (!p.isHost && !p.isReady) {
      send(ws, { type: 'error', message: 'Not all players are ready' });
      return;
    }
  }

  room.state = 'countdown';
  room.eliminationOrder = room.players.size;
  room.lastActivity = Date.now();

  for (const p of room.players.values()) {
    p.health = 100;
    p.combo = 0;
    p.score = 0;
    p.isAlive = true;
    p.placement = undefined;
    initPlayerTracking(p.id);
  }

  const startTime = Date.now() + COUNTDOWN_DURATION;
  room.gameStartTime = startTime;

  broadcast(room, {
    type: 'game-starting',
    startTime,
  });

  console.log(`Game starting in room ${room.code} at ${startTime}`);

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
 * @param {number} seq
 */
function updatePlayerState(ws, health, combo, score, seq = 0) {
  const conn = getConnection(ws);
  if (!conn || !conn.roomCode) return;

  const room = getRoom(conn.roomCode);
  if (!room || room.state !== 'playing') return;

  const player = room.players.get(conn.id);
  if (!player || !player.isAlive) return;

  // Check sequence number for deduplication
  if (seq > 0 && !checkSequence(conn.id, seq)) {
    return;
  }

  // Validate and correct if needed
  const validation = validatePlayerStateUpdate(conn.id, health, combo, score);
  if (!validation.valid) {
    const corrected = correctInvalidValues(conn.id, health, combo, score);
    health = corrected.health;
    combo = corrected.combo;
    score = corrected.score;
  }

  updateTracking(conn.id, health, combo, score);

  player.health = health;
  player.combo = combo;
  player.score = score;

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
  const conn = getConnection(ws);
  if (!conn || !conn.roomCode) return;

  const room = getRoom(conn.roomCode);
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
  const conn = getConnection(ws);
  if (!conn || !conn.roomCode) return;

  const room = getRoom(conn.roomCode);
  if (!room || room.state !== 'playing') return;

  const player = room.players.get(conn.id);
  if (!player || !player.isAlive) return;

  const validation = validateAttackData(attackData);
  if (!validation.valid) return;

  if (player.combo < ATTACK_COMBO_COST) return;

  player.combo -= ATTACK_COMBO_COST;

  const attack = {
    id: generateAttackId(),
    direction: attackData.direction,
    timeOffset: attackData.timeOffset,
    fromPlayerId: player.id,
    fromPlayerName: player.name,
  };

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
 * Handle host navigation update
 * @param {WebSocket} ws
 * @param {Object} navigation
 */
function handleHostNavigation(ws, navigation) {
  const conn = getConnection(ws);
  if (!conn || !conn.roomCode) {
    send(ws, { type: 'error', message: 'Not in a room' });
    return;
  }

  const room = getRoom(conn.roomCode);
  if (!room) {
    send(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  const player = room.players.get(conn.id);
  if (!player || !player.isHost) {
    console.warn(`Unauthorized host-navigation attempt by ${conn.name} (${conn.id}) in room ${room.code}`);
    send(ws, { type: 'error', message: 'Only the host can control navigation' });
    return;
  }

  room.hostNavigation = navigation;

  broadcast(room, {
    type: 'host-navigation',
    navigation,
  }, conn.id);
}

/**
 * Handle game finished for a player
 * @param {WebSocket} ws
 * @param {number} score
 */
function handleGameFinished(ws, score) {
  const conn = getConnection(ws);
  if (!conn || !conn.roomCode) return;

  const room = getRoom(conn.roomCode);
  if (!room || room.state !== 'playing') return;

  const player = room.players.get(conn.id);
  if (!player) return;

  score = validateFinalScore(conn.id, score);
  cleanupPlayerTracking(conn.id);

  player.score = score;

  if (player.isAlive) {
    player.placement = 1;
  }

  checkGameEnd(room);
}

/**
 * Check if game should end
 * @param {Object} room
 */
function checkGameEnd(room) {
  const alivePlayers = Array.from(room.players.values()).filter(p => p.isAlive);

  if (alivePlayers.length <= 1) {
    endGame(room);
  }
}

/**
 * End the game and calculate final placements
 * @param {Object} room
 */
function endGame(room) {
  room.state = 'results';

  const players = Array.from(room.players.values());

  players.sort((a, b) => {
    if (a.isAlive !== b.isAlive) {
      return a.isAlive ? -1 : 1;
    }
    return b.score - a.score;
  });

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

  setTimeout(() => {
    if (room.state === 'results') {
      room.state = 'waiting';
      room.songId = undefined;
      room.difficulty = undefined;
      room.gameStartTime = undefined;

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
  }, 10000);
}

// ============================================================================
// WebSocket Server Setup
// ============================================================================

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  const isAllowedOrigin = origin && ALLOWED_ORIGINS.has(origin);

  const corsHeaders = {
    'Access-Control-Allow-Origin': isAllowedOrigin ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Private-Network': 'true',
  };

  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin) {
      res.writeHead(403);
      res.end('CORS origin not allowed');
      return;
    }
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...corsHeaders,
    });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: getRoomCount(),
      connections: getConnectionCount(),
    }));
    return;
  }

  res.writeHead(404, corsHeaders);
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
      const message = safeJsonParse(data.toString());
      handleMessage(ws, message);
    } catch (err) {
      console.error('Invalid message:', err);
      send(ws, { type: 'error', message: 'Invalid message format' });
    }
  });

  ws.on('close', () => {
    console.log('Connection closed');
    leaveRoom(ws);
    removeConnection(ws);
    cleanupRateLimiter(ws);
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
  if (!globalRateLimiter.check()) {
    return;
  }

  if (!checkRateLimit(ws, 'global')) {
    send(ws, { type: 'error', message: 'Rate limit exceeded' });
    return;
  }

  switch (message.type) {
    case 'create-room': {
      if (!checkRateLimit(ws, 'create-room')) {
        send(ws, { type: 'error', message: 'Please wait before creating another room' });
        return;
      }
      const nameResult = validatePlayerName(message.playerName);
      if (!nameResult.valid) {
        send(ws, { type: 'error', message: nameResult.error });
        return;
      }
      createRoom(ws, nameResult.value);
      break;
    }

    case 'join-room': {
      const nameResult = validatePlayerName(message.playerName);
      if (!nameResult.valid) {
        send(ws, { type: 'error', message: nameResult.error });
        return;
      }
      const codeResult = validateRoomCode(message.roomCode);
      if (!codeResult.valid) {
        send(ws, { type: 'error', message: codeResult.error });
        return;
      }
      joinRoom(ws, codeResult.value, nameResult.value);
      break;
    }

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

    case 'player-update': {
      if (!checkRateLimit(ws, 'player-update')) {
        return;
      }
      const stateResult = validatePlayerState(message.health, message.combo, message.score);
      if (!stateResult.valid) {
        return;
      }
      const seq = typeof message.seq === 'number' ? message.seq : 0;
      updatePlayerState(ws, message.health, message.combo, message.score, seq);
      break;
    }

    case 'player-died':
      handlePlayerDeath(ws);
      break;

    case 'send-attack': {
      if (!checkRateLimit(ws, 'send-attack')) {
        return;
      }
      handleAttack(ws, message.attack);
      break;
    }

    case 'game-finished':
      handleGameFinished(ws, message.score);
      break;

    case 'host-navigation': {
      if (!checkRateLimit(ws, 'host-navigation')) {
        return;
      }
      const navResult = validateNavigation(message.navigation);
      if (!navResult.valid) {
        send(ws, { type: 'error', message: navResult.error });
        return;
      }
      handleHostNavigation(ws, navResult.value);
      break;
    }

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
      removeConnection(ws);
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// Room expiry cleanup task
const roomCleanup = setInterval(() => {
  const now = Date.now();
  for (const [roomCode, room] of getAllRooms()) {
    if (room.players.size === 0) {
      removeRoom(roomCode);
      console.log(`Room ${roomCode} deleted (empty)`);
      continue;
    }

    const lastActivity = room.lastActivity || room.createdAt || now;
    const inactiveTime = now - lastActivity;

    if (inactiveTime > ROOM_EXPIRY_MS) {
      broadcast(room, { type: 'error', message: 'Room expired due to inactivity' });
      removeRoom(roomCode);
      console.log(`Room ${roomCode} expired (inactive for ${Math.round(inactiveTime / 60000)} minutes)`);
    }
  }
}, ROOM_CLEANUP_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeat);
  clearInterval(roomCleanup);
});

// ============================================================================
// Start Server
// ============================================================================

server.listen(PORT, () => {
  console.log(`Stepmania99 server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n${signal} received. Starting graceful shutdown...`);

  clearInterval(heartbeat);
  clearInterval(roomCleanup);

  const shutdownMessage = { type: 'server-shutdown', message: 'Server is shutting down', reconnectIn: 30 };
  wss.clients.forEach((ws) => {
    try {
      send(ws, shutdownMessage);
    } catch {
      // Ignore errors
    }
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  wss.clients.forEach((ws) => {
    try {
      ws.close(1001, 'Server shutting down');
    } catch {
      ws.terminate();
    }
  });

  const closeTimeout = setTimeout(() => {
    console.log('Force closing remaining connections...');
    wss.clients.forEach((ws) => ws.terminate());
  }, 5000);

  wss.close(() => {
    clearTimeout(closeTimeout);
    server.close(() => {
      console.log('Graceful shutdown complete.');
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('Forced exit after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});
