/**
 * Stepmania99 Multiplayer Client
 *
 * Manages WebSocket connection to the game server for multiplayer functionality.
 */

import type {
  ClientMessage,
  ServerMessage,
  Room,
  PlayerId,
  RoomCode,
  ConnectionState,
  HostNavigationState,
} from '../types/multiplayer';
import type { Difficulty } from '../types';

// ============================================================================
// Event Types
// ============================================================================

export type MultiplayerEventType =
  | 'connection-changed'
  | 'room-created'
  | 'room-joined'
  | 'room-updated'
  | 'player-joined'
  | 'player-left'
  | 'game-starting'
  | 'game-started'
  | 'player-state'
  | 'player-eliminated'
  | 'attack-received'
  | 'game-ended'
  | 'host-navigation'
  | 'error';

export interface MultiplayerEvent {
  type: MultiplayerEventType;
  data?: unknown;
}

export type MultiplayerEventHandler = (event: MultiplayerEvent) => void;

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_SERVER_URL = 'ws://localhost:3001';
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL = 25000;

// ============================================================================
// Multiplayer Client Class
// ============================================================================

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private connectionState: ConnectionState = 'disconnected';
  private eventHandlers: Set<MultiplayerEventHandler> = new Set();

  private room: Room | null = null;
  private playerId: PlayerId | null = null;
  private playerName: string = '';

  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // Bound event handlers for proper cleanup (Fix: Memory Leak)
  private boundOnOpen: (() => void) | null = null;
  private boundOnClose: (() => void) | null = null;
  private boundOnError: ((event: Event) => void) | null = null;
  private boundOnMessage: ((event: MessageEvent) => void) | null = null;

  constructor(serverUrl?: string) {
    this.serverUrl = serverUrl || DEFAULT_SERVER_URL;
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Add event listener
   */
  addEventListener(handler: MultiplayerEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Remove event listener
   */
  removeEventListener(handler: MultiplayerEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Emit event to all handlers
   */
  private emit(event: MultiplayerEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('Event handler error:', err);
      }
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected to server
   */
  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  /**
   * Get current room
   */
  getRoom(): Room | null {
    return this.room;
  }

  /**
   * Get local player ID
   */
  getPlayerId(): PlayerId | null {
    return this.playerId;
  }

  /**
   * Get local player name
   */
  getPlayerName(): string {
    return this.playerName;
  }

  /**
   * Check if local player is host
   */
  isHost(): boolean {
    if (!this.room || !this.playerId) return false;
    const player = this.room.players.find((p) => p.id === this.playerId);
    return player?.isHost ?? false;
  }

  /**
   * Set server URL
   */
  setServerUrl(url: string): void {
    this.serverUrl = url;
  }

  /**
   * Clean up WebSocket event handlers (Fix: Memory Leak)
   */
  private cleanupWebSocketHandlers(): void {
    if (this.ws) {
      if (this.boundOnOpen) {
        this.ws.removeEventListener('open', this.boundOnOpen);
      }
      if (this.boundOnClose) {
        this.ws.removeEventListener('close', this.boundOnClose);
      }
      if (this.boundOnError) {
        this.ws.removeEventListener('error', this.boundOnError);
      }
      if (this.boundOnMessage) {
        this.ws.removeEventListener('message', this.boundOnMessage);
      }
    }
    this.boundOnOpen = null;
    this.boundOnClose = null;
    this.boundOnError = null;
    this.boundOnMessage = null;
  }

  /**
   * Connect to server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.disconnect();
      }

      this.connectionState = 'connecting';
      this.emit({ type: 'connection-changed', data: this.connectionState });

      try {
        this.ws = new WebSocket(this.serverUrl);

        // Create bound handlers for proper cleanup (Fix: Memory Leak)
        this.boundOnOpen = () => {
          console.log('Connected to multiplayer server');
          this.connectionState = 'connected';
          this.reconnectAttempts = 0;
          this.startPing();
          this.emit({ type: 'connection-changed', data: this.connectionState });
          resolve();
        };

        this.boundOnClose = () => {
          console.log('Disconnected from multiplayer server');
          this.handleDisconnect();
        };

        this.boundOnError = (error: Event) => {
          console.error('WebSocket error:', error);
          this.connectionState = 'error';
          this.emit({ type: 'connection-changed', data: this.connectionState });
          reject(new Error('Connection failed'));
        };

        this.boundOnMessage = (event: MessageEvent) => {
          this.handleMessage(event.data);
        };

        this.ws.addEventListener('open', this.boundOnOpen);
        this.ws.addEventListener('close', this.boundOnClose);
        this.ws.addEventListener('error', this.boundOnError);
        this.ws.addEventListener('message', this.boundOnMessage);
      } catch (err) {
        this.connectionState = 'error';
        this.emit({ type: 'connection-changed', data: this.connectionState });
        reject(err);
      }
    });
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.stopPing();
    this.cancelReconnect();

    if (this.ws) {
      // Clean up event handlers before closing (Fix: Memory Leak)
      this.cleanupWebSocketHandlers();
      this.ws.close();
      this.ws = null;
    }

    this.connectionState = 'disconnected';
    this.room = null;
    this.playerId = null;
    this.emit({ type: 'connection-changed', data: this.connectionState });
  }

  /**
   * Handle disconnection (attempt reconnect)
   */
  private handleDisconnect(): void {
    this.stopPing();
    // Clean up handlers before nulling ws (Fix: Memory Leak)
    this.cleanupWebSocketHandlers();
    this.ws = null;
    this.connectionState = 'disconnected';
    this.emit({ type: 'connection-changed', data: this.connectionState });

    // Attempt reconnect if we were in a room
    if (this.room && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    this.cancelReconnect();
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`Reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
      this.connect().catch(() => {
        if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.scheduleReconnect();
        }
      });
    }, RECONNECT_DELAY);
  }

  /**
   * Cancel pending reconnection
   */
  private cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Start ping interval
   */
  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, PING_INTERVAL);
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  /**
   * Send message to server
   */
  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as ServerMessage;

      switch (message.type) {
        case 'room-created':
          this.room = message.room;
          this.playerId = message.playerId;
          this.emit({ type: 'room-created', data: { room: this.room, playerId: this.playerId } });
          break;

        case 'room-joined':
          this.room = message.room;
          this.playerId = message.playerId;
          this.emit({ type: 'room-joined', data: { room: this.room, playerId: this.playerId } });
          break;

        case 'room-updated':
          this.room = message.room;
          this.emit({ type: 'room-updated', data: this.room });
          break;

        case 'player-joined':
          if (this.room) {
            this.room.players.push(message.player);
          }
          this.emit({ type: 'player-joined', data: message.player });
          break;

        case 'player-left':
          if (this.room) {
            this.room.players = this.room.players.filter((p) => p.id !== message.playerId);
            if (message.newHostId) {
              const newHost = this.room.players.find((p) => p.id === message.newHostId);
              if (newHost) newHost.isHost = true;
            }
          }
          this.emit({
            type: 'player-left',
            data: { playerId: message.playerId, newHostId: message.newHostId },
          });
          break;

        case 'game-starting':
          if (this.room) {
            this.room.state = 'countdown';
            this.room.gameStartTime = message.startTime;
          }
          this.emit({ type: 'game-starting', data: { startTime: message.startTime } });
          break;

        case 'game-started':
          if (this.room) {
            this.room.state = 'playing';
          }
          this.emit({ type: 'game-started' });
          break;

        case 'player-state':
          if (this.room) {
            const player = this.room.players.find((p) => p.id === message.playerId);
            if (player) {
              player.health = message.health;
              player.combo = message.combo;
              player.score = message.score;
            }
          }
          this.emit({
            type: 'player-state',
            data: {
              playerId: message.playerId,
              health: message.health,
              combo: message.combo,
              score: message.score,
            },
          });
          break;

        case 'player-eliminated':
          if (this.room) {
            const player = this.room.players.find((p) => p.id === message.playerId);
            if (player) {
              player.isAlive = false;
              player.placement = message.placement;
            }
          }
          this.emit({
            type: 'player-eliminated',
            data: { playerId: message.playerId, placement: message.placement },
          });
          break;

        case 'attack-received':
          this.emit({ type: 'attack-received', data: message.attack });
          break;

        case 'game-ended':
          if (this.room) {
            this.room.state = 'results';
          }
          this.emit({ type: 'game-ended', data: message.finalPlacements });
          break;

        case 'host-navigation':
          this.emit({ type: 'host-navigation', data: message.navigation });
          break;

        case 'error':
          this.emit({ type: 'error', data: message.message });
          break;

        case 'pong':
          // Keep-alive response, no action needed
          break;

        default:
          console.warn('Unknown message type:', (message as { type: string }).type);
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  }

  // ============================================================================
  // Room Actions
  // ============================================================================

  /**
   * Create a new room
   */
  createRoom(playerName: string): void {
    this.playerName = playerName;
    this.send({ type: 'create-room', playerName });
  }

  /**
   * Join an existing room
   */
  joinRoom(roomCode: RoomCode, playerName: string): void {
    this.playerName = playerName;
    this.send({ type: 'join-room', roomCode, playerName });
  }

  /**
   * Leave current room
   */
  leaveRoom(): void {
    this.send({ type: 'leave-room' });
    this.room = null;
    this.playerId = null;
  }

  /**
   * Toggle ready status
   */
  toggleReady(): void {
    this.send({ type: 'toggle-ready' });
  }

  /**
   * Select song (host only)
   */
  selectSong(songId: string, difficulty: Difficulty): void {
    this.send({ type: 'select-song', songId, difficulty });
  }

  /**
   * Start the game (host only)
   */
  startGame(): void {
    this.send({ type: 'start-game' });
  }

  /**
   * Send host navigation state to sync with guests (host only)
   */
  sendHostNavigation(navigation: HostNavigationState): void {
    if (!this.isHost()) return;
    this.send({ type: 'host-navigation', navigation });
  }

  // ============================================================================
  // Gameplay Actions
  // ============================================================================

  /**
   * Update player state during gameplay
   */
  updateState(health: number, combo: number, score: number): void {
    this.send({ type: 'player-update', health, combo, score });
  }

  /**
   * Notify server of player death
   */
  notifyDeath(): void {
    this.send({ type: 'player-died' });
  }

  /**
   * Send attack to random opponent
   */
  sendAttack(direction: string, timeOffset: number): void {
    this.send({
      type: 'send-attack',
      attack: {
        direction: direction as 'left' | 'down' | 'up' | 'right',
        timeOffset,
      },
    });
  }

  /**
   * Notify server that game is finished
   */
  notifyGameFinished(score: number, placement: number): void {
    this.send({ type: 'game-finished', score, placement });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const multiplayerClient = new MultiplayerClient();

// ============================================================================
// Server Health Check
// ============================================================================

/**
 * Check if the multiplayer server is available
 */
export async function checkServerHealth(serverUrl?: string): Promise<boolean> {
  const url = serverUrl || DEFAULT_SERVER_URL.replace('ws://', 'http://').replace('wss://', 'https://');
  const healthUrl = `${url}/health`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      return data.status === 'ok';
    }

    return false;
  } catch {
    return false;
  }
}
