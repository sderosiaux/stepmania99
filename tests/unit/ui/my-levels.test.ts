import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PATTERNS_VERSION, PATTERN_FEATURES, chartWindows, packWindows, type PatternWindow } from '../../../src/core/patterns';
import type { SongEntry } from '../../../src/core/manifest';
import type { Note, ResultsData } from '../../../src/types';
import { getRunBook, saveRunBook } from '../../../src/ui/storage';

// A library of 12 charts, all rated 11: six are plain streams, six are full of jacks
const JACK = PATTERN_FEATURES.indexOf('jack');
const SPEED = PATTERN_FEATURES.indexOf('speed');
const windowsOf = (jacks: number): PatternWindow[] =>
  [0, 1, 2, 3].map((i) => ({ startMs: i * 8000, notes: 64, f: PATTERN_FEATURES.map((_, q) => (q === JACK ? jacks : q === SPEED ? 8 : 0)) }));
const ids = Array.from({ length: 12 }, (_, i) => `P/${i < 6 ? 'Plain' : 'Jack'}${i}`);
const library = Object.fromEntries(ids.map((id, i) => [`${id}::Hard`, packWindows(windowsOf(i < 6 ? 0 : 6))]));
const entries = ids.map((id) => ({ id, charts: [{ difficulty: 'Hard', level: 11, steps: 256 }] })) as SongEntry[];

/** One cleared run per chart: this player breaks on jacks, not on streams */
const runs = (count: number) => ids.slice(0, count).map((id, i) => ({ key: `${id}::Hard`, date: i + 1, steps: 256, breaks: id.includes('Jack') ? [12, 14, 13, 15] : [1, 0, 1, 0] }));

const serve = (file: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => file })));

/** The module holds one instance for the app: each test gets its own */
const fresh = async () => {
  vi.resetModules();
  return (await import('../../../src/ui/my-levels')).myLevels;
};

beforeEach(() => {
  localStorage.clear();
  serve({ version: PATTERNS_VERSION, charts: library });
});

describe('personal levels', () => {
  it('rates what breaks this player above what does not, at equal original level', async () => {
    saveRunBook({ seeded: true, runs: runs(12) });
    const my = await fresh();
    await my.load(entries);
    expect(my.status).toEqual({ ready: true, runs: 12, runsNeeded: 10 });
    const plain = my.level('P/Plain0', 'Hard')!;
    const jack = my.level('P/Jack8', 'Hard')!;
    expect(jack).toBeGreaterThan(plain);
    // Still the original scale: every chart was an 11
    expect(plain).toBeGreaterThanOrEqual(10.5);
    expect(jack).toBeLessThanOrEqual(11.5);
  });

  it('stays silent until there are enough runs', async () => {
    saveRunBook({ seeded: true, runs: runs(12).slice(4) });
    const my = await fresh();
    await my.load(entries);
    expect(my.status).toEqual({ ready: false, runs: 8, runsNeeded: 10 });
    expect(my.level('P/Jack8', 'Hard')).toBeUndefined();
    expect(my.traits('P/Jack8', 'Hard')).toEqual([]);
  });

  it('ignores runs of charts that changed or left the library', async () => {
    saveRunBook({ seeded: true, runs: [...runs(12), { key: 'P/Gone::Hard', date: 99, steps: 256, breaks: [1] }, { key: 'P/Plain0::Hard', date: 100, steps: 300, breaks: [1] }] });
    const my = await fresh();
    await my.load(entries);
    expect(my.status.runs).toBe(12);
  });

  it('has no levels when the library carries no patterns', async () => {
    serve(null, false);
    saveRunBook({ seeded: true, runs: runs(12) });
    const my = await fresh();
    await my.load(entries);
    expect(my.status.ready).toBe(false);
  });

  it('starts from the last runs saved before the log existed, once', async () => {
    localStorage.setItem('sm99.scores.v2', JSON.stringify({ 'P/Jack8::Hard': { grade: 'A', score: 1, date: 500 } }));
    localStorage.setItem(
      'sm99.lastrun.v1',
      JSON.stringify({
        // The record run: cleared, all four windows
        'P/Jack8::Hard': { date: 500, errors: [{ time: 100, kind: 'miss' }, { time: 9000, kind: 'good' }] },
        // No record: counted up to the window of its last error
        'P/Plain0::Hard': { date: 400, errors: [{ time: 100, kind: 'miss' }, { time: 17_000, kind: 'miss' }] },
        'P/Unknown::Hard': { date: 300, errors: [] },
      })
    );
    const my = await fresh();
    await my.load(entries);
    expect(getRunBook()).toEqual({
      seeded: true,
      runs: [
        { key: 'P/Plain0::Hard', date: 400, steps: 256, breaks: [1, 0] },
        { key: 'P/Jack8::Hard', date: 500, steps: 256, breaks: [1, 1, 0, 0] },
      ],
    });
    localStorage.removeItem('sm99.lastrun.v1');
    await my.load(entries);
    expect(getRunBook().runs).toHaveLength(2);
  });

  it('waits for the patterns before seeding: history is not lost to a library without them', async () => {
    serve(null, false);
    localStorage.setItem('sm99.lastrun.v1', JSON.stringify({ 'P/Plain0::Hard': { date: 400, errors: [] } }));
    const my = await fresh();
    await my.load(entries);
    expect(getRunBook().seeded).toBe(false);
  });
});

