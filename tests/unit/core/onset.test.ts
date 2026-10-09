import { describe, it, expect } from 'vitest';
import { onsetSeconds } from '../../../src/audio';

const buffer = (samples: number[], sampleRate = 1000) =>
  ({ length: samples.length, sampleRate, numberOfChannels: 1, getChannelData: () => Float32Array.from(samples) }) as unknown as AudioBuffer;

describe('onsetSeconds', () => {
  it('skips decoder padding before the attack', () => {
    expect(onsetSeconds(buffer([0, 0, 0.001, 0, 0.5, 0.2]))).toBeCloseTo(0.004);
  });

  it('never skips more than 30 ms (quiet intros are content)', () => {
    expect(onsetSeconds(buffer([...new Array(100).fill(0), 0.5]))).toBe(0.03);
  });

  it('returns 0 for silence', () => {
    expect(onsetSeconds(buffer([0, 0, 0]))).toBe(0);
  });
});
