import type { Difficulty } from '../types';
import { DIFFICULTY_ORDER, type ChartMeta, type SongEntry } from './manifest';

// ============================================================================
// Song wheel rows. By pack or by plays, a row is a song, shown on its chart
// nearest the difficulty being browsed. By level, or once the search asks for a
// level, a row is one chart: a song with a 9 and a 12 sits in both places. In
// community packs the difficulty name says little ("Hard" runs from 4 to 25), the level does.
// "My level" is the personal scale (my-level.ts): same rows, ordered and filtered by it.
// ============================================================================

export type WheelSort = 'pack' | 'level' | 'mine' | 'played';
/** The order G cycles through */
export const WHEEL_SORTS: readonly WheelSort[] = ['pack', 'level', 'mine', 'played'];

/** A chart's personal level; undefined while there is none (too few runs, chart not analysed) */
export type MyLevelOf = (songId: string, difficulty: Difficulty) => number | undefined;
const noMyLevel: MyLevelOf = () => undefined;

export interface PlayStat {
  count: number;
  /** Date.now() of the last play */
  last: number;
}

/** Plays per song id */
export type Plays = Readonly<Record<string, PlayStat>>;

export interface WheelRow {
  /** Stable across rebuilds: the song id, plus the difficulty when the row is one chart */
  key: string;
  entry: SongEntry;
  /** The row's own chart; null when the row follows the browsing difficulty */
  chart: ChartMeta | null;
}

export interface LevelRange {
  min: number;
  max: number;
}

export interface WheelQuery {
  /** Lower-cased words, each of which must appear in the title, subtitle, artist or pack */
  terms: string[];
  level: LevelRange | null;
  /** The same, on the personal level rounded to a whole number */
  mine: LevelRange | null;
}

// `-` with no upper bound yet is a range being typed: it holds as the single level meanwhile
const LEVEL_TOKEN = /^(lv|my):?(\d+)(?:(\+)|-(\d*))?$/;

/** `lv:12`, `lv:10-12`, `lv:12+` (colon optional) keep charts of those levels, `my:` of those personal levels; other words match text */
export function parseQuery(q: string): WheelQuery {
  const terms: string[] = [];
  const ranges: { lv: LevelRange | null; my: LevelRange | null } = { lv: null, my: null };
  for (const t of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = LEVEL_TOKEN.exec(t);
    if (!m) {
      // A half-typed `lv:` must not empty the wheel while the number is on its way
      if (t !== 'lv:' && t !== 'my:') terms.push(t);
      continue;
    }
    const scale = m[1] as 'lv' | 'my';
    const a = Number(m[2]);
    const b = m[3] ? Infinity : m[4] ? Number(m[4]) : a;
    const r = { min: Math.min(a, b), max: Math.max(a, b) };
    const had = ranges[scale];
    // Several level tokens all apply, like words do
    ranges[scale] = had ? { min: Math.max(had.min, r.min), max: Math.min(had.max, r.max) } : r;
  }
  return { terms, level: ranges.lv, mine: ranges.my };
}

const within = (v: number, r: LevelRange): boolean => v >= r.min && v <= r.max;

const matchesText = (e: SongEntry, terms: readonly string[]): boolean => {
  if (terms.length === 0) return true;
  const hay = `${e.title} ${e.subtitle ?? ''} ${e.artist} ${e.pack}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
};

/**
 * Charts reachable by difficulty name. The game addresses a chart by song + difficulty (play, scores,
 * links), so when a simfile holds two charts under one name only the first can be played: the wheel
 * must not offer the second under a level it would not get.
 */
const playableCharts = (e: SongEntry): ChartMeta[] => e.charts.filter((c, i, all) => all.findIndex((x) => x.difficulty === c.difficulty) === i);

const order = (d: Difficulty) => DIFFICULTY_ORDER.indexOf(d);

/** Wheel rows from songs already in pack/title order */
export function buildRows(songs: readonly SongEntry[], query: WheelQuery, sort: WheelSort, plays: Plays = {}, myLevel: MyLevelOf = noMyLevel): WheelRow[] {
  const found = songs.filter((e) => matchesText(e, query.terms));
  const { level, mine } = query;
  const byChart = sort === 'level' || sort === 'mine' || !!level || !!mine;
  const keeps = (entry: SongEntry, c: ChartMeta): boolean => {
    if (level && !within(c.level, level)) return false;
    if (!mine) return true;
    // A chart without a personal level is not on that scale: the filter leaves it out
    const m = myLevel(entry.id, c.difficulty);
    return m !== undefined && within(Math.round(m), mine);
  };
  const rows: WheelRow[] = byChart
    ? found.flatMap((entry) =>
        playableCharts(entry)
          .filter((c) => keeps(entry, c))
          .map((chart) => ({ key: `${entry.id}::${chart.difficulty}`, entry, chart }))
      )
    : found.map((entry) => ({ key: entry.id, entry, chart: null }));
  if (sort === 'played') {
    // Most played first, the latest first among equals; songs never played keep pack order (stable sort)
    const count = (r: WheelRow) => plays[r.entry.id]?.count ?? 0;
    const last = (r: WheelRow) => plays[r.entry.id]?.last ?? 0;
    rows.sort((a, b) => count(b) - count(a) || last(b) - last(a));
  } else if (sort === 'level' || sort === 'mine') {
    // Until a chart has a personal level, its own level stands in: the wheel stays ordered
    const value = (r: WheelRow) => (sort === 'mine' ? (myLevel(r.entry.id, r.chart!.difficulty) ?? r.chart!.level) : r.chart!.level);
    rows.sort(
      (a, b) =>
        value(a) - value(b) ||
        a.entry.title.localeCompare(b.entry.title) ||
        a.entry.pack.localeCompare(b.entry.pack) ||
        order(a.chart!.difficulty) - order(b.chart!.difficulty)
    );
  }
  return rows;
}

/** What PgUp/PgDn jump between: packs, levels, or played / never played */
export function groupOf(row: WheelRow, sort: WheelSort, plays: Plays = {}, myLevel: MyLevelOf = noMyLevel): string | number {
  if (sort === 'played') return plays[row.entry.id] ? 'played' : 'new';
  if (sort === 'mine' && row.chart) return Math.round(myLevel(row.entry.id, row.chart.difficulty) ?? row.chart.level);
  return sort === 'level' && row.chart ? row.chart.level : row.entry.pack;
}

/** The song's row whose chart is nearest `difficulty`; -1 when the song is not listed */
export function findRow(rows: readonly WheelRow[], songId: string, difficulty: Difficulty): number {
  let best = -1;
  let bestDistance = Infinity;
  rows.forEach((r, i) => {
    if (r.entry.id !== songId) return;
    const distance = r.chart ? Math.abs(order(r.chart.difficulty) - order(difficulty)) : 0;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}
