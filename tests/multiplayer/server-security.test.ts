/**
 * Server security rules, tested against the real server modules (not copies).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  safeJsonParse,
  validateAttackData,
  validatePlayerName,
  validateRoomCode,
  sanitizeSongId,
  validateNavigation,
} from '../../server/validation.js';
import {
  initPlayerTracking,
  updateTracking,
  validatePlayerStateUpdate,
  correctInvalidValues,
  checkSequence,
  cleanupPlayerTracking,
} from '../../server/anti-cheat.js';
import { checkRateLimit, cleanupRateLimiter } from '../../server/rate-limiter.js';
import { ALLOWED_ORIGINS, RATE_LIMITS } from '../../server/config.js';

/** The server's JSDoc types describe valid input; these tests feed it invalid input on purpose */
const loose = <F extends (...args: never[]) => unknown>(f: F) => f as unknown as (...args: unknown[]) => ReturnType<F>;
const attack = loose(validateAttackData);
const playerName = loose(validatePlayerName);
const roomCode = loose(validateRoomCode);
const rateLimit = loose(checkRateLimit);

describe('safeJsonParse', () => {
  it('parses normal JSON', () => {
    expect(safeJsonParse('{"name": "test", "value": [1, {"a": 1}]}')).toEqual({ name: 'test', value: [1, { a: 1 }] });
  });

  it('strips prototype-pollution keys, nested ones included', () => {
    const r = safeJsonParse('{"__proto__": {"isAdmin": true}, "constructor": {}, "data": {"prototype": 1}, "name": "x"}') as Record<string, unknown>;
    expect(r.name).toBe('x');
    for (const k of ['__proto__', 'constructor']) expect(Object.prototype.hasOwnProperty.call(r, k)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r.data, 'prototype')).toBe(false);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it('throws on invalid JSON', () => {
    expect(() => safeJsonParse('{')).toThrow();
  });
});

describe('validateAttackData', () => {
  it('accepts the four lanes within the readable delay range', () => {
    for (const direction of ['left', 'down', 'up', 'right']) expect(validateAttackData({ direction, timeOffset: 1200 }).valid).toBe(true);
    expect(validateAttackData({ direction: 'left', timeOffset: 800 }).valid).toBe(true);
    expect(validateAttackData({ direction: 'left', timeOffset: 5000 }).valid).toBe(true);
  });

  it('rejects unknown directions and non-objects', () => {
    expect(validateAttackData({ direction: 'diagonal', timeOffset: 1000 }).valid).toBe(false);
    expect(validateAttackData({ direction: 'LEFT', timeOffset: 1000 }).valid).toBe(false);
    expect(validateAttackData({ timeOffset: 1000 }).valid).toBe(false);
    expect(attack(null).valid).toBe(false);
  });

  it('rejects arrows that arrive too soon to be read, or too late', () => {
    expect(validateAttackData({ direction: 'left', timeOffset: 799 }).valid).toBe(false);
    expect(validateAttackData({ direction: 'left', timeOffset: -1 }).valid).toBe(false);
    expect(validateAttackData({ direction: 'left', timeOffset: 5001 }).valid).toBe(false);
    expect(validateAttackData({ direction: 'left', timeOffset: '900' }).valid).toBe(false);
  });
});

describe('anti-cheat state updates', () => {
  const id = 'p-test';
  afterEach(() => cleanupPlayerTracking(id));
  const track = (health: number, combo: number, score: number) => {
    initPlayerTracking(id);
    updateTracking(id, health, combo, score);
  };

  it('accepts plausible changes', () => {
    track(100, 50, 100000);
    expect(validatePlayerStateUpdate(id, 90, 70, 150000).valid).toBe(true);
    expect(validatePlayerStateUpdate(id, 105, 0, 100000).valid).toBe(true);
  });

  it('flags jumps in health, combo and score, and score going down', () => {
    track(50, 50, 100000);
    expect(validatePlayerStateUpdate(id, 100, 50, 100000).valid).toBe(false);
    expect(validatePlayerStateUpdate(id, 50, 100, 100000).valid).toBe(false);
    expect(validatePlayerStateUpdate(id, 50, 50, 99999).valid).toBe(false);
    expect(validatePlayerStateUpdate(id, 50, 50, 200000).valid).toBe(false);
  });

  it('caps a suspicious combo instead of freezing it at the old value', () => {
    track(100, 0, 0);
    // Freezing at 0 would block every attack until the next combo break
    expect(correctInvalidValues(id, 100, 21, 0).combo).toBe(20);
  });

  it('drops duplicate and out-of-order sequence numbers, allows gaps', () => {
    initPlayerTracking(id);
    expect(checkSequence(id, 1)).toBe(true);
    expect(checkSequence(id, 5)).toBe(true);
    expect(checkSequence(id, 5)).toBe(false);
    expect(checkSequence(id, 3)).toBe(false);
    expect(checkSequence(id, 100)).toBe(true);
  });
});

describe('validatePlayerName', () => {
  it('accepts and trims normal names', () => {
    expect(validatePlayerName('  Player 1  ')).toEqual({ valid: true, value: 'Player 1' });
    expect(validatePlayerName('user-name_2').valid).toBe(true);
  });

  it('rejects markup, empty and non-string names', () => {
    expect(validatePlayerName('<script>alert(1)</script>').valid).toBe(false);
    for (const bad of ['', '   ', null, undefined, 123, {}]) expect(playerName(bad).valid).toBe(false);
  });

  it('truncates long names to 30 characters', () => {
    expect(validatePlayerName('a'.repeat(50)).value).toHaveLength(30);
  });
});

describe('validateRoomCode', () => {
  it('accepts 8 alphanumerics, uppercased', () => {
    expect(validateRoomCode('abcd1234')).toEqual({ valid: true, value: 'ABCD1234' });
  });

  it('rejects wrong length, symbols and non-strings', () => {
    for (const bad of ['ABC', 'ABCDEFGH9', 'ABCD-123', 'ABCD 123', null, 12345678]) expect(roomCode(bad).valid).toBe(false);
  });
});

describe('sanitizeSongId', () => {
  it('keeps pack/folder ids verbatim, long ones and symbols included', () => {
    expect(sanitizeSongId('Virtual Test Lab/Crossover Challenge')).toBe('Virtual Test Lab/Crossover Challenge');
    expect(sanitizeSongId('Pack/Love <3')).toBe('Pack/Love <3');
    expect(sanitizeSongId('a'.repeat(200))).toHaveLength(200);
  });

  it('rejects non-strings, empty, padded, control characters and oversized ids', () => {
    for (const bad of [{}, '', '   ', ' padded ', 'a\u0000b', 'a'.repeat(201)]) expect(sanitizeSongId(bad)).toBeNull();
  });

  it('is what host navigation stores', () => {
    expect(validateNavigation({ packIndex: 0, songIndex: 3, songId: 'Pack/Song <3', difficulty: 'Hard' })).toEqual({
      valid: true,
      value: { packIndex: 0, songIndex: 3, songId: 'Pack/Song <3', difficulty: 'Hard' },
    });
    expect(validateNavigation({ packIndex: 0, songIndex: 0, songId: 42 }).valid).toBe(false);
  });
});

describe('checkRateLimit', () => {
  afterEach(() => vi.useRealTimers());

  it('allows up to the configured burst, then blocks until the window resets', () => {
    vi.useFakeTimers();
    const ws = {};
    const { max, windowMs } = RATE_LIMITS['send-attack']!;
    for (let i = 0; i < max; i++) expect(rateLimit(ws, 'send-attack')).toBe(true);
    expect(rateLimit(ws, 'send-attack')).toBe(false);
    vi.advanceTimersByTime(windowMs + 1);
    expect(rateLimit(ws, 'send-attack')).toBe(true);
    loose(cleanupRateLimiter)(ws);
  });

  it('limits each client separately', () => {
    const a = {};
    const b = {};
    expect(rateLimit(a, 'create-room')).toBe(true);
    expect(rateLimit(a, 'create-room')).toBe(false);
    expect(rateLimit(b, 'create-room')).toBe(true);
  });
});

describe('ALLOWED_ORIGINS', () => {
  it('whitelists local dev origins only', () => {
    expect(ALLOWED_ORIGINS.has('http://localhost:5173')).toBe(true);
    expect(ALLOWED_ORIGINS.has('http://malicious.com')).toBe(false);
    expect(ALLOWED_ORIGINS.has('https://localhost:3000')).toBe(false);
  });
});
