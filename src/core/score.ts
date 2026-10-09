import type { Chart, JudgmentGrade, HoldGrade, LetterGrade } from '../types';
import { JUDGMENT_SCORES, JUDGMENT_MAINTAINS_COMBO, LIFE_DELTA, GRADE_THRESHOLDS, EX_SCORES } from '../types';
import type { JudgeEvent } from './judge';

// ============================================================================
// Score state — immutable reducer over judge events.
//
// Every non-mine note is one "step"; every hold/roll is additionally one
// "freeze" judged OK/NG (DDR model). Percentage = weighted steps + OK freezes.
// ============================================================================

const INITIAL_LIFE = 50;

export interface ScoreState {
  readonly totalSteps: number;
  readonly totalFreezes: number;
  readonly counts: Readonly<Record<JudgmentGrade, number>>;
  readonly holds: Readonly<Record<HoldGrade, number>>;
  readonly minesHit: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly life: number;
  readonly failed: boolean;
  readonly exScore: number;
}

export function chartTotals(chart: Pick<Chart, 'notes'>): { steps: number; freezes: number } {
  let steps = 0;
  let freezes = 0;
  for (const n of chart.notes) {
    if (n.type === 'mine') continue;
    steps++;
    if (n.type === 'hold' || n.type === 'roll') freezes++;
  }
  return { steps, freezes };
}

export function createScoreState(totalSteps: number, totalFreezes: number): ScoreState {
  return {
    totalSteps,
    totalFreezes,
    counts: { marvelous: 0, perfect: 0, great: 0, good: 0, boo: 0, miss: 0 },
    holds: { ok: 0, ng: 0 },
    minesHit: 0,
    combo: 0,
    maxCombo: 0,
    life: INITIAL_LIFE,
    failed: false,
    exScore: 0,
  };
}

const clampLife = (v: number) => Math.max(0, Math.min(100, v));

export function applyEvent(s: ScoreState, e: JudgeEvent, canFail = true): ScoreState {
  let next: ScoreState;
  switch (e.kind) {
    case 'tap': {
      const combo = JUDGMENT_MAINTAINS_COMBO[e.grade] ? s.combo + 1 : 0;
      next = {
        ...s,
        counts: { ...s.counts, [e.grade]: s.counts[e.grade] + 1 },
        combo,
        maxCombo: Math.max(s.maxCombo, combo),
        life: clampLife(s.life + LIFE_DELTA[e.grade]),
        exScore: s.exScore + EX_SCORES[e.grade],
      };
      break;
    }
    case 'hold': {
      const combo = e.grade === 'ok' ? s.combo + 1 : 0;
      next = {
        ...s,
        holds: { ...s.holds, [e.grade]: s.holds[e.grade] + 1 },
        combo,
        maxCombo: Math.max(s.maxCombo, combo),
        life: clampLife(s.life + LIFE_DELTA[e.grade]),
        exScore: s.exScore + EX_SCORES[e.grade],
      };
      break;
    }
    case 'mine':
      next = { ...s, minesHit: s.minesHit + 1, combo: 0, life: clampLife(s.life + LIFE_DELTA.mine) };
      break;
  }
  return canFail && next.life <= 0 ? { ...next, failed: true } : next;
}

/** Earned weight so far, relative to the whole chart (monotonic during play) */
export function calculatePercentage(s: ScoreState): number {
  const max = (s.totalSteps + s.totalFreezes) * 100;
  if (max === 0) return 0;
  const earned =
    (Object.keys(s.counts) as JudgmentGrade[]).reduce((acc, g) => acc + s.counts[g] * JUDGMENT_SCORES[g], 0) + s.holds.ok * 100;
  return (earned / max) * 100;
}

/** DDR-style money score, multiples of 10 */
export function calculateScore(s: ScoreState): number {
  return Math.floor((calculatePercentage(s) * 10000) / 10) * 10;
}

export function maxExScore(s: ScoreState): number {
  return s.totalSteps * EX_SCORES.marvelous + s.totalFreezes * EX_SCORES.ok;
}

/** Every step and freeze has been judged */
function isComplete(s: ScoreState): boolean {
  const judged = (Object.values(s.counts) as number[]).reduce((a, b) => a + b, 0);
  return s.totalSteps > 0 && judged === s.totalSteps && s.holds.ok + s.holds.ng === s.totalFreezes;
}

export function isFullCombo(s: ScoreState): boolean {
  return isComplete(s) && s.counts.good === 0 && s.counts.boo === 0 && s.counts.miss === 0 && s.holds.ng === 0 && s.minesHit === 0;
}

/** Highest full-combo tier reached, or null */
export function fullComboTier(s: ScoreState): 'marvelous' | 'perfect' | 'great' | null {
  if (!isFullCombo(s)) return null;
  if (s.counts.great > 0) return 'great';
  if (s.counts.perfect > 0) return 'perfect';
  return 'marvelous';
}

export function calculateGrade(s: ScoreState): LetterGrade {
  if (s.failed) return 'E';
  const clean = isComplete(s) && s.holds.ng === 0 && s.minesHit === 0 && s.counts.great + s.counts.good + s.counts.boo + s.counts.miss === 0;
  if (clean && s.counts.perfect === 0) return 'AAAA';
  if (clean) return 'AAA';
  const pct = calculatePercentage(s);
  return GRADE_THRESHOLDS.find((g) => pct >= g.threshold)?.grade ?? 'D';
}

/** Fraction (0..1) of the chart's weight already judged */
export function judgedFraction(s: ScoreState): number {
  const total = s.totalSteps + s.totalFreezes;
  if (total === 0) return 0;
  const judged = (Object.values(s.counts) as number[]).reduce((a, b) => a + b, 0) + s.holds.ok + s.holds.ng;
  return Math.min(1, judged / total);
}

/** Points already lost, on the 1,000,000 scale */
export function lostPoints(s: ScoreState): number {
  return judgedFraction(s) * 1_000_000 - (calculatePercentage(s) / 100) * 1_000_000;
}

/** Expected points lost at `fraction` judged, from a stored curve (101 samples) or a flat target percentage */
export function referenceLoss(curve: number[] | null, targetPct: number, fraction: number): number {
  if (!curve || curve.length < 2) return fraction * (1 - targetPct / 100) * 1_000_000;
  const x = fraction * (curve.length - 1);
  const i = Math.floor(x);
  const a = curve[Math.min(i, curve.length - 1)]!;
  const b = curve[Math.min(i + 1, curve.length - 1)]!;
  return a + (b - a) * (x - i);
}
