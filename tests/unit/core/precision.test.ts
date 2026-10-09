import { describe, it, expect } from 'vitest';
import { expectedWithin, sdForShare, breakdown, coach, groupStats } from '../../../src/ui/precision';
import type { HitSample } from '../../../src/types';

const hit = (offset: number, extra: Partial<HitSample> = {}): HitSample => ({ offset, quant: 4, jump: false, lane: 0, ...extra });

describe('precision model', () => {
  it('matches the normal distribution', () => {
    // ±1σ ≈ 68.3%, ±1.645σ ≈ 90%
    expect(expectedWithin(0, 22.5)).toBeCloseTo(0.6827, 3);
    expect(expectedWithin(0, 22.5 / 1.6449)).toBeCloseTo(0.9, 3);
    expect(sdForShare(0.9)).toBeCloseTo(13.68, 1);
  });

  it('an offset costs Marvelous at the same spread', () => {
    expect(expectedWithin(15, 12)).toBeLessThan(expectedWithin(0, 12));
  });

  it('groups hits by context and drops tiny groups', () => {
    const hits = [...Array(10)].map((_, i) => hit(i % 2 ? 5 : -5)).concat([...Array(3)].map(() => hit(30, { jump: true })));
    const g = breakdown(hits);
    expect(g.map((x) => x.label)).toEqual(['Singles', '4ths']);
    expect(groupStats('x', hits.slice(0, 10))).toMatchObject({ n: 10, mean: 0, sd: 5, marvelous: 1 });
  });

  it('points at the context that drifts', () => {
    const hits = [...Array(60)].map((_, i) => hit(((i % 5) - 2) * 6)).concat([...Array(20)].map((_, i) => hit(18 + (i % 3), { jump: true })));
    const lines = coach(hits);
    expect(lines[0]).toMatch(/σ/);
    expect(lines.some((l) => l.startsWith('Jumps land') && l.includes('later'))).toBe(true);
  });
});
