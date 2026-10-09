import type { TimingSource } from '../types';

// ============================================================================
// Beat ↔ time mapping with BPM changes, stops and delays.
//
// StepMania semantics:
//   - beat 0 sits at -#OFFSET seconds on the audio timeline
//   - a STOP at beat b freezes the chart AFTER the notes on b
//   - a DELAY at beat b freezes the chart BEFORE the notes on b
// While frozen, timeToBeat() returns b, so XMod scrolling and beat-synced
// visuals stop exactly like in StepMania.
// ============================================================================

type Segment =
  /** Linear: beat advances at `bpm` from (beat, time) */
  | { kind: 'scroll'; beat: number; time: number; bpm: number }
  /** Frozen at `beat` from `time` for `duration` ms */
  | { kind: 'freeze'; beat: number; time: number; duration: number; isDelay: boolean };

export interface TimingData {
  readonly beat0Ms: number;
  /** Ms on the audio timeline at which notes on `beat` must be hit */
  beatToTime(beat: number): number;
  /** Chart beat displayed at audio time `ms` (constant during stops/delays) */
  timeToBeat(ms: number): number;
  bpmAt(beat: number): number;
  readonly minBpm: number;
  readonly maxBpm: number;
}

const DEFAULT_BPM = 120;

export function buildTimingData(source: TimingSource): TimingData {
  const bpms = [...source.bpms].filter((b) => b.bpm > 0).sort((a, b) => a.beat - b.beat);
  if (bpms.length === 0) bpms.push({ beat: 0, bpm: DEFAULT_BPM });

  type Ev =
    | { beat: number; order: 0; kind: 'delay'; duration: number }
    | { beat: number; order: 1; kind: 'bpm'; bpm: number }
    | { beat: number; order: 2; kind: 'stop'; duration: number };

  const events: Ev[] = [
    ...source.delays.filter((d) => d.duration > 0).map((d) => ({ beat: d.beat, order: 0 as const, kind: 'delay' as const, duration: d.duration * 1000 })),
    ...bpms.map((b) => ({ beat: b.beat, order: 1 as const, kind: 'bpm' as const, bpm: b.bpm })),
    ...source.stops.filter((s) => s.duration > 0).map((s) => ({ beat: s.beat, order: 2 as const, kind: 'stop' as const, duration: s.duration * 1000 })),
  ].sort((a, b) => a.beat - b.beat || a.order - b.order);

  // The first BPM applies from -infinity (notes before the first BPM tag are rare but legal)
  let bpm = bpms[0]!.bpm;
  let beat = 0;
  let time = source.beat0Ms;
  const segments: Segment[] = [];
  const pushScroll = () => {
    const last = segments[segments.length - 1];
    if (last && last.kind === 'scroll' && last.beat === beat && last.time === time) segments.pop();
    segments.push({ kind: 'scroll', beat, time, bpm });
  };
  pushScroll();

  for (const ev of events) {
    if (ev.beat > beat) {
      time += ((ev.beat - beat) * 60000) / bpm;
      beat = ev.beat;
    }
    if (ev.kind === 'bpm') {
      if (ev.bpm !== bpm) {
        bpm = ev.bpm;
        pushScroll();
      }
    } else {
      segments.push({ kind: 'freeze', beat, time, duration: ev.duration, isDelay: ev.kind === 'delay' });
      time += ev.duration;
      pushScroll();
    }
  }

  const beatToTime = (target: number): number => {
    let t = source.beat0Ms;
    let b = 0;
    let curBpm = bpms[0]!.bpm;
    for (const ev of events) {
      if (ev.beat > target) break;
      if (ev.beat > b) {
        t += ((ev.beat - b) * 60000) / curBpm;
        b = ev.beat;
      }
      if (ev.kind === 'bpm') curBpm = ev.bpm;
      // A delay on the note's own beat happens before it; a stop on it happens after it
      else if (ev.kind === 'delay' || ev.beat < target) t += ev.duration;
    }
    return t + ((target - b) * 60000) / curBpm;
  };

  const timeToBeat = (ms: number): number => {
    let result = (ms - source.beat0Ms) * (bpms[0]!.bpm / 60000);
    for (const seg of segments) {
      if (seg.time > ms) break;
      if (seg.kind === 'scroll') {
        result = seg.beat + ((ms - seg.time) * seg.bpm) / 60000;
      } else if (ms < seg.time + seg.duration) {
        result = seg.beat;
      }
    }
    return result;
  };

  const bpmAt = (target: number): number => {
    let cur = bpms[0]!.bpm;
    for (const b of bpms) {
      if (b.beat > target) break;
      cur = b.bpm;
    }
    return cur;
  };

  const values = bpms.map((b) => b.bpm);
  return {
    beat0Ms: source.beat0Ms,
    beatToTime,
    timeToBeat,
    bpmAt,
    minBpm: Math.min(...values),
    maxBpm: Math.max(...values),
  };
}

/** Rhythmic quantization of a beat position, the classic note-color rule */
export function quantizeBeat(beat: number): number {
  const QUANTS = [4, 8, 12, 16, 24, 32, 48, 64];
  const frac = beat - Math.floor(beat);
  for (const q of QUANTS) {
    const steps = frac * (q / 4);
    if (Math.abs(steps - Math.round(steps)) < 1e-3) return q;
  }
  return 192;
}
