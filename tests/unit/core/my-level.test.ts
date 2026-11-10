import { describe, it, expect } from 'vitest';
import { chartPull, chartRisk, fitBreakModel, matchLevels, observations, runBreaks, type Observation } from '../../../src/core/my-level';
import type { PatternWindow } from '../../../src/core/patterns';
import type { ErrorMark } from '../../../src/types';

const windows = [
  { startMs: 0, notes: 64 },
  { startMs: 10_000, notes: 64 },
  { startMs: 20_000, notes: 70 },
];
const err = (time: number, kind: ErrorMark['kind'] = 'miss'): ErrorMark => ({ time, kind });

describe('runBreaks', () => {
  it('counts good, boo and miss in their window; N.G. and mines are not taps', () => {
    const errors = [err(0), err(500, 'good'), err(9999, 'boo'), err(10_000), err(15_000, 'ng'), err(25_000, 'mine')];
    expect(runBreaks(windows, errors, false)).toEqual([3, 1, 0]);
  });

  it('a cleared run with no error still says something: every window, zero breaks', () => {
    expect(runBreaks(windows, [], false)).toEqual([0, 0, 0]);
  });

  it('a failed run keeps the windows before the one it died in', () => {
    expect(runBreaks(windows, [err(3000), err(12_000), err(12_100), err(12_200)], true)).toEqual([1]);
    expect(runBreaks(windows, [err(3000), err(3100)], true)).toEqual([]);
  });

  it('never more breaks than notes (two errors can share a row time)', () => {
    const many = Array.from({ length: 80 }, (_, i) => err(i));
    expect(runBreaks(windows, many, false)[0]).toBe(64);
  });
});

const win = (f: number[], notes = 64, startMs = 0): PatternWindow => ({ startMs, notes, f });

describe('observations', () => {
  const chart = [win([1, 0]), win([2, 1]), win([3, 0], 70)];

  it('joins a run with the chart windows it went through', () => {
    expect(observations({ key: 'k', date: 1, steps: 198, breaks: [2, 5] }, chart)).toEqual([
      { f: [1, 0], notes: 64, breaks: 2 },
      { f: [2, 1], notes: 64, breaks: 5 },
    ]);
  });

  it('drops a run whose chart changed since', () => {
    expect(observations({ key: 'k', date: 1, steps: 200, breaks: [2, 5] }, chart)).toEqual([]);
    expect(observations({ key: 'k', date: 1, steps: 198, breaks: [1, 1, 1, 1] }, chart)).toEqual([]);
    expect(observations({ key: 'k', date: 1, steps: 198, breaks: [1] }, [])).toEqual([]);
  });
});

describe('fitBreakModel', () => {
  /** Windows whose break counts follow a known model exactly (expected counts, no noise) */
  const planted = (beta: number[]): Observation[] => {
    const obs: Observation[] = [];
    for (let a = 0; a <= 10; a += 2) {
      for (let b = 0; b <= 1; b += 0.25) {
        const p = 1 / (1 + Math.exp(-(beta[0]! + beta[1]! * a + beta[2]! * b)));
        obs.push({ f: [a, b], notes: 6400, breaks: Math.round(6400 * p) });
      }
    }
    return obs;
  };

  it('recovers the weights the data was made with', () => {
    const beta = fitBreakModel(planted([-5, 0.3, 1.5]))!;
    expect(beta[0]).toBeCloseTo(-5, 0);
    expect(beta[1]).toBeCloseTo(0.3, 1);
    expect(beta[2]).toBeCloseTo(1.5, 0);
  });

  it('has nothing to say without breaks, without clean notes, or without data', () => {
    expect(fitBreakModel([{ f: [1, 0], notes: 64, breaks: 0 }])).toBeNull();
    expect(fitBreakModel([{ f: [1, 0], notes: 64, breaks: 64 }])).toBeNull();
    expect(fitBreakModel([])).toBeNull();
  });
});

describe('chartRisk and chartPull', () => {
  const beta = [-4, 0.2, 2];

  it('rates the hardest quarter: one wall outweighs a long easy chart', () => {
    const easy = Array.from({ length: 8 }, () => win([2, 0]));
    const wall = [...easy.slice(0, 6), win([12, 1]), win([12, 1])];
    expect(chartRisk(beta, wall)).toBeGreaterThan(chartRisk(beta, easy) * 5);
    // Two windows out of eight are the quarter: the risk is the wall's alone
    expect(chartRisk(beta, wall)).toBeCloseTo(1 / (1 + Math.exp(-(-4 + 0.2 * 12 + 2))), 6);
  });

  it('a chart without notes carries no risk', () => {
    expect(chartRisk(beta, [])).toBe(0);
  });

  it('pull says which feature the hard part owes its risk to', () => {
    const [speed, chords] = chartPull(beta, [win([2, 0]), win([2, 0]), win([2, 0]), win([10, 1])]);
    expect(speed).toBeCloseTo(2, 6);
    expect(chords).toBeCloseTo(2, 6);
  });
});

describe('matchLevels', () => {
  it('hands out the original levels by rank of risk, spread within a level', () => {
    const mine = matchLevels([0.3, 0.1, 0.2, 0.4], [9, 9, 12, 10]);
    // Risk order: #1, #2, #0, #3 → levels 9, 9, 10, 12
    expect(mine[1]).toBeCloseTo(8.75, 6);
    expect(mine[2]).toBeCloseTo(9.25, 6);
    expect(mine[0]).toBeCloseTo(10, 6);
    expect(mine[3]).toBeCloseTo(12, 6);
  });

  it('keeps the distribution of the original scale', () => {
    const levels = [11, 11, 11, 11, 12, 12, 13, 5];
    const mine = matchLevels(levels.map((_, i) => (i * 7) % 8), levels);
    expect(mine.map(Math.round).sort((a, b) => a - b)).toEqual([...levels].sort((a, b) => a - b));
    expect(Math.min(...mine)).toBeGreaterThanOrEqual(4.5);
    expect(Math.max(...mine)).toBeLessThanOrEqual(13.5);
  });
});
