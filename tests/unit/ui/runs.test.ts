import { describe, it, expect, beforeEach } from 'vitest';
import { getRunBook, pastRuns, saveRunBook } from '../../../src/ui/storage';

describe('run log', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and not yet seeded from history', () => {
    expect(getRunBook()).toEqual({ seeded: false, runs: [] });
  });

  it('keeps runs oldest first, and only the latest 600', () => {
    const runs = Array.from({ length: 650 }, (_, i) => ({ key: `P/S${i}::Hard`, date: 1000 - i, steps: 100, breaks: [i] }));
    saveRunBook({ seeded: true, runs });
    const book = getRunBook();
    expect(book.seeded).toBe(true);
    expect(book.runs).toHaveLength(600);
    expect(book.runs[0]!.date).toBeLessThan(book.runs[1]!.date);
    expect(book.runs.at(-1)!.date).toBe(1000);
  });

  it('unreadable storage reads as an empty log', () => {
    localStorage.setItem('sm99.runs.v1', '{broken');
    expect(getRunBook()).toEqual({ seeded: false, runs: [] });
  });
});

describe('pastRuns', () => {
  beforeEach(() => localStorage.clear());

  it('a last run saved with the record was played to the end; any other may have failed', () => {
    localStorage.setItem(
      'sm99.scores.v2',
      JSON.stringify({ 'P/A::Hard': { grade: 'A', score: 1, date: 1000 }, 'P/B::Hard': { grade: 'A', score: 1, date: 1000 } })
    );
    localStorage.setItem(
      'sm99.lastrun.v1',
      JSON.stringify({
        'P/A::Hard': { errors: [{ time: 5, kind: 'miss' }], date: 999 },
        'P/B::Hard': { errors: [], date: 90_000 },
        'P/C::Hard': { errors: [], date: 1000 },
      })
    );
    expect(pastRuns()).toEqual([
      { key: 'P/A::Hard', date: 999, errors: [{ time: 5, kind: 'miss' }], cleared: true },
      { key: 'P/B::Hard', date: 90_000, errors: [], cleared: false },
      { key: 'P/C::Hard', date: 1000, errors: [], cleared: false },
    ]);
  });
});
