import { describe, it, expect } from 'vitest';
import { buildRows, findRow, groupOf, parseQuery } from '../../../src/core/wheel';
import type { ChartMeta, SongEntry } from '../../../src/core/manifest';
import type { Difficulty } from '../../../src/types';

const chart = (difficulty: Difficulty, level: number): ChartMeta => ({ difficulty, level, steps: 100 });

const song = (id: string, pack: string, charts: ChartMeta[], artist = 'A'): SongEntry => ({
  id,
  pack,
  path: `${pack}/${id}`,
  file: `${id}.sm`,
  title: id,
  artist,
  musicFile: `${id}.ogg`,
  previewStart: 0,
  previewLength: 12,
  bpmMin: 120,
  bpmMax: 120,
  timing: { offset: 0, bpms: [{ beat: 0, bpm: 120 }], stops: [] } as unknown as SongEntry['timing'],
  charts,
});

// Already in pack/title order, as song select hands them over
const songs = [
  song('Alpha', 'P1', [chart('Easy', 4), chart('Hard', 12)]),
  song('Bravo', 'P1', [chart('Challenge', 9)], 'Zed'),
  song('Charlie', 'P2', [chart('Medium', 12), chart('Challenge', 15)]),
];

const keys = (rows: ReturnType<typeof buildRows>) => rows.map((r) => r.key);

describe('parseQuery', () => {
  it('reads a single level, a range and an open range', () => {
    expect(parseQuery('lv:12').level).toEqual({ min: 12, max: 12 });
    expect(parseQuery('lv10-12').level).toEqual({ min: 10, max: 12 });
    expect(parseQuery('lv:12-10').level).toEqual({ min: 10, max: 12 });
    expect(parseQuery('LV:12+').level).toEqual({ min: 12, max: Infinity });
  });

  it('keeps the other words as text terms', () => {
    expect(parseQuery('Night lv:9 core')).toEqual({ terms: ['night', 'core'], level: { min: 9, max: 9 }, mine: null });
  });

  it('intersects several level tokens', () => {
    expect(parseQuery('lv:8+ lv:5-10').level).toEqual({ min: 8, max: 10 });
  });

  it('does not empty the wheel on a level token still being typed', () => {
    expect(parseQuery('lv:')).toEqual({ terms: [], level: null, mine: null });
    expect(parseQuery('lv:10-')).toEqual({ terms: [], level: { min: 10, max: 10 }, mine: null });
    expect(parseQuery('my:')).toEqual({ terms: [], level: null, mine: null });
  });

  it('leaves a bare number to the text search: titles have numbers', () => {
    expect(parseQuery('2049')).toEqual({ terms: ['2049'], level: null, mine: null });
  });
});

describe('personal levels', () => {
  // Alpha's 12 plays like a 9 for this player; Charlie's 12 like a 14; Bravo was never analysed
  const mine: Record<string, number> = { 'Alpha::Easy': 3.6, 'Alpha::Hard': 9.4, 'Charlie::Medium': 13.6, 'Charlie::Challenge': 15.2 };
  const myLevel = (id: string, d: Difficulty) => mine[`${id}::${d}`];

  it('reads my: tokens apart from lv: ones', () => {
    expect(parseQuery('my:12 lv:10+')).toEqual({ terms: [], level: { min: 10, max: Infinity }, mine: { min: 12, max: 12 } });
    expect(parseQuery('MY13-15').mine).toEqual({ min: 13, max: 15 });
  });

  it('my: keeps the charts whose personal level rounds into the range, one row per chart', () => {
    expect(keys(buildRows(songs, parseQuery('my:14-15'), 'pack', {}, myLevel))).toEqual(['Charlie::Medium', 'Charlie::Challenge']);
    expect(keys(buildRows(songs, parseQuery('my:9'), 'pack', {}, myLevel))).toEqual(['Alpha::Hard']);
  });

  it('my: leaves out charts that have no personal level', () => {
    expect(keys(buildRows(songs, parseQuery('my:1+'), 'pack', {}, myLevel))).not.toContain('Bravo::Challenge');
    expect(buildRows(songs, parseQuery('my:1+'), 'pack')).toEqual([]);
  });

  it('by my level: ordered by it, a chart without one standing at its own level', () => {
    expect(keys(buildRows(songs, parseQuery(''), 'mine', {}, myLevel))).toEqual(['Alpha::Easy', 'Bravo::Challenge', 'Alpha::Hard', 'Charlie::Medium', 'Charlie::Challenge']);
  });

  it('by my level with none yet: the same wheel as by level', () => {
    expect(keys(buildRows(songs, parseQuery(''), 'mine'))).toEqual(keys(buildRows(songs, parseQuery(''), 'level')));
  });

  it('groups by the rounded personal level', () => {
    const rows = buildRows(songs, parseQuery(''), 'mine', {}, myLevel);
    expect(rows.map((r) => groupOf(r, 'mine', {}, myLevel))).toEqual([4, 9, 9, 14, 15]);
  });
});

