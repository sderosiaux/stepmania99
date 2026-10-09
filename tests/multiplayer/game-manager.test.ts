/**
 * Tests for multiplayer game manager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiplayerGameManager, type AttackNote } from '../../src/multiplayer/game-manager';
import { multiplayerClient } from '../../src/multiplayer/client';
import type { MultiplayerEvent } from '../../src/multiplayer/client';

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
      expect(manager.getStats().attacksSent).toBe(0);
      expect(manager.getStats().attacksReceived).toBe(0);
    });
  });

  describe('destroy()', () => {
    it('should clear all state on destroy', () => {
      manager.destroy();
      expect(manager.getOpponents()).toEqual([]);
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

  describe('attacks', () => {
    const emit = (event: MultiplayerEvent) => {
      const calls = vi.mocked(multiplayerClient.addEventListener).mock.calls;
      calls[calls.length - 1]![0](event);
    };

    it('turns a received attack into a lane note ahead of the current song time', () => {
      const received: AttackNote[] = [];
      manager.setOnAttackReceived((a) => received.push(a));
      emit({ type: 'attack-received', data: { direction: 'up', timeOffset: 1500, fromPlayerName: 'Rival' } });
      manager.update(50, 0, 0, 10_000);
      expect(received).toHaveLength(1);
      expect(received[0]!.fromPlayerName).toBe('Rival');
      expect(received[0]!.note).toMatchObject({ lane: 2, direction: 'up', type: 'tap', time: 11_500 });
      expect(received[0]!.note.id).toBeLessThan(0);
      manager.update(50, 0, 0, 10_100);
      expect(received).toHaveLength(1);
    });

    it('sends one attack per 15 combo, after flushing the combo to the server', () => {
      vi.mocked(multiplayerClient.sendAttack).mockClear();
      vi.mocked(multiplayerClient.updateState).mockClear();
      manager.update(50, 14, 0, 0);
      expect(multiplayerClient.sendAttack).not.toHaveBeenCalled();
      manager.update(50, 15, 0, 0);
      expect(multiplayerClient.sendAttack).toHaveBeenCalledTimes(1);
      const stateOrder = vi.mocked(multiplayerClient.updateState).mock.invocationCallOrder.at(-1)!;
      expect(stateOrder).toBeLessThan(vi.mocked(multiplayerClient.sendAttack).mock.invocationCallOrder[0]!);
      expect(vi.mocked(multiplayerClient.updateState).mock.calls.at(-1)).toEqual([50, 15, 0]);
    });
  });
});
