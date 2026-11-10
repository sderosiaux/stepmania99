import { describe, it, expect } from 'vitest';
import { chartWindows, packWindows, unpackWindows, PATTERN_FEATURES } from '../../../src/core/patterns';
import type { Note } from '../../../src/types';

let id = 0;
const note = (time: number, lane: number, extra: Partial<Note> = {}): Note => ({
  id: id++,
  time,
  beat: time / 500,
  lane,
  direction: (['left', 'down', 'up', 'right'] as const)[lane]!,
  type: 'tap',
  quant: 16,
  ...extra,
});
const feature = (w: { f: number[] }, name: (typeof PATTERN_FEATURES)[number]) => w.f[PATTERN_FEATURES.indexOf(name)]!;

/** `count` single notes every `gapMs`, on the lanes `pick` chooses */
const stream = (count: number, gapMs: number, pick: (i: number) => number, from = 0): Note[] => Array.from({ length: count }, (_, i) => note(from + i * gapMs, pick(i)));

describe('chartWindows', () => {
  it('cuts a chart in windows of 64 notes and folds a short tail into the last one', () => {
    expect(chartWindows(stream(64 * 3, 100, (i) => i % 4)).map((w) => w.notes)).toEqual([64, 64, 64]);
    expect(chartWindows(stream(64 * 2 + 10, 100, (i) => i % 4)).map((w) => w.notes)).toEqual([64, 74]);
    expect(chartWindows(stream(64 + 40, 100, (i) => i % 4)).map((w) => w.notes)).toEqual([64, 40]);
  });

  it('never splits a row: a jump on the boundary stays whole', () => {
    const notes = [...stream(63, 100, (i) => i % 4), note(6300, 0), note(6300, 3), ...stream(70, 100, (i) => i % 4, 6400)];
    const windows = chartWindows(notes);
    expect(windows[0]!.notes).toBe(65);
    expect(windows[1]!.startMs).toBe(6400);
  });

  it('leaves mines out', () => {
    const notes = [...stream(64, 100, (i) => i % 4), note(50, 2, { type: 'mine' })].sort((a, b) => a.time - b.time);
    expect(chartWindows(notes).map((w) => w.notes)).toEqual([64]);
  });

  it('speed is rows per second; a rest longer than a second is not a slow pattern', () => {
    const [w] = chartWindows(stream(64, 100, (i) => i % 4));
    // 63 notes at 10 rows/s, the first has nothing before it
    expect(feature(w!, 'speed')).toBeCloseTo((63 * 10) / 64, 5);
    expect(feature(chartWindows(stream(64, 1500, (i) => i % 4))[0]!, 'speed')).toBe(0);
  });

  it('a jack is the same lane again: an alternating trill has none', () => {
    expect(feature(chartWindows(stream(64, 125, () => 0))[0]!, 'jack')).toBeCloseTo((63 * 8) / 64, 5);
    // Lanes 0 and 2 alternate: each lane repeats every 250 ms
    expect(feature(chartWindows(stream(64, 125, (i) => (i % 2) * 2))[0]!, 'jack')).toBeCloseTo((62 * 4) / 64, 5);
  });

  it('counts the share of notes in jumps and in hands', () => {
    const rows = Array.from({ length: 32 }, (_, i) => (i % 2 ? [note(i * 200, 0), note(i * 200, 3)] : [note(i * 200, 0), note(i * 200, 1), note(i * 200, 2)])).flat();
    const [w] = chartWindows(rows);
    expect(feature(w!, 'jump')).toBeCloseTo(32 / 80, 5);
    expect(feature(w!, 'hand')).toBeCloseTo(48 / 80, 5);
  });

  it('a hold weighs on the other finger of its hand only', () => {
    const hold = note(0, 0, { type: 'hold', endTime: 10_000 });
    const sameHand = chartWindows([hold, ...stream(63, 100, () => 1, 100)]);
    const otherHand = chartWindows([hold, ...stream(63, 100, () => 2, 100)]);
    expect(feature(sameHand[0]!, 'hold')).toBeCloseTo(63 / 64, 5);
    expect(feature(otherHand[0]!, 'hold')).toBe(0);
  });

  it('stamina is the density of the 10 s before', () => {
    const windows = chartWindows(stream(64 * 4, 100, (i) => i % 4));
    expect(feature(windows[0]!, 'stamina')).toBeLessThan(feature(windows[3]!, 'stamina'));
    // After 10 s at 10 notes/s the load is 10 notes/s
    expect(feature(windows[3]!, 'stamina')).toBeCloseTo(10, 0);
  });

  it('rhythm marks the notes whose interval differs from the one before', () => {
    expect(feature(chartWindows(stream(64, 100, (i) => i % 4))[0]!, 'rhythm')).toBe(0);
    // 100, 200, 100, 200 ms…: every interval differs from the previous one
    const gallop = Array.from({ length: 64 }, (_, i) => note(Math.floor(i / 2) * 300 + (i % 2) * 100, i % 4));
    expect(feature(chartWindows(gallop)[0]!, 'rhythm')).toBeCloseTo(62 / 64, 5);
  });

  it('survives packing: integers out, the same windows back within rounding', () => {
    const windows = chartWindows([...stream(100, 87, (i) => (i * 3) % 4, 1234.56), note(9000, 1), note(9000, 2)]);
    const packed = packWindows(windows);
    expect(packed.every(Number.isInteger)).toBe(true);
    const back = unpackWindows(packed);
    expect(back.map((w) => w.notes)).toEqual(windows.map((w) => w.notes));
    expect(back[0]!.startMs).toBe(1234);
    back.forEach((w, i) => w.f.forEach((v, q) => expect(v).toBeCloseTo(windows[i]!.f[q]!, 2)));
  });
});
