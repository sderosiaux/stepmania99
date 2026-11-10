import type { ErrorMark } from '../types';
import type { PatternWindow } from './patterns';

// ============================================================================
// The personal level: a second scale next to the chart's own level.
//
// Each run says, window by window, how many notes broke the combo (good, boo,
// miss). A logistic model learns the break rate from the window's patterns, so
// it knows which patterns cost this player. A chart's risk is the predicted
// rate over its hardest quarter; risks are then ranked across the library and
// read on the original levels' distribution, so "12" keeps its usual weight.
// ============================================================================

/** One run, as kept for learning: breaks per window, for the windows fully attempted */
export interface RunLog {
  /** `songId::difficulty` */
  key: string;
  date: number;
  /** Steps of the chart when it was played: a simfile edited since no longer lines up */
  steps: number;
  breaks: number[];
}

export interface Observation {
  f: readonly number[];
  notes: number;
  breaks: number;
}

/** Below this the fit follows a handful of songs more than the player */
export const MIN_RUNS = 10;
export const MIN_BREAKS = 150;

/** The share of a chart's windows, hardest first, that makes its level: the wall, not the average */
const HARDEST_SHARE = 0.25;
const RIDGE = 1;

const isBreak = (e: ErrorMark): boolean => e.kind === 'miss' || e.kind === 'boo' || e.kind === 'good';

/**
 * Breaks per window. A failed run stops at its last error: the window it died in is left out with
 * everything after it, since the notes there were not all played and the last ones were a collapse.
 */
export function runBreaks(windows: readonly Pick<PatternWindow, 'startMs' | 'notes'>[], errors: readonly ErrorMark[], failed: boolean): number[] {
  const indexOf = (time: number): number => {
    let i = windows.length - 1;
    while (i > 0 && windows[i]!.startMs > time) i--;
    return i;
  };
  const attempted = failed ? (errors.length ? indexOf(Math.max(...errors.map((e) => e.time))) : 0) : windows.length;
  const breaks = new Array<number>(attempted).fill(0);
  for (const e of errors) {
    const i = indexOf(e.time);
    if (isBreak(e) && i < attempted) breaks[i] = Math.min(windows[i]!.notes, breaks[i]! + 1);
  }
  return breaks;
}

/** A run's windows joined with the chart's patterns; nothing when the chart changed since */
export function observations(run: RunLog, windows: readonly PatternWindow[]): Observation[] {
  if (windows.reduce((n, w) => n + w.notes, 0) !== run.steps || run.breaks.length > windows.length) return [];
  return run.breaks.map((breaks, i) => ({ f: windows[i]!.f, notes: windows[i]!.notes, breaks }));
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const score = (beta: readonly number[], f: readonly number[]): number => f.reduce((z, v, k) => z + v * beta[k + 1]!, beta[0]!);

/** Solve A·x = b by Gauss-Jordan with partial pivoting; null when singular */
function solve(A: number[][], b: number[]): number[] | null {
  const d = b.length;
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < d; c++) {
    let p = c;
    for (let r = c + 1; r < d; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-12) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < d; r++) {
      if (r === c) continue;
      const k = m[r]![c]! / m[c]![c]!;
      for (let q = c; q <= d; q++) m[r]![q]! -= k * m[c]![q]!;
    }
  }
  return m.map((row, i) => row[d]! / row[i]!);
}

/**
 * Binomial logistic regression (Newton steps, ridge on everything but the intercept):
 * break rate of a window from its pattern features. Returns [intercept, ...weights], or null
 * when the data cannot carry a fit (no breaks, no notes, no convergence).
 */
export function fitBreakModel(obs: readonly Observation[]): number[] | null {
  const d = (obs[0]?.f.length ?? 0) + 1;
  const notes = obs.reduce((n, o) => n + o.notes, 0);
  const breaks = obs.reduce((n, o) => n + o.breaks, 0);
  if (d === 1 || breaks === 0 || breaks === notes) return null;
  let beta = new Array<number>(d).fill(0);
  beta[0] = Math.log(breaks / (notes - breaks));
  for (let it = 0; it < 50; it++) {
    const grad = new Array<number>(d).fill(0);
    const hess = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (const o of obs) {
      const x = [1, ...o.f];
      const p = sigmoid(score(beta, o.f));
      const w = o.notes * p * (1 - p);
      for (let k = 0; k < d; k++) {
        grad[k]! += (o.breaks - o.notes * p) * x[k]!;
        for (let q = 0; q < d; q++) hess[k]![q]! += w * x[k]! * x[q]!;
      }
    }
    for (let k = 1; k < d; k++) {
      grad[k]! -= RIDGE * beta[k]!;
      hess[k]![k]! += RIDGE;
    }
    const step = solve(hess, grad);
    if (!step || step.some((s) => !Number.isFinite(s))) return null;
    beta = beta.map((v, k) => v + step[k]!);
    if (Math.max(...step.map(Math.abs)) < 1e-7) return beta;
  }
  return null;
}

/** The hardest quarter of a chart's windows under `beta`, hardest first */
function hardest(beta: readonly number[], windows: readonly PatternWindow[]): PatternWindow[] {
  const ranked = [...windows].sort((a, b) => score(beta, b.f) - score(beta, a.f));
  return ranked.slice(0, Math.max(1, Math.ceil(ranked.length * HARDEST_SHARE)));
}

/** Predicted break rate over the chart's hardest quarter */
export function chartRisk(beta: readonly number[], windows: readonly PatternWindow[]): number {
  if (windows.length === 0) return 0;
  const top = hardest(beta, windows);
  return top.reduce((s, w) => s + sigmoid(score(beta, w.f)), 0) / top.length;
}

/** What each feature adds to the risk (log-odds) over the hardest quarter: why the chart is where it is */
export function chartPull(beta: readonly number[], windows: readonly PatternWindow[]): number[] {
  const top = hardest(beta, windows);
  return beta.slice(1).map((b, k) => (top.length ? (b * top.reduce((s, w) => s + w.f[k]!, 0)) / top.length : 0));
}

/**
 * Risks read as levels: the chart at rank r gets the original level found at rank r, spread over
 * ±0.5 within a level so that the result is continuous. Same distribution as the original scale.
 */
export function matchLevels(risks: readonly number[], levels: readonly number[]): number[] {
  const order = risks.map((_, i) => i).sort((a, b) => risks[a]! - risks[b]!);
  const sorted = [...levels].sort((a, b) => a - b);
  const out = new Array<number>(risks.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j < order.length && sorted[j] === sorted[i]) j++;
    for (let q = i; q < j; q++) out[order[q]!] = sorted[i]! - 0.5 + (q - i + 0.5) / (j - i);
    i = j;
  }
  return out;
}
