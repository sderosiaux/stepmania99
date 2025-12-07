/**
 * Tests for multiplayer types
 */

import { describe, it, expect } from 'vitest';
import type {
  Player,
  Room,
  AttackArrow,
  ClientMessage,
  ServerMessage,
  RoomState,
  ConnectionState,
} from '../../src/types/multiplayer';
import { ATTACK_CONFIG } from '../../src/types/multiplayer';

describe('Multiplayer Types', () => {
  describe('Player', () => {
    it('should have correct structure', () => {
      const player: Player = {
        id: 'player-123',
        name: 'TestPlayer',
        isHost: true,
        isReady: false,
        health: 100,
        combo: 0,
        score: 0,
        isAlive: true,
      };

      expect(player.id).toBe('player-123');
      expect(player.name).toBe('TestPlayer');
      expect(player.isHost).toBe(true);
      expect(player.isReady).toBe(false);
      expect(player.health).toBe(100);
      expect(player.combo).toBe(0);
      expect(player.score).toBe(0);
      expect(player.isAlive).toBe(true);
      expect(player.placement).toBeUndefined();
    });

    it('should support optional placement', () => {
      const eliminatedPlayer: Player = {
        id: 'player-456',
        name: 'Eliminated',
        isHost: false,
        isReady: true,
        health: 0,
        combo: 0,
        score: 50000,
        isAlive: false,
        placement: 3,
      };

      expect(eliminatedPlayer.isAlive).toBe(false);
      expect(eliminatedPlayer.placement).toBe(3);
    });
  });

  describe('Room', () => {
    it('should have correct structure', () => {
      const room: Room = {
        code: 'ABC123',
        players: [],
        state: 'waiting',
        maxPlayers: 8,
      };

      expect(room.code).toBe('ABC123');
      expect(room.players).toEqual([]);
      expect(room.state).toBe('waiting');
      expect(room.maxPlayers).toBe(8);
      expect(room.songId).toBeUndefined();
      expect(room.difficulty).toBeUndefined();
    });

    it('should support all room states', () => {
      const states: RoomState[] = ['waiting', 'countdown', 'playing', 'results'];
      states.forEach(state => {
        const room: Room = {
          code: 'TEST00',
          players: [],
          state,
          maxPlayers: 8,
        };
        expect(room.state).toBe(state);
      });
    });
  });

  describe('AttackArrow', () => {
    it('should have correct structure', () => {
      const attack: AttackArrow = {
        id: 'atk-001',
        direction: 'left',
        timeOffset: 1500,
        fromPlayerId: 'player-789',
        fromPlayerName: 'Attacker',
      };

      expect(attack.id).toBe('atk-001');
      expect(attack.direction).toBe('left');
      expect(attack.timeOffset).toBe(1500);
      expect(attack.fromPlayerId).toBe('player-789');
      expect(attack.fromPlayerName).toBe('Attacker');
    });

    it('should support all directions', () => {
      const directions = ['left', 'down', 'up', 'right'] as const;
      directions.forEach(direction => {
        const attack: AttackArrow = {
          id: 'atk-002',
          direction,
          timeOffset: 1000,
          fromPlayerId: 'p1',
          fromPlayerName: 'Test',
        };
        expect(attack.direction).toBe(direction);
      });
    });
  });

  describe('ATTACK_CONFIG', () => {
    it('should have correct default values', () => {
      expect(ATTACK_CONFIG.comboThreshold).toBe(10);
      expect(ATTACK_CONFIG.arrowsPerAttack).toBe(2);
      expect(ATTACK_CONFIG.minTimeOffset).toBeGreaterThan(0);
      expect(ATTACK_CONFIG.maxTimeOffset).toBeGreaterThan(ATTACK_CONFIG.minTimeOffset);
      expect(ATTACK_CONFIG.missedAttackDamage).toBeGreaterThan(0);
    });
  });

  describe('ClientMessage', () => {
    it('should support create-room message', () => {
      const msg: ClientMessage = {
        type: 'create-room',
        playerName: 'NewPlayer',
      };
      expect(msg.type).toBe('create-room');
      expect(msg.playerName).toBe('NewPlayer');
    });

    it('should support join-room message', () => {
      const msg: ClientMessage = {
        type: 'join-room',
        roomCode: 'ABC123',
        playerName: 'Joiner',
      };
      expect(msg.type).toBe('join-room');
    });

    it('should support player-update message', () => {
      const msg: ClientMessage = {
        type: 'player-update',
        health: 75,
        combo: 50,
        score: 250000,
      };
      expect(msg.type).toBe('player-update');
      expect(msg.health).toBe(75);
      expect(msg.combo).toBe(50);
      expect(msg.score).toBe(250000);
    });
  });

  describe('ServerMessage', () => {
    it('should support room-created message', () => {
      const room: Room = {
        code: 'XYZ789',
        players: [],
        state: 'waiting',
        maxPlayers: 8,
      };
      const msg: ServerMessage = {
        type: 'room-created',
        room,
        playerId: 'host-id',
      };
      expect(msg.type).toBe('room-created');
      expect(msg.room.code).toBe('XYZ789');
      expect(msg.playerId).toBe('host-id');
    });

    it('should support attack-received message', () => {
      const attack: AttackArrow = {
        id: 'atk-003',
        direction: 'up',
        timeOffset: 2000,
        fromPlayerId: 'enemy',
        fromPlayerName: 'Enemy',
      };
      const msg: ServerMessage = {
        type: 'attack-received',
        attack,
      };
      expect(msg.type).toBe('attack-received');
      expect(msg.attack.direction).toBe('up');
    });

    it('should support game-ended message', () => {
      const msg: ServerMessage = {
        type: 'game-ended',
        finalPlacements: [
          { playerId: 'p1', placement: 1, score: 900000 },
          { playerId: 'p2', placement: 2, score: 750000 },
        ],
      };
      expect(msg.type).toBe('game-ended');
      expect(msg.finalPlacements).toHaveLength(2);
      expect(msg.finalPlacements![0]!.placement).toBe(1);
    });
  });

  describe('ConnectionState', () => {
    it('should support all states', () => {
      const states: ConnectionState[] = ['disconnected', 'connecting', 'connected', 'error'];
      states.forEach(state => {
        expect(typeof state).toBe('string');
      });
    });
  });
});
