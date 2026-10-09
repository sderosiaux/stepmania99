import { describe, it, expect } from 'vitest';
import { parseSimfile } from '../../../src/parser/simfile';

const sm = (notes: string, extra = '') => `#TITLE:Test;
#ARTIST:Me;
#MUSIC:song.ogg;
#OFFSET:-0.100;
#BPMS:0.000=120.000;
${extra}
#NOTES:
     dance-single:
     :
     Hard:
     9:
     0.1,0.2,0.3,0.4,0.5:
${notes}
;`;

describe('parseSimfile (.sm)', () => {
  it('puts beat 0 at -OFFSET on the audio timeline', () => {
    const { song } = parseSimfile(sm('1000\n0000\n0000\n0000\n'), 'x');
    expect(song!.charts[0]!.notes[0]!.time).toBeCloseTo(100);
  });

  it('parses taps, holds, rolls and mines with lanes and quantization', () => {
    const { song, errors } = parseSimfile(
      sm(`1000
0200
0040
000M
,
0000
0300
0030
0000
`),
      'x'
    );
    expect(errors).toEqual([]);
    const notes = song!.charts[0]!.notes;
    expect(notes.map((n) => [n.type, n.lane, n.beat])).toEqual([
      ['tap', 0, 0],
      ['hold', 1, 1],
      ['roll', 2, 2],
      ['mine', 3, 3],
    ]);
    const hold = notes[1]!;
    expect(hold.endBeat).toBe(5);
    expect(hold.endTime).toBeCloseTo(100 + 2500);
    expect(notes[0]!.quant).toBe(4);
  });

  it('assigns 8th/16th quantization from row position', () => {
    const rows = '1000\n0100\n0010\n0001\n1000\n0100\n0010\n0001\n';
    const { song: s2 } = parseSimfile(sm(rows), 'x');
    expect(s2!.charts[0]!.notes.map((n) => n.quant)).toEqual([4, 8, 4, 8, 4, 8, 4, 8]);
  });

  it('applies stops after the stopped beat', () => {
    const { song } = parseSimfile(sm('1000\n1000\n0000\n0000\n', '#STOPS:0.000=1.000;'), 'x');
    const [a, b] = song!.charts[0]!.notes;
    expect(a!.time).toBeCloseTo(100);
    expect(b!.time).toBeCloseTo(100 + 1000 + 500);
  });

  it('ignores comments, including ones containing semicolons', () => {
    const { song } = parseSimfile(sm('// intro; tricky\n1000\n0000\n0000\n0000\n'), 'x');
    expect(song!.charts[0]!.notes).toHaveLength(1);
  });

  it('reports malformed rows and dangling tails', () => {
    const { errors } = parseSimfile(sm('10000\n0300\n0000\n0000\n'), 'x');
    expect(errors.some((e) => e.message.includes('length 5'))).toBe(true);
    expect(errors.some((e) => e.message.includes('tail without head'))).toBe(true);
  });

  it('marks #MUSIC:virtual songs as silent', () => {
    const { song } = parseSimfile(sm('1000\n0000\n0000\n0000\n').replace('song.ogg', 'virtual'), 'x');
    expect(song!.silent).toBe(true);
  });

  it('skips non dance-single charts', () => {
    const { song } = parseSimfile(sm('1000\n0000\n0000\n0000\n').replace('dance-single', 'dance-double'), 'x');
    expect(song).toBeNull();
  });
});

describe('parseSimfile (.ssc)', () => {
  const ssc = `#VERSION:0.83;
#TITLE:SSC Song;
#ARTIST:Me;
#MUSIC:a.ogg;
#OFFSET:0;
#BPMS:0=60;
#NOTEDATA:;
#STEPSTYPE:dance-single;
#DIFFICULTY:Challenge;
#METER:12;
#RADARVALUES:0.5,0.4,0.3,0.2,0.1;
#NOTES:
1000
0000
0000
0000
;
#NOTEDATA:;
#STEPSTYPE:dance-single;
#DIFFICULTY:Easy;
#METER:3;
#BPMS:0=120;
#NOTES:
0000
1000
0000
0000
;`;

  it('parses per-chart blocks, sorted by difficulty, with split timing', () => {
    const { song, errors } = parseSimfile(ssc, 'x');
    expect(errors).toEqual([]);
    expect(song!.charts.map((c) => [c.difficulty, c.level])).toEqual([
      ['Easy', 3],
      ['Challenge', 12],
    ]);
    // Easy chart overrides BPM to 120: beat 1 = 500 ms
    expect(song!.charts[0]!.notes[0]!.time).toBeCloseTo(500);
    // Challenge uses song BPM 60: beat 0 = 0 ms
    expect(song!.charts[1]!.notes[0]!.time).toBe(0);
    expect(song!.charts[1]!.radar).toEqual([0.5, 0.4, 0.3, 0.2, 0.1]);
  });
});

describe('parseSimfile comments', () => {
  it('keeps "//" inside tag values', () => {
    const src = `#TITLE:Rock // Roll;\n#ARTIST:X;\n#MUSIC:a.ogg;\n#BPMS:0=120;\n#NOTES:dance-single::Hard:9:0,0,0,0,0:\n1000 // trailing\n0000\n0000\n0000\n;`;
    const { song } = parseSimfile(src, 'x');
    expect(song!.title).toBe('Rock // Roll');
    expect(song!.artist).toBe('X');
    expect(song!.charts[0]!.notes).toHaveLength(1);
  });
});

describe('parseSimfile warps', () => {
  it('rejects charts with a negative BPM (warp) instead of playing them out of sync', () => {
    const { song, errors } = parseSimfile(sm('1000\n0000\n0000\n0000\n').replace('#BPMS:0.000=120.000;', '#BPMS:0=120,4=-120,5=120;'), 'x');
    expect(song).toBeNull();
    expect(errors.some((e) => e.message.includes('warps'))).toBe(true);
  });
});
