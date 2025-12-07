/**
 * Multiplayer Game Manager
 *
 * Handles multiplayer-specific game logic:
 * - Attack generation and receiving
 * - Opponent state tracking
 * - Server communication during gameplay
 */

import type { Direction, Note } from '../types';
import type { AttackArrow } from '../types/multiplayer';
import { multiplayerClient, type MultiplayerEvent } from './client';

// ============================================================================
// Types
// ============================================================================

export interface OpponentState {
  id: string;
  name: string;
  health: number;
  combo: number;
  score: number;
  isAlive: boolean;
  placement?: number;
}

export interface AttackNote extends Note {
  isAttack: true;
  fromPlayerName: string;
}

// ============================================================================
// Attack Configuration
// ============================================================================

const ATTACK_CONFIG = {
  /** Combo threshold to trigger attack */
  comboThreshold: 10,
  /** Number of arrows sent per attack */
  arrowsPerAttack: 2,
  /** Min time before attack arrow appears (ms) */
  minTimeOffset: 800,
  /** Max time before attack arrow appears (ms) */
  maxTimeOffset: 2500,
  /** Damage when attack arrow is missed */
  missedAttackDamage: 5,
} as const;

// ============================================================================
// Multiplayer Game Manager Class
// ============================================================================

export class MultiplayerGameManager {
  /** Current opponents (excluding self) */
  private opponents: Map<string, OpponentState> = new Map();

  /** Pending attack arrows to be injected */
  private pendingAttacks: AttackArrow[] = [];

  /** Active attack notes in the game */
  private activeAttackNotes: AttackNote[] = [];

  /** Last combo value (to detect combo milestones) */
  private lastCombo = 0;

  /** Attacks sent counter */
  private attacksSent = 0;

  /** Attacks received counter */
  private attacksReceived = 0;

  /** Update throttle */
  private lastUpdateTime = 0;
  private readonly UPDATE_INTERVAL = 100; // ms

  /** Event handlers */
  private onAttackReceived: ((attack: AttackNote) => void) | null = null;
  private onOpponentEliminated: ((playerId: string, placement: number) => void) | null = null;
  private onGameEnded: ((placements: Array<{ playerId: string; placement: number; score: number }>) => void) | null = null;