describe('logging a run', () => {
  let id = 0;
  const notes: Note[] = Array.from({ length: 256 }, (_, i) => ({ id: id++, time: i * 125, beat: i / 4, lane: i % 4, direction: 'left', type: 'tap', quant: 16 }));
  const result = (over: Partial<ResultsData> = {}): ResultsData =>
    ({
      song: { id: 'P/Plain0' },
      chart: { difficulty: 'Hard', notes },
      errors: [{ time: 0, kind: 'miss' }, { time: 125 * 70, kind: 'good' }, { time: 125 * 71, kind: 'ng' }],
      failed: false,
      autoplay: false,
      rate: 1,
      handsRemoved: 0,
      ...over,
    }) as ResultsData;

  it('keeps the breaks per window of a run played alone and as written', async () => {
    const my = await fresh();
    await my.load(entries);
    my.record(result(), true);
    const { runs: logged } = getRunBook();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ key: 'P/Plain0::Hard', steps: 256, breaks: [1, 1, 0, 0] });
    expect(logged[0]!.breaks).toHaveLength(chartWindows(notes).length);
  });

  it('leaves out autoplay, other rates, removed hands, practice and battles', async () => {
    const my = await fresh();
    await my.load(entries);
    my.record(result({ autoplay: true }), true);
    my.record(result({ rate: 0.8 }), true);
    my.record(result({ handsRemoved: 3 }), true);
    my.record(result(), false);
    expect(getRunBook().runs).toEqual([]);
  });

  it('a run that died in its first window teaches nothing', async () => {
    const my = await fresh();
    await my.load(entries);
    my.record(result({ failed: true, errors: [{ time: 0, kind: 'miss' }, { time: 125, kind: 'miss' }] }), true);
    expect(getRunBook().runs).toEqual([]);
  });

  it('refits and tells whoever listens', async () => {
    saveRunBook({ seeded: true, runs: runs(12).slice(0, 9).concat(runs(12).slice(10)) });
    const my = await fresh();
    await my.load(entries);
    const heard = vi.fn();
    my.subscribe(heard);
    my.record(result({ song: { id: 'P/Jack9' } as ResultsData['song'], errors: Array.from({ length: 60 }, (_, i) => ({ time: i * 500, kind: 'miss' as const })) }), true);
    expect(heard).toHaveBeenCalled();
    expect(my.status.runs).toBe(12);
  });
});
