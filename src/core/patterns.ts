import type { Note } from '../types';

// ============================================================================
// What a chart asks of the hands, in windows of ~64 notes: the input of the
// personal level (my-level.ts). Lanes 0-1 are one hand and lanes 2-3 the other,
// as on S D / K L: a jack is one finger, a hold pins the hand's other finger.
// ============================================================================

/** Bump when a feature or the windowing changes: packed windows of another version are not comparable */
export const PATTERNS_VERSION = 1;

export const PATTERN_FEATURES = ['speed', 'jack', 'jump', 'hand', 'hold', 'stamina', 'rhythm'] as const;
export type PatternFeature = (typeof PATTERN_FEATURES)[number];

export interface PatternWindow {
  /** Song ms of the window's first row */
  startMs: number;
  notes: number;
  /**
   * Means over the window's notes, in PATTERN_FEATURES order:
   * speed (rows/s), jack (same-lane repeats/s), jump and hand (share of notes in 2 / 3+ rows),
   * hold (share hit while the hand's other finger holds), stamina (notes/s over the 10 s before),
   * rhythm (share of notes whose row interval differs from the previous one).
   */
  f: number[];
}

/** Every chart of a library, packed, by `songId::difficulty` */
export interface PatternsFile {
  version: number;
  charts: Record<string, number[]>;
}

const WINDOW_NOTES = 64;
/** A shorter tail joins the window before it: too few notes to say anything alone */
const MIN_TAIL_NOTES = 32;
const STAMINA_SPAN_MS = 10_000;
/** A gap this long is a rest, not a slow pattern */
const REST_MS = 1000;
const MAX_PER_SEC = 30;
/** Row intervals differing by more than ~22% (4ths to 8ths, 16ths to 24ths…) */
const RHYTHM_CHANGE = 0.2;

const perSec = (dtMs: number): number => (dtMs > REST_MS ? 0 : Math.min(MAX_PER_SEC, 1000 / dtMs));

export function chartWindows(notes: readonly Note[]): PatternWindow[] {
  const steps = notes.filter((n) => n.type !== 'mine');
  const lastOnLane = [-Infinity, -Infinity, -Infinity, -Infinity];
  const holdEnd = [-Infinity, -Infinity, -Infinity, -Infinity];
  const windows: PatternWindow[] = [];
  let cur: PatternWindow | null = null;
  let prevRow = -Infinity;
  let prevInterval = Infinity;
  let tail = 0;
  for (let i = 0; i < steps.length; ) {
    const t = steps[i]!.time;
    let j = i;
    while (j < steps.length && steps[j]!.time === t) j++;
    // Rows are never split: a jump belongs to one window
    if (!cur || cur.notes >= WINDOW_NOTES) {
      cur = { startMs: t, notes: 0, f: PATTERN_FEATURES.map(() => 0) };
      windows.push(cur);
    }
    while (steps[tail]!.time < t - STAMINA_SPAN_MS) tail++;
    const size = j - i;
    const interval = t - prevRow;
    // Coming out of a rest is a start, not a change
    const rhythm = prevInterval <= REST_MS && interval <= REST_MS && Math.abs(Math.log(interval / prevInterval)) > RHYTHM_CHANGE ? 1 : 0;
    const row = [perSec(interval), 0, size === 2 ? 1 : 0, size >= 3 ? 1 : 0, 0, (i - tail) / (STAMINA_SPAN_MS / 1000), rhythm];
    for (let k = i; k < j; k++) {
      const lane = steps[k]!.lane;
      row[1] = perSec(t - lastOnLane[lane]!);
      row[4] = holdEnd[lane ^ 1]! > t ? 1 : 0;
      for (let q = 0; q < row.length; q++) cur.f[q]! += row[q]!;
      cur.notes++;
    }
    for (let k = i; k < j; k++) {
      const n = steps[k]!;
      lastOnLane[n.lane] = t;
      if (n.endTime !== undefined) holdEnd[n.lane] = n.endTime;
    }
    prevInterval = interval;
    prevRow = t;
    i = j;
  }
  const last = windows[windows.length - 1];
  const before = windows[windows.length - 2];
  if (last && before && last.notes < MIN_TAIL_NOTES) {
    before.f = before.f.map((v, q) => v + last.f[q]!);
    before.notes += last.notes;
    windows.pop();
  }
  for (const w of windows) w.f = w.f.map((v) => v / w.notes);
  return windows;
}

// Per window: start ms, notes, then the features as integers (rates ×100, shares ×1000)
const SCALE = [100, 100, 1000, 1000, 1000, 100, 1000];
const STRIDE = 2 + SCALE.length;

export function packWindows(windows: readonly PatternWindow[]): number[] {
  // The start is floored so that the window's first row still falls inside it
  return windows.flatMap((w) => [Math.floor(w.startMs), w.notes, ...w.f.map((v, q) => Math.round(v * SCALE[q]!))]);
}

export function unpackWindows(packed: readonly number[]): PatternWindow[] {
  const windows: PatternWindow[] = [];
  for (let i = 0; i + STRIDE <= packed.length; i += STRIDE) {
    windows.push({ startMs: packed[i]!, notes: packed[i + 1]!, f: SCALE.map((s, q) => packed[i + 2 + q]! / s) });
  }
  return windows;
}
