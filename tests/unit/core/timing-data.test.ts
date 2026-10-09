import { describe, it, expect } from 'vitest';
import { buildTimingData, quantizeBeat } from '../../../src/core/timing-data';

const base = { beat0Ms: 0, bpms: [{ beat: 0, bpm: 120 }], stops: [], delays: [] };

describe('buildTimingData', () => {
  it('maps beats linearly at constant BPM', () => {
    const td = buildTimingData(base);
    expect(td.beatToTime(0)).toBe(0);
    expect(td.beatToTime(4)).toBe(2000);
    expect(td.timeToBeat(2000)).toBe(4);
  });

  it('places beat 0 at beat0Ms (i.e. -#OFFSET)', () => {
    const td = buildTimingData({ ...base, beat0Ms: 250 });
    expect(td.beatToTime(0)).toBe(250);
    expect(td.timeToBeat(250)).toBe(0);
    expect(td.timeToBeat(0)).toBeCloseTo(-0.5);
  });

  it('handles BPM changes', () => {
    const td = buildTimingData({ ...base, bpms: [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 240 }] });
    expect(td.beatToTime(4)).toBe(2000);
    expect(td.beatToTime(8)).toBe(3000);
    expect(td.timeToBeat(2500)).toBe(6);
    expect(td.bpmAt(5)).toBe(240);
    expect(td.minBpm).toBe(120);
    expect(td.maxBpm).toBe(240);
  });

  it('a stop delays notes AFTER its beat, not the note on it', () => {
    const td = buildTimingData({ ...base, stops: [{ beat: 4, duration: 1 }] });
    expect(td.beatToTime(4)).toBe(2000);
    expect(td.beatToTime(4.5)).toBe(3250);
    expect(td.timeToBeat(2000)).toBe(4);
    expect(td.timeToBeat(2600)).toBe(4);
    expect(td.timeToBeat(3000)).toBe(4);
    expect(td.timeToBeat(3250)).toBeCloseTo(4.5);
  });

  it('a delay delays the note ON its beat', () => {
    const td = buildTimingData({ ...base, delays: [{ beat: 4, duration: 1 }] });
    expect(td.beatToTime(3.5)).toBe(1750);
    expect(td.beatToTime(4)).toBe(3000);
    expect(td.timeToBeat(2500)).toBe(4);
  });

  it('combines BPM change and stop on the same beat', () => {
    const td = buildTimingData({ ...base, bpms: [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }], stops: [{ beat: 4, duration: 0.5 }] });
    expect(td.beatToTime(4)).toBe(2000);
    expect(td.beatToTime(5)).toBe(3500);
    expect(td.timeToBeat(3500)).toBe(5);
  });

  it('round-trips across a dense timing map', () => {
    const td = buildTimingData({
      beat0Ms: -30,
      bpms: [{ beat: 0, bpm: 161 }, { beat: 4, bpm: 160 }, { beat: 172, bpm: 79.96 }, { beat: 190, bpm: 160 }],
      stops: [{ beat: 100.75, duration: 1.875 }],
      delays: [{ beat: 50, duration: 0.2 }],
    });
    for (const b of [0, 1.25, 4, 49.5, 51, 100.75, 101, 171.9, 180, 195]) {
      expect(td.timeToBeat(td.beatToTime(b))).toBeCloseTo(b, 6);
    }
  });
});

describe('quantizeBeat', () => {
  it('classifies rows by subdivision', () => {
    expect(quantizeBeat(3)).toBe(4);
    expect(quantizeBeat(3.5)).toBe(8);
    expect(quantizeBeat(1 / 3)).toBe(12);
    expect(quantizeBeat(0.25)).toBe(16);
    expect(quantizeBeat(1 / 6)).toBe(24);
    expect(quantizeBeat(0.125)).toBe(32);
    expect(quantizeBeat(1 / 48)).toBe(192);
  });
});
