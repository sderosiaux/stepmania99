import { describe, it, expect } from 'vitest';
import { JudgeEngine, gradeForOffset, autoplayInputs, type JudgeEvent } from '../../../src/core/judge';
import { createScoreState, applyEvent, calculateGrade, calculatePercentage, calculateScore, chartTotals, fullComboTier } from '../../../src/core/score';
import type { Note, NoteType } from '../../../src/types';
import { DIRECTIONS } from '../../../src/types';

let nextId = 0;
const note = (lane: number, time: number, type: NoteType = 'tap', endTime?: number): Note => ({
  id: nextId++,
  time,
  beat: time / 500,
  lane,
  direction: DIRECTIONS[lane]!,
  type,
  quant: 4,
  ...(endTime !== undefined ? { endTime, endBeat: endTime / 500 } : {}),
});

const kinds = (evs: JudgeEvent[]) =>
  evs.map((e) => (e.kind === 'tap' ? `${e.grade}` : e.kind === 'hold' ? `hold:${e.grade}` : 'mine'));

describe('gradeForOffset', () => {
  it('uses J4 windows symmetrically', () => {
    expect(gradeForOffset(0)).toBe('marvelous');
    expect(gradeForOffset(-22.5)).toBe('marvelous');
    expect(gradeForOffset(30)).toBe('perfect');
    expect(gradeForOffset(-90)).toBe('great');
    expect(gradeForOffset(135)).toBe('good');
    expect(gradeForOffset(-180)).toBe('boo');
    expect(gradeForOffset(181)).toBe('miss');
  });
});

describe('JudgeEngine taps', () => {
  it('judges a press against the nearest note in the lane', () => {
    const e = new JudgeEngine([note(0, 1000), note(0, 1150)]);
    const ev = e.press(0, 1140);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'tap', grade: 'marvelous' });
    expect((ev[0] as { note: Note }).note.time).toBe(1150);
  });

  it('ignores presses outside the boo window and on other lanes', () => {
    const e = new JudgeEngine([note(0, 1000)]);
    expect(e.press(0, 700)).toEqual([]);
    expect(e.press(1, 1000)).toEqual([]);
  });

  it('records signed offsets: negative early, positive late', () => {
    const e = new JudgeEngine([note(0, 1000), note(1, 1000)]);
    expect(e.press(0, 960)[0]).toMatchObject({ grade: 'perfect', offset: -40 });
    expect(e.press(1, 1100)[0]).toMatchObject({ grade: 'good', offset: 100 });
  });

  it('misses a note once its window has fully passed, at the window edge', () => {
    const e = new JudgeEngine([note(2, 1000)]);
    expect(e.advance(1180)).toEqual([]);
    const ev = e.advance(1300);
    expect(ev[0]).toMatchObject({ kind: 'tap', grade: 'miss', time: 1180 });
    expect(e.isComplete()).toBe(true);
  });

  it('judges each note of a jump independently', () => {
    const e = new JudgeEngine([note(0, 1000), note(3, 1000)]);
    expect(kinds([...e.press(0, 1000), ...e.press(3, 1060)])).toEqual(['marvelous', 'great']);
  });

  it('a press is consumed by a single note (no double-hit on jacks)', () => {
    const e = new JudgeEngine([note(0, 1000), note(0, 1100)]);
    expect(e.press(0, 1050)).toHaveLength(1);
    expect(e.get(e.getNotes()[1]!).grade).toBeUndefined();
  });
});

describe('JudgeEngine holds', () => {
  it('OK when held to the end', () => {
    const e = new JudgeEngine([note(1, 1000, 'hold', 2000)]);
    expect(kinds(e.press(1, 1000))).toEqual(['marvelous']);
    expect(kinds(e.advance(2000))).toEqual(['hold:ok']);
  });

  it('survives a release shorter than 250ms and re-press', () => {
    const e = new JudgeEngine([note(1, 1000, 'hold', 2000)]);
    e.press(1, 1000);
    e.release(1, 1400);
    expect(e.press(1, 1600)).toEqual([]);
    expect(kinds(e.advance(2100))).toEqual(['hold:ok']);
  });

  it('NG 250ms after a release, at the exact death time', () => {
    const e = new JudgeEngine([note(1, 1000, 'hold', 2000)]);
    e.press(1, 1000);
    e.release(1, 1400);
    const ev = e.advance(1700);
    expect(ev[0]).toMatchObject({ kind: 'hold', grade: 'ng', time: 1650 });
    expect(e.get(e.getNotes()[0]!).hold!.droppedAt).toBe(1650);
  });

  it('releasing within 250ms of the tail is still OK', () => {
    const e = new JudgeEngine([note(1, 1000, 'hold', 2000)]);
    e.press(1, 1000);
    e.release(1, 1850);
    expect(kinds(e.advance(2050))).toEqual(['hold:ok']);
  });

  it('a missed head is a miss AND an NG', () => {
    const e = new JudgeEngine([note(1, 1000, 'hold', 2000)]);
    expect(kinds(e.advance(1500))).toEqual(['miss', 'hold:ng']);
  });
});

