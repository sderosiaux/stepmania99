// ============================================================================
// Multiplayer Types for Stepmania99
// ============================================================================

import type { Direction, Difficulty } from './index';

// ============================================================================
// Player & Room Types
// ============================================================================

/** Unique player identifier */
export type PlayerId = string;

/** Unique room identifier (6 character code) */
export type RoomCode = string;

/** Player state in multiplayer */
export interface Player {
  /** Unique player ID */
  id: PlayerId;
  /** Display name */
  name: string;
  /** Is this player the room host */
  isHost: boolean;
  /** Is player ready to start */
  isReady: boolean;
  /** Current health (0-100) */
  health: number;
  /** Current combo */
  combo: number;
  /** Current score */
  score: number;
  /** Is player still alive (not failed) */
  isAlive: boolean;
  /** Final placement (1st, 2nd, etc.) - set when eliminated */
  placement?: number;
}

/** Room state */
export interface Room {
  /** Room code for joining */
  code: RoomCode;
  /** All players in the room */
  players: Player[];
  /** Current room state */
  state: RoomState;
  /** Selected song ID (set by host) */
  songId?: string;
  /** Selected difficulty (set by host) */
  difficulty?: Difficulty;
  /** Game start timestamp (for sync) */
  gameStartTime?: number;
  /** Maximum players allowed */
  maxPlayers: number;
}

/** Room lifecycle states */
export type RoomState = 'waiting' | 'countdown' | 'playing' | 'results';

// ============================================================================
// Attack System Types
// ============================================================================

/** Attack arrow sent to opponents */
export interface AttackArrow {
  /** Unique attack ID */
  id: string;
  /** Direction of the attack arrow */
  direction: Direction;
  /** Time offset when arrow should appear (ms from now) */
  timeOffset: number;
  /** Player who sent the attack */
  fromPlayerId: PlayerId;
  /** Player name who sent it (for display) */
  fromPlayerName: string;
}

/** Attack configuration */
export const ATTACK_CONFIG = {
  /** Combo threshold to trigger attack */
  comboThreshold: 10,
  /** Number of arrows sent per attack */
  arrowsPerAttack: 2,
  /** Min time before attack arrow appears (ms) */
  minTimeOffset: 500,
  /** Max time before attack arrow appears (ms) */
  maxTimeOffset: 2000,
  /** Damage when attack arrow is missed */
  missedAttackDamage: 5,
  /** Whether hitting an attack arrow breaks combo */
  attackBreaksCombo: false,
} as const;

// ============================================================================
// WebSocket Message Types
// ============================================================================

/** Host navigation state for syncing with guests */
export interface HostNavigationState {
  /** Currently selected pack index */
  packIndex: number;
  /** Currently selected song index within pack */
  songIndex: number;
  /** Selected song ID (if any) */
  songId?: string;
  /** Selected difficulty (if any) */
  difficulty?: Difficulty;
}

/** Message from client to server */
export type ClientMessage =
  | { type: 'create-room'; playerName: string }
  | { type: 'join-room'; roomCode: RoomCode; playerName: string }
  | { type: 'leave-room' }
  | { type: 'toggle-ready' }
  | { type: 'select-song'; songId: string; difficulty: Difficulty }
  | { type: 'start-game' }
  | { type: 'player-update'; health: number; combo: number; score: number }
  | { type: 'player-died' }
  | { type: 'send-attack'; attack: Omit<AttackArrow, 'id' | 'fromPlayerId' | 'fromPlayerName'> }
  | { type: 'game-finished'; score: number; placement: number }
  | { type: 'host-navigation'; navigation: HostNavigationState }
  | { type: 'ping' };

/** Message from server to client */
export type ServerMessage =
  | { type: 'room-created'; room: Room; playerId: PlayerId }
  | { type: 'room-joined'; room: Room; playerId: PlayerId; hostNavigation?: HostNavigationState }
  | { type: 'room-updated'; room: Room }
  | { type: 'player-joined'; player: Player }
  | { type: 'player-left'; playerId: PlayerId; newHostId?: PlayerId }
  | { type: 'game-starting'; startTime: number }
  | { type: 'game-started' }
  | { type: 'player-state'; playerId: PlayerId; health: number; combo: number; score: number }
  | { type: 'player-eliminated'; playerId: PlayerId; placement: number }
  | { type: 'attack-received'; attack: AttackArrow }
  | { type: 'game-ended'; finalPlacements: Array<{ playerId: PlayerId; placement: number; score: number }> }
  | { type: 'host-navigation'; navigation: HostNavigationState }
  | { type: 'error'; message: string }
  | { type: 'pong' };

// ============================================================================
// Connection State
// ============================================================================

/** Client connection state */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Multiplayer session info stored on client */
export interface MultiplayerSession {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Current room (if joined) */
  room: Room | null;
  /** Local player ID */
  playerId: PlayerId | null;
  /** Server URL */
  serverUrl: string;
}

// ============================================================================
// Game Sync Types
// ============================================================================

/** Synchronized game state broadcast to all players */
export interface SyncedGameState {
  /** Current game time (ms from start) */
  gameTime: number;
  /** All player states */
  players: Array<{
    id: PlayerId;
    health: number;
    combo: number;
    score: number;
    isAlive: boolean;
  }>;
}

// ============================================================================
// Utility Types
// ============================================================================

/** Result of a multiplayer game for a single player */
export interface MultiplayerResult {
  /** Final placement (1 = winner) */
  placement: number;
  /** Total players in the game */
  totalPlayers: number;
  /** Final score */
  score: number;
  /** Whether player survived until the end */
  survived: boolean;
  /** Attacks sent */
  attacksSent: number;
  /** Attacks received */
  attacksReceived: number;
}
