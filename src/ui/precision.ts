import type { HitSample } from '../types';
import { TIMING_WINDOWS } from '../types';

// ============================================================================
// Precision analysis: where the spread comes from, and what it costs.
// Hit offsets are modelled as a normal distribution N(mean, sd); the share of
// Marvelous a player can expect is P(|X| ≤ 22.5 ms).
// ============================================================================

export interface GroupStats {
  label: string;
  n: number;
  mean: number;
  sd: number;
  /** Share (0..1) of these hits inside the Marvelous window */
  marvelous: number;
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

const normalCdf = (x: number, mean: number, sd: number) => 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));

/** Expected share of hits within ±window for offsets ~ N(mean, sd) */
export function expectedWithin(mean: number, sd: number, window = TIMING_WINDOWS.marvelous): number {
  if (sd <= 0) return Math.abs(mean) <= window ? 1 : 0;
  return normalCdf(window, mean, sd) - normalCdf(-window, mean, sd);
}

/** Spread (centered) needed to land `share` of hits within ±window */
export function sdForShare(share: number, window = TIMING_WINDOWS.marvelous): number {
  let lo = 0.1;
  let hi = 200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (expectedWithin(0, mid, window) > share) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function groupStats(label: string, hits: HitSample[]): GroupStats {
  const n = hits.length;
  if (n === 0) return { label, n, mean: 0, sd: 0, marvelous: 0 };
  const mean = hits.reduce((a, h) => a + h.offset, 0) / n;
  const sd = Math.sqrt(hits.reduce((a, h) => a + (h.offset - mean) ** 2, 0) / n);
  const marvelous = hits.filter((h) => Math.abs(h.offset) <= TIMING_WINDOWS.marvelous).length / n;
  return { label, n, mean, sd, marvelous };
}

/** Breakdown by pattern context; groups with too few hits are dropped */
export function breakdown(hits: HitSample[], minHits = 8): GroupStats[] {
  const groups: [string, (h: HitSample) => boolean][] = [
    ['Singles', (h) => !h.jump],
    ['Jumps', (h) => h.jump],
    ['4ths', (h) => h.quant === 4],
    ['8ths', (h) => h.quant === 8],
    ['16ths+', (h) => h.quant >= 12],
  ];
  return groups.map(([label, f]) => groupStats(label, hits.filter(f))).filter((g) => g.n >= minHits);
}

/** Plain-language diagnosis, most useful sentence first */
export function coach(hits: HitSample[]): string[] {
  if (hits.length < 30) return [];
  const all = groupStats('All', hits);
  const expected = expectedWithin(all.mean, all.sd);
  const centered = expectedWithin(0, all.sd);
  const lines: string[] = [];
  lines.push(
    `With a spread of σ ${all.sd.toFixed(1)} ms, about ${Math.round(expected * 100)}% of hits can land Marvelous` +
      (centered - expected > 0.03 ? `; ${Math.round(centered * 100)}% if your timing were centered (offset ${all.mean >= 0 ? '+' : ''}${all.mean.toFixed(0)} ms).` : '.')
  );
  const target = all.marvelous < 0.85 ? 0.9 : 0.97;
  lines.push(`${Math.round(target * 100)}% Marvelous needs σ ≈ ${sdForShare(target).toFixed(1)} ms. Consistency, not the offset, is the lever.`);

  const groups = breakdown(hits, 15);
  const drift = groups.filter((g) => g.label !== 'Singles').sort((a, b) => Math.abs(b.mean - all.mean) - Math.abs(a.mean - all.mean))[0];
  if (drift && Math.abs(drift.mean - all.mean) >= 6) {
    lines.push(`${drift.label} land ${Math.abs(drift.mean - all.mean).toFixed(0)} ms ${drift.mean > all.mean ? 'later' : 'earlier'} than your average.`);
  }
  const loose = [...groups].sort((a, b) => b.sd - a.sd)[0];
  if (loose && loose.sd - all.sd >= 3) lines.push(`${loose.label} are your loosest (σ ${loose.sd.toFixed(1)} ms): drill them at a slower rate.`);
  return lines;
}