describe('JudgeEngine rolls', () => {
  it('must be re-tapped every 500ms even while held', () => {
    const e = new JudgeEngine([note(2, 1000, 'roll', 3000)]);
    e.press(2, 1000);
    expect(kinds(e.advance(1600))).toEqual(['hold:ng']);
  });

  it('OK when tapped regularly', () => {
    const e = new JudgeEngine([note(2, 1000, 'roll', 3000)]);
    e.press(2, 1000);
    for (let t = 1300; t < 3000; t += 300) {
      e.release(2, t - 50);
      e.press(2, t);
    }
    expect(kinds(e.advance(3000))).toEqual(['hold:ok']);
  });
});

describe('JudgeEngine mines', () => {
  it('explodes when the lane is held while it passes', () => {
    const e = new JudgeEngine([note(3, 1000, 'mine')]);
    e.press(3, 800);
    expect(kinds(e.advance(1010))).toEqual(['mine']);
  });

  it('explodes on a press inside its window', () => {
    const e = new JudgeEngine([note(3, 1000, 'mine')]);
    expect(kinds(e.press(3, 1050))).toEqual(['mine']);
  });

  it('is avoided silently otherwise', () => {
    const e = new JudgeEngine([note(3, 1000, 'mine')]);
    expect(e.advance(1200)).toEqual([]);
    expect(e.isComplete()).toBe(true);
  });
});

describe('autoplay', () => {
  it('earns AAAA on a mixed chart through the real judge path', () => {
    const notes = [
      note(0, 1000), note(1, 1000), note(0, 1062.5), note(0, 1125), note(2, 1200, 'hold', 2400),
      note(3, 1300, 'roll', 2500), note(1, 1500, 'mine'), note(1, 1600), note(0, 2600), note(2, 2600),
    ];
    const e = new JudgeEngine(notes);
    const t = chartTotals({ notes });
    let s = createScoreState(t.steps, t.freezes);
    for (const inp of autoplayInputs(notes)) {
      for (const ev of inp.pressed ? e.press(inp.lane, inp.time) : e.release(inp.lane, inp.time)) s = applyEvent(s, ev);
    }
    for (const ev of e.advance(10_000)) s = applyEvent(s, ev);
    expect(e.isComplete()).toBe(true);
    expect(s.counts.marvelous).toBe(t.steps);
    expect(s.holds.ok).toBe(2);
    expect(s.minesHit).toBe(0);
    expect(calculateGrade(s)).toBe('AAAA');
    expect(calculatePercentage(s)).toBe(100);
    expect(calculateScore(s)).toBe(1_000_000);
    expect(fullComboTier(s)).toBe('marvelous');
  });
});