  constructor() {
    multiplayerClient.addEventListener(this.handleMultiplayerEvent.bind(this));
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Initialize for a new game
   */
  init(): void {
    this.opponents.clear();
    this.pendingAttacks = [];
    this.activeAttackNotes = [];
    this.lastCombo = 0;
    this.attacksSent = 0;
    this.attacksReceived = 0;
    this.lastUpdateTime = 0;

    // Populate opponents from room
    const room = multiplayerClient.getRoom();
    const localPlayerId = multiplayerClient.getPlayerId();

    if (room) {
      for (const player of room.players) {
        if (player.id !== localPlayerId) {
          this.opponents.set(player.id, {
            id: player.id,
            name: player.name,
            health: 100,
            combo: 0,
            score: 0,
            isAlive: true,
          });
        }
      }
    }
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.opponents.clear();
    this.pendingAttacks = [];
    this.activeAttackNotes = [];
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  setOnAttackReceived(handler: (attack: AttackNote) => void): void {
    this.onAttackReceived = handler;
  }

  setOnOpponentEliminated(handler: (playerId: string, placement: number) => void): void {
    this.onOpponentEliminated = handler;
  }

  setOnGameEnded(handler: (placements: Array<{ playerId: string; placement: number; score: number }>) => void): void {
    this.onGameEnded = handler;
  }

  // ============================================================================
  // Multiplayer Events
  // ============================================================================

  private handleMultiplayerEvent(event: MultiplayerEvent): void {
    switch (event.type) {
      case 'player-state': {
        const data = event.data as { playerId: string; health: number; combo: number; score: number };
        const opponent = this.opponents.get(data.playerId);
        if (opponent) {
          opponent.health = data.health;
          opponent.combo = data.combo;
          opponent.score = data.score;
        }
        break;
      }

      case 'player-eliminated': {
        const data = event.data as { playerId: string; placement: number };
        const opponent = this.opponents.get(data.playerId);
        if (opponent) {
          opponent.isAlive = false;
          opponent.placement = data.placement;
        }
        this.onOpponentEliminated?.(data.playerId, data.placement);
        break;
      }

      case 'attack-received': {
        const attack = event.data as AttackArrow;
        this.pendingAttacks.push(attack);
        this.attacksReceived++;
        break;
      }

      case 'game-ended': {
        const placements = event.data as Array<{ playerId: string; placement: number; score: number }>;
        this.onGameEnded?.(placements);
        break;
      }
    }
  }

  // ============================================================================
  // Game State Updates
  // ============================================================================

  /**
   * Update local player state and broadcast to server
   */
  update(health: number, combo: number, score: number, currentTime: number): void {
    // Check for attack trigger (every 10 combo)
    const comboMilestone = Math.floor(combo / ATTACK_CONFIG.comboThreshold);
    const lastMilestone = Math.floor(this.lastCombo / ATTACK_CONFIG.comboThreshold);

    if (comboMilestone > lastMilestone && combo >= ATTACK_CONFIG.comboThreshold) {
      this.triggerAttack();
    }

    this.lastCombo = combo;

    // Throttle updates to server
    const now = performance.now();
    if (now - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
      multiplayerClient.updateState(health, combo, score);
      this.lastUpdateTime = now;
    }

    // Process pending attacks
    this.processPendingAttacks(currentTime);
  }

  /**
   * Process pending attacks and create attack notes
   */
  private processPendingAttacks(currentTime: number): void {
    for (let i = this.pendingAttacks.length - 1; i >= 0; i--) {
      const attack = this.pendingAttacks[i]!;
      const targetTime = currentTime + attack.timeOffset;

      // Create attack note
      const attackNote: AttackNote = {
        id: Date.now() * 1000 + Math.random() * 1000, // Unique ID
        time: targetTime,
        direction: attack.direction,
        type: 'tap',
        judged: false,
        isAttack: true,
        fromPlayerName: attack.fromPlayerName,
      };

      this.activeAttackNotes.push(attackNote);
      this.onAttackReceived?.(attackNote);
      this.pendingAttacks.splice(i, 1);
    }
  }

  /**
   * Trigger an attack on random opponent
   */
  private triggerAttack(): void {
    const directions: Direction[] = ['left', 'down', 'up', 'right'];

    for (let i = 0; i < ATTACK_CONFIG.arrowsPerAttack; i++) {
      const direction = directions[Math.floor(Math.random() * directions.length)]!;
      const timeOffset = ATTACK_CONFIG.minTimeOffset +
        Math.random() * (ATTACK_CONFIG.maxTimeOffset - ATTACK_CONFIG.minTimeOffset);

      multiplayerClient.sendAttack(direction, timeOffset);
      this.attacksSent++;
    }
  }

  /**
   * Notify death
   */
  notifyDeath(): void {
    multiplayerClient.notifyDeath();
  }

  /**
   * Notify game finished
   */
  notifyGameFinished(score: number, placement: number): void {
    multiplayerClient.notifyGameFinished(score, placement);
  }

  // ============================================================================
  // Attack Notes Management
  // ============================================================================

  /**
   * Get active attack notes
   */
  getActiveAttackNotes(): AttackNote[] {
    return this.activeAttackNotes;
  }

  /**
   * Remove judged attack notes
   */
  cleanupAttackNotes(): void {
    this.activeAttackNotes = this.activeAttackNotes.filter(n => !n.judged);
  }

  /**
   * Mark attack note as judged
   */
  judgeAttackNote(noteId: number): void {
    const note = this.activeAttackNotes.find(n => n.id === noteId);
    if (note) {
      note.judged = true;
    }
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /**
   * Get all opponents
   */
  getOpponents(): OpponentState[] {
    return Array.from(this.opponents.values());
  }

  /**
   * Get alive opponents count
   */
  getAliveOpponentsCount(): number {
    return Array.from(this.opponents.values()).filter(o => o.isAlive).length;
  }

  /**
   * Get stats
   */
  getStats(): { attacksSent: number; attacksReceived: number } {
    return {
      attacksSent: this.attacksSent,
      attacksReceived: this.attacksReceived,
    };
  }

  /**
   * Check if in multiplayer mode
   */
  isMultiplayer(): boolean {
    return multiplayerClient.isConnected() && multiplayerClient.getRoom() !== null;
  }
}

// Singleton instance
export const multiplayerGameManager = new MultiplayerGameManager();
