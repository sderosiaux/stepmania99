import type { Settings, LetterGrade, ErrorMark } from '../types';
import { DEFAULT_SETTINGS, EFFECTS, RECEPTOR_STYLES } from '../types';
import { WHEEL_SORTS, type PlayStat, type Plays, type WheelSort } from '../core/wheel';
import type { RunLog } from '../core/my-level';

// ============================================================================
// localStorage persistence: settings and personal bests.
// Unknown/old fields are dropped; missing ones fall back to defaults.
// ============================================================================

const SETTINGS_KEY = 'sm99.settings.v2';
const SCORES_KEY = 'sm99.scores.v2';
const LAST_RUN_KEY = 'sm99.lastrun.v1';

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    const s: Settings = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (raw[k] !== undefined && typeof raw[k] === typeof DEFAULT_SETTINGS[k]) (s as unknown as Record<string, unknown>)[k] = raw[k];
    }
    // Saved by another build: a style that no longer exists
    if (!RECEPTOR_STYLES.includes(s.receptorStyle)) s.receptorStyle = DEFAULT_SETTINGS.receptorStyle;
    if (!EFFECTS.includes(s.effects)) s.effects = DEFAULT_SETTINGS.effects;
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export interface ScoreRecord {
  grade: LetterGrade;
  score: number;
  exScore: number;
  maxCombo: number;
  percentage: number;
  fullCombo: boolean;
  date: number;
  /** Points lost at each 1% judged — pacemaker reference for the next attempt */
  lossCurve?: number[];
}

type ScoreBook = Record<string, ScoreRecord>;

const readScores = (): ScoreBook => {
  try {
    return JSON.parse(localStorage.getItem(SCORES_KEY) ?? '{}') as ScoreBook;
  } catch {
    return {};
  }
};

const key = (songId: string, difficulty: string) => `${songId}::${difficulty}`;

export function getBest(songId: string, difficulty: string): ScoreRecord | null {
  const r = readScores()[key(songId, difficulty)];
  // Failed runs are not records (older builds stored them)
  return r && r.grade !== 'E' ? r : null;
}

/** Store if better; returns true on a new personal best */
export function submitScore(songId: string, difficulty: string, record: ScoreRecord): boolean {
  if (record.grade === 'E') return false;
  const book = readScores();
  const prev = book[key(songId, difficulty)];
  if (prev && prev.grade !== 'E' && prev.score >= record.score) return false;
  book[key(songId, difficulty)] = record;
  localStorage.setItem(SCORES_KEY, JSON.stringify(book));
  return true;
}

type LastRuns = Record<string, { errors: ErrorMark[]; date: number }>;

const readLastRuns = (): LastRuns => {
  try {
    return JSON.parse(localStorage.getItem(LAST_RUN_KEY) ?? '{}') as LastRuns;
  } catch {
    return {};
  }
};

/** Where the last attempt broke: drawn on the song-select density graph */
export function saveLastRunErrors(songId: string, difficulty: string, errors: ErrorMark[]): void {
  const book = readLastRuns();
  book[key(songId, difficulty)] = { errors, date: Date.now() };
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify(book));
}

export function getLastRunErrors(songId: string, difficulty: string): ErrorMark[] | null {
  return readLastRuns()[key(songId, difficulty)]?.errors ?? null;
}

export interface PastRun {
  /** `songId::difficulty` */
  key: string;
  date: number;
  errors: ErrorMark[];
  /** The run that set the chart's record, so played to the end; any other may have failed */
  cleared: boolean;
}

/** The last run of each chart, from before runs were logged: what the personal levels start from */
export function pastRuns(): PastRun[] {
  const scores = readScores();
  // A record and its run's errors are saved in the same tick
  return Object.entries(readLastRuns()).map(([k, r]) => {
    const best = scores[k];
    return { key: k, date: r.date, errors: r.errors, cleared: !!best && best.grade !== 'E' && Math.abs(best.date - r.date) < 5000 };
  });
}

const RUNS_KEY = 'sm99.runs.v1';
/** ~100 bytes a run: the oldest go first, they describe an earlier player anyway */
const MAX_RUNS = 600;

export interface RunBook {
  /** pastRuns() has been brought in: it needs the chart patterns, which may arrive after the first new run */
  seeded: boolean;
  runs: RunLog[];
}

/** Runs the personal levels learn from, oldest first */
export function getRunBook(): RunBook {
  try {
    const book = JSON.parse(localStorage.getItem(RUNS_KEY) ?? 'null') as Partial<RunBook> | null;
    return { seeded: book?.seeded === true, runs: Array.isArray(book?.runs) ? book.runs : [] };
  } catch {
    return { seeded: false, runs: [] };
  }
}

export function saveRunBook(book: RunBook): void {
  const runs = [...book.runs].sort((a, b) => a.date - b.date).slice(-MAX_RUNS);
  localStorage.setItem(RUNS_KEY, JSON.stringify({ seeded: book.seeded, runs }));
}

const PLAYS_KEY = 'sm99.plays.v1';

/**
 * Plays started before they were counted: each chart with a record or a last run was played at least
 * once. A lower bound, never more than what happened.
 */
function playsFromHistory(): Record<string, PlayStat> {
  const charts = new Map<string, number>();
  for (const [k, r] of Object.entries(readScores())) charts.set(k, Math.max(charts.get(k) ?? 0, r.date ?? 0));
  for (const [k, r] of Object.entries(readLastRuns())) charts.set(k, Math.max(charts.get(k) ?? 0, r.date ?? 0));
  const plays: Record<string, PlayStat> = {};
  for (const [k, date] of charts) {
    const id = k.slice(0, k.lastIndexOf('::'));
    const p = plays[id];
    plays[id] = { count: (p?.count ?? 0) + 1, last: Math.max(p?.last ?? 0, date) };
  }
  return plays;
}

/** Plays per song: runs that reached the results screen, failed ones included; autoplay and practice aside */
export function getPlays(): Plays {
  const raw = localStorage.getItem(PLAYS_KEY);
  if (raw === null) {
    const seeded = playsFromHistory();
    localStorage.setItem(PLAYS_KEY, JSON.stringify(seeded));
    return seeded;
  }
  try {
    return JSON.parse(raw) as Plays;
  } catch {
    return {};
  }
}

export function recordPlay(songId: string): void {
  const plays = { ...getPlays() };
  plays[songId] = { count: (plays[songId]?.count ?? 0) + 1, last: Date.now() };
  localStorage.setItem(PLAYS_KEY, JSON.stringify(plays));
}

const WHEEL_SORT_KEY = 'sm99.wheel.sort.v1';

/** How the song wheel groups songs: kept between sessions, apart from the gameplay settings */
export function getWheelSort(): WheelSort {
  const v = localStorage.getItem(WHEEL_SORT_KEY);
  return WHEEL_SORTS.find((s) => s === v) ?? 'pack';
}

export function setWheelSort(sort: WheelSort): void {
  localStorage.setItem(WHEEL_SORT_KEY, sort);
}

const FORGOTTEN_KEY = 'sm99.jukebox.forgotten.v1';

/** Songs skipped in the jukebox as "not for me": it never picks them again */
export function getForgotten(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FORGOTTEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function setForgotten(songId: string, forgotten: boolean): void {
  const ids = getForgotten();
  if (forgotten) ids.add(songId);
  else ids.delete(songId);
  localStorage.setItem(FORGOTTEN_KEY, JSON.stringify([...ids]));
}