describe('score', () => {
  const tap = (grade: 'marvelous' | 'perfect' | 'great' | 'good' | 'boo' | 'miss'): JudgeEvent => ({
    kind: 'tap', note: note(0, 0), grade, offset: 0, time: 0,
  });

  it('good breaks combo, great keeps it', () => {
    let s = createScoreState(10, 0);
    s = applyEvent(applyEvent(s, tap('marvelous')), tap('great'));
    expect(s.combo).toBe(2);
    s = applyEvent(s, tap('good'));
    expect(s.combo).toBe(0);
    expect(s.maxCombo).toBe(2);
  });

  it('holds count toward percentage; NG blocks AAA', () => {
    let s = createScoreState(1, 1);
    s = applyEvent(s, tap('marvelous'));
    s = applyEvent(s, { kind: 'hold', note: note(0, 0, 'hold', 1), grade: 'ng', time: 0 });
    expect(calculatePercentage(s)).toBe(50);
    expect(calculateGrade(s)).toBe('C');
    expect(fullComboTier(s)).toBeNull();
  });

  it('perfects give AAA, not AAAA', () => {
    let s = createScoreState(2, 0);
    s = applyEvent(applyEvent(s, tap('marvelous')), tap('perfect'));
    expect(calculateGrade(s)).toBe('AAA');
  });

  it('fails when life reaches 0, unless failing is disabled', () => {
    let s = createScoreState(10, 0);
    for (let i = 0; i < 5; i++) s = applyEvent(s, tap('miss'));
    expect(s.failed).toBe(true);
    expect(calculateGrade(s)).toBe('E');
    let s2 = createScoreState(10, 0);
    for (let i = 0; i < 5; i++) s2 = applyEvent(s2, tap('miss'), false);
    expect(s2.failed).toBe(false);
  });

  it('is immutable', () => {
    const s = createScoreState(1, 0);
    applyEvent(s, tap('marvelous'));
    expect(s.counts.marvelous).toBe(0);
  });
});

describe('JudgeEngine at a music rate', () => {
  it('keeps windows in real time and reports real-ms offsets', () => {
    // At 0.5x, 20 ms of song time is 40 ms of real time: a Perfect, not a Marvelous
    const e = new JudgeEngine([note(0, 1000)], 0.5);
    expect(e.press(0, 1020)[0]).toMatchObject({ grade: 'perfect', offset: 40 });
  });

  it('misses after the real-time boo window, scaled into song time', () => {
    const e = new JudgeEngine([note(0, 1000)], 1.5);
    expect(e.advance(1000 + 180 * 1.5 - 1)).toEqual([]);
    expect(kinds(e.advance(1000 + 180 * 1.5 + 1))).toEqual(['miss']);
  });

  it('scales the hold release window too', () => {
    const e = new JudgeEngine([note(1, 1000, 'hold', 3000)], 0.5);
    e.press(1, 1000);
    e.release(1, 1200);
    // 250 ms real = 125 ms of song time at 0.5x
    expect(kinds(e.advance(1330))).toEqual(['hold:ng']);
  });
});

describe('full combo needs the whole chart', () => {
  it('is not a full combo while notes remain unjudged', () => {
    const s = applyEvent(createScoreState(3, 0), { kind: 'tap', note: note(0, 0), grade: 'marvelous', offset: 0, time: 0 });
    expect(fullComboTier(s)).toBeNull();
  });
});

describe('review regressions', () => {
  it('a press judges the closest note: the tap, not a mine 62 ms later', () => {
    const e = new JudgeEngine([note(0, 1000), note(0, 1062, 'mine')]);
    expect(kinds(e.press(0, 1000))).toEqual(['marvelous']);
  });

  it('a press closer to a mine than to any tap explodes the mine only', () => {
    const e = new JudgeEngine([note(0, 1000, 'mine'), note(0, 1150)]);
    expect(kinds(e.press(0, 1010))).toEqual(['mine']);
  });

  it('a mine crossed while held explodes even behind a pending tap', () => {
    const e = new JudgeEngine([note(0, 1000), note(0, 1100, 'mine')]);
    e.press(0, 700);
    expect(kinds(e.advance(1300))).toEqual(['mine', 'miss']);
  });

  it('roll re-taps do not steal the next tap', () => {
    const e = new JudgeEngine([note(2, 1000, 'roll', 1500), note(2, 1650)]);
    e.press(2, 1000);
    e.release(2, 1440);
    expect(e.press(2, 1450)).toEqual([]);
    expect(kinds(e.advance(1500))).toEqual(['hold:ok']);
    e.release(2, 1600);
    expect(kinds(e.press(2, 1650))).toEqual(['marvelous']);
  });

  it('autoplay is perfect around mines and after rolls', () => {
    const notes = [note(0, 1000), note(0, 1060, 'mine'), note(1, 2000, 'roll', 2500), note(1, 2650)];
    const e = new JudgeEngine(notes);
    const evs: JudgeEvent[] = [];
    for (const i of autoplayInputs(notes)) evs.push(...(i.pressed ? e.press(i.lane, i.time) : e.release(i.lane, i.time)));
    evs.push(...e.advance(5000));
    expect(kinds(evs)).toEqual(['marvelous', 'marvelous', 'hold:ok', 'marvelous']);
  });
});
