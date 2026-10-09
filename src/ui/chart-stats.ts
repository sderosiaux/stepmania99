import type { Chart, Note } from '../types';

// ============================================================================
// Chart analysis for song select: counts, density curve, groove radar.
// ============================================================================

export interface ChartStats {
  steps: number;
  jumps: number;
  holds: number;
  rolls: number;
  mines: number;
  durationSec: number;
  /** Song ms of the first step and of the last step (or tail) — the density graph's x axis */
  startMs: number;
  endMs: number;
  avgNps: number;
  peakNps: number;
  /** Notes per second sampled in 1 s buckets */
  density: number[];
  /** 0..1: stream, voltage, air, freeze, chaos */
  radar: [number, number, number, number, number];
}

const cache = new WeakMap<Chart, ChartStats>();

export function chartStats(chart: Chart): ChartStats {
  const hit = cache.get(chart);
  if (hit) return hit;
  const steps = chart.notes.filter((n) => n.type !== 'mine');
  const rows = new Map<number, Note[]>();
  for (const n of steps) rows.set(n.time, [...(rows.get(n.time) ?? []), n]);
  const first = steps[0]?.time ?? 0;
  const last = steps.reduce((m, n) => Math.max(m, n.endTime ?? n.time), first);
  const durationSec = Math.max(1, (last - first) / 1000);

  const buckets = Math.max(1, Math.ceil(durationSec));
  const density = new Array<number>(buckets).fill(0);
  for (const n of steps) density[Math.min(buckets - 1, Math.floor((n.time - first) / 1000))]!++;
  // Peak over a sliding 2 s window, smoother than single buckets
  let peakNps = 0;
  for (let i = 0; i < buckets; i++) peakNps = Math.max(peakNps, ((density[i] ?? 0) + (density[i + 1] ?? density[i] ?? 0)) / 2);

  const holds = steps.filter((n) => n.type === 'hold').length;
  const rolls = steps.filter((n) => n.type === 'roll').length;
  const jumps = [...rows.values()].filter((r) => r.length >= 2).length;
  const avgNps = steps.length / durationSec;

  // Off-beat share (anything finer than 8ths) as a chaos proxy
  const offbeat = steps.filter((n) => n.quant > 8).length / Math.max(1, steps.length);
  const radar: ChartStats['radar'] = chart.radar && chart.radar.length === 5
    ? (chart.radar.map((v) => Math.min(1, v)) as ChartStats['radar'])
    : [
        Math.min(1, avgNps / 8),
        Math.min(1, peakNps / 14),
        Math.min(1, (jumps / Math.max(1, rows.size)) * 2.5),
        Math.min(1, ((holds + rolls) / Math.max(1, steps.length)) * 5),
        Math.min(1, offbeat * 2),
      ];

  const stats: ChartStats = {
    steps: steps.length,
    jumps,
    holds,
    rolls,
    mines: chart.notes.length - steps.length,
    durationSec,
    startMs: first,
    endMs: last,
    avgNps,
    peakNps,
    density,
    radar,
  };
  cache.set(chart, stats);
  return stats;
}
