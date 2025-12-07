/**
 * Stepmania99 Multiplayer Module
 *
 * Re-exports all multiplayer functionality.
 */

export { MultiplayerClient, multiplayerClient, checkServerHealth } from './client';
export type { MultiplayerEvent, MultiplayerEventType, MultiplayerEventHandler } from './client';

export { MultiplayerGameManager, multiplayerGameManager } from './game-manager';
export type { OpponentState, AttackNote } from './game-manager';
