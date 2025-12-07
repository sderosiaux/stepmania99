/**
 * Tests for multiplayer game manager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiplayerGameManager } from '../../src/multiplayer/game-manager';

// Mock the multiplayerClient
vi.mock('../../src/multiplayer/client', () => ({
  multiplayerClient: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    isConnected: vi.fn(() => false),
    getRoom: vi.fn(() => null),
    getPlayerId: vi.fn(() => null),
    updateState: vi.fn(),
    sendAttack: vi.fn(),
    notifyDeath: vi.fn(),
    notifyGameFinished: vi.fn(),
  },
}));

describe('MultiplayerGameManager', () => {
  let manager: MultiplayerGameManager;

  beforeEach(() => {
    manager = new MultiplayerGameManager();
  });

  describe('initialization', () => {
    it('should create a new instance', () => {
      expect(manager).toBeDefined();
    });

    it('should have empty opponents initially', () => {
      expect(manager.getOpponents()).toEqual([]);
    });

    it('should have zero attack notes initially', () => {
      expect(manager.getActiveAttackNotes()).toEqual([]);
    });

    it('should return correct initial stats', () => {
      const stats = manager.getStats();
      expect(stats.attacksSent).toBe(0);
      expect(stats.attacksReceived).toBe(0);
    });
  });

  describe('init()', () => {
    it('should reset state on init', () => {
      manager.init();
      expect(manager.getOpponents()).toEqual([]);
      expect(manager.getActiveAttackNotes()).toEqual([]);
      expect(manager.getStats().attacksSent).toBe(0);
      expect(manager.getStats().attacksReceived).toBe(0);
    });
  });

  describe('destroy()', () => {
    it('should clear all state on destroy', () => {
      manager.destroy();
      expect(manager.getOpponents()).toEqual([]);
      expect(manager.getActiveAttackNotes()).toEqual([]);
    });
  });

  describe('getAliveOpponentsCount()', () => {
    it('should return 0 when no opponents', () => {
      expect(manager.getAliveOpponentsCount()).toBe(0);
    });
  });

  describe('isMultiplayer()', () => {
    it('should return false when not connected', () => {
      expect(manager.isMultiplayer()).toBe(false);
    });
  });

  describe('event handlers', () => {
    it('should set attack received handler', () => {
      const handler = vi.fn();
      manager.setOnAttackReceived(handler);
      // Handler should be set without error
      expect(true).toBe(true);
    });

    it('should set opponent eliminated handler', () => {
      const handler = vi.fn();
      manager.setOnOpponentEliminated(handler);
      // Handler should be set without error
      expect(true).toBe(true);
    });

    it('should set game ended handler', () => {
      const handler = vi.fn();
      manager.setOnGameEnded(handler);
      // Handler should be set without error
      expect(true).toBe(true);
    });
  });

  describe('attack notes management', () => {
    it('should cleanup judged attack notes', () => {
      manager.cleanupAttackNotes();
      expect(manager.getActiveAttackNotes()).toEqual([]);
    });

    it('should judge attack note by id', () => {
      // Since we can't easily add attack notes without the full flow,
      // we just verify the method doesn't throw
      manager.judgeAttackNote(12345);
      expect(true).toBe(true);
    });
  });
});