describe('buildRows', () => {
  it('by pack without a level: one row per song, following the browsing difficulty', () => {
    const rows = buildRows(songs, parseQuery(''), 'pack');
    expect(keys(rows)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(rows.every((r) => r.chart === null)).toBe(true);
  });

  it('by level: one row per chart, levels ascending, titles within a level', () => {
    const rows = buildRows(songs, parseQuery(''), 'level');
    expect(keys(rows)).toEqual(['Alpha::Easy', 'Bravo::Challenge', 'Alpha::Hard', 'Charlie::Medium', 'Charlie::Challenge']);
  });

  it('a level filter in pack order pins each row to the matching chart', () => {
    const rows = buildRows(songs, parseQuery('lv:12'), 'pack');
    expect(keys(rows)).toEqual(['Alpha::Hard', 'Charlie::Medium']);
    expect(rows.map((r) => r.chart?.level)).toEqual([12, 12]);
  });

  it('combines text and level', () => {
    expect(keys(buildRows(songs, parseQuery('p2 lv:12+'), 'level'))).toEqual(['Charlie::Medium', 'Charlie::Challenge']);
    expect(keys(buildRows(songs, parseQuery('zed lv:12'), 'level'))).toEqual([]);
  });

  it('offers only the first chart of a difficulty name, the one the game plays', () => {
    const dup = song('Dup', 'P3', [chart('Challenge', 11), chart('Challenge', 14)]);
    const rows = buildRows([dup], parseQuery(''), 'level');
    expect(rows.map((r) => [r.key, r.chart?.level])).toEqual([['Dup::Challenge', 11]]);
    expect(buildRows([dup], parseQuery('lv:14'), 'level')).toEqual([]);
  });
});

describe('groupOf', () => {
  it('groups by pack, or by level when sorted by level', () => {
    const [byPack] = buildRows(songs, parseQuery(''), 'pack');
    const [byLevel] = buildRows(songs, parseQuery(''), 'level');
    expect(groupOf(byPack!, 'pack')).toBe('P1');
    expect(groupOf(byLevel!, 'level')).toBe(4);
  });
});

describe('findRow', () => {
  const rows = buildRows(songs, parseQuery(''), 'level');

  it('finds the row of the asked chart', () => {
    expect(rows[findRow(rows, 'Charlie', 'Challenge')]!.key).toBe('Charlie::Challenge');
  });

  it('falls back to the nearest chart the song has', () => {
    expect(rows[findRow(rows, 'Alpha', 'Challenge')]!.key).toBe('Alpha::Hard');
    expect(rows[findRow(rows, 'Alpha', 'Beginner')]!.key).toBe('Alpha::Easy');
  });

  it('finds an unpinned row by song alone, and nothing for a song not listed', () => {
    const byPack = buildRows(songs, parseQuery(''), 'pack');
    expect(findRow(byPack, 'Bravo', 'Beginner')).toBe(1);
    expect(findRow(byPack, 'Nope', 'Hard')).toBe(-1);
  });
});

describe('most played', () => {
  const plays = { Charlie: { count: 5, last: 100 }, Bravo: { count: 2, last: 300 }, Alpha: { count: 2, last: 200 } };

  it('orders songs by plays, the latest first among equals, songs never played last in pack order', () => {
    const more = [...songs, song('Delta', 'P3', [chart('Easy', 3)]), song('Echo', 'P0', [chart('Hard', 9)])];
    expect(keys(buildRows(more, parseQuery(''), 'played', plays))).toEqual(['Charlie', 'Bravo', 'Alpha', 'Delta', 'Echo']);
  });

  it('keeps one row per song unless a level is asked for', () => {
    expect(buildRows(songs, parseQuery(''), 'played', plays).every((r) => r.chart === null)).toBe(true);
    expect(keys(buildRows(songs, parseQuery('lv:12'), 'played', plays))).toEqual(['Charlie::Medium', 'Alpha::Hard']);
  });

  it('PgUp/PgDn groups: played, then never played', () => {
    const rows = buildRows([...songs, song('Delta', 'P3', [chart('Easy', 3)])], parseQuery(''), 'played', { Alpha: { count: 1, last: 1 } });
    expect(rows.map((r) => groupOf(r, 'played', { Alpha: { count: 1, last: 1 } }))).toEqual(['played', 'new', 'new', 'new']);
  });
});
