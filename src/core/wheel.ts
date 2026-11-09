import type { Difficulty } from '../types';
import { DIFFICULTY_ORDER, type ChartMeta, type SongEntry } from './manifest';

// ============================================================================
// Song wheel rows. By pack, a row is a song, shown on its chart nearest the
// difficulty being browsed. By level, or once the search asks for a level, a
// row is one chart: a song with a 9 and a 12 sits in both places. In community
// packs the difficulty name says little ("Hard" runs from 4 to 25), the level does.
// ============================================================================

export type WheelSort = 'pack' | 'level';
export const WHEEL_SORTS: readonly WheelSort[] = ['pack', 'level'];

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
}

// `-` with no upper bound yet is a range being typed: it holds as the single level meanwhile
const LEVEL_TOKEN = /^lv:?(\d+)(?:(\+)|-(\d*))?$/;

/** `lv:12`, `lv:10-12`, `lv:12+` (colon optional) keep charts of those levels; other words match text */
export function parseQuery(q: string): WheelQuery {
  const terms: string[] = [];
  let level: LevelRange | null = null;
  for (const t of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = LEVEL_TOKEN.exec(t);
    if (!m) {
      // A half-typed `lv:` must not empty the wheel while the number is on its way
      if (t !== 'lv:') terms.push(t);
      continue;
    }
    const a = Number(m[1]);
    const b = m[2] ? Infinity : m[3] ? Number(m[3]) : a;
    const r = { min: Math.min(a, b), max: Math.max(a, b) };
    // Several level tokens all apply, like words do
    level = level ? { min: Math.max(level.min, r.min), max: Math.min(level.max, r.max) } : r;
  }
  return { terms, level };
}

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
export function buildRows(songs: readonly SongEntry[], query: WheelQuery, sort: WheelSort): WheelRow[] {
  const found = songs.filter((e) => matchesText(e, query.terms));
  if (sort === 'pack' && !query.level) return found.map((entry) => ({ key: entry.id, entry, chart: null }));
  const { level } = query;
  const rows: WheelRow[] = found.flatMap((entry) =>
    playableCharts(entry)
      .filter((c) => !level || (c.level >= level.min && c.level <= level.max))
      .map((chart) => ({ key: `${entry.id}::${chart.difficulty}`, entry, chart }))
  );
  if (sort === 'level') {
    rows.sort(
      (a, b) =>
        a.chart!.level - b.chart!.level ||
        a.entry.title.localeCompare(b.entry.title) ||
        a.entry.pack.localeCompare(b.entry.pack) ||
        order(a.chart!.difficulty) - order(b.chart!.difficulty)
    );
  }
  return rows;
}

/** What PgUp/PgDn jump between: packs, or levels when sorted by level */
export function groupOf(row: WheelRow, sort: WheelSort): string | number {
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
