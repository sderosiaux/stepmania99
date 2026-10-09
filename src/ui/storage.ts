import type { Settings, LetterGrade, ErrorMark } from '../types';
import { DEFAULT_SETTINGS } from '../types';

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

/** Where the last attempt broke: drawn on the song-select density graph */
export function saveLastRunErrors(songId: string, difficulty: string, errors: ErrorMark[]): void {
  let book: LastRuns = {};
  try {
    book = JSON.parse(localStorage.getItem(LAST_RUN_KEY) ?? '{}') as LastRuns;
  } catch {
    /* corrupted: start over */
  }
  book[key(songId, difficulty)] = { errors, date: Date.now() };
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify(book));
}

export function getLastRunErrors(songId: string, difficulty: string): ErrorMark[] | null {
  try {
    const book = JSON.parse(localStorage.getItem(LAST_RUN_KEY) ?? '{}') as LastRuns;
    return book[key(songId, difficulty)]?.errors ?? null;
  } catch {
    return null;
  }
}
