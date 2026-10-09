import { describe, it, expect } from 'vitest';
import { ATTACK_CONFIG } from '../../src/types/multiplayer';
import { ATTACK_COMBO_STEP, MAX_ATTACK_TIME_OFFSET, MIN_ATTACK_TIME_OFFSET } from '../../server/config.js';

describe('client/server attack contract', () => {
  it('uses the same combo step on both sides (otherwise every attack is rejected)', () => {
    expect(ATTACK_CONFIG.comboThreshold).toBe(ATTACK_COMBO_STEP);
  });

  it('sends time offsets the server accepts', () => {
    expect(ATTACK_CONFIG.minTimeOffset).toBeGreaterThanOrEqual(MIN_ATTACK_TIME_OFFSET);
    expect(ATTACK_CONFIG.minTimeOffset).toBeLessThan(ATTACK_CONFIG.maxTimeOffset);
    expect(ATTACK_CONFIG.maxTimeOffset).toBeLessThanOrEqual(MAX_ATTACK_TIME_OFFSET);
  });
});
