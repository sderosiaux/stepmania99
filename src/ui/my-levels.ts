import type { Difficulty, ResultsData } from '../types';
import type { SongEntry } from '../core/manifest';
import { loadPatterns } from '../core/loader';
import { PATTERN_FEATURES, chartWindows, type PatternFeature, type PatternWindow } from '../core/patterns';
import { MIN_BREAKS, MIN_RUNS, chartPull, chartRisk, fitBreakModel, matchLevels, observations, runBreaks, type RunLog } from '../core/my-level';
import { getRunBook, pastRuns, saveRunBook } from './storage';

// ============================================================================
// Personal levels for the whole library, refitted from the run log each time
// a run is added (a few ms). Song select reads them; nothing is cached on disk.
// ============================================================================

export interface MyLevelStatus {
  /** Enough runs and errors to trust the fit */
  ready: boolean;
  /** Runs the fit could use */
  runs: number;
  runsNeeded: number;
}

/** A pattern is named when it weighs more here than in 4 charts out of 5 of a similar personal level… */
const TRAIT_PERCENTILE = 0.8;
const PEER_SPAN = 1;
/** …and adds at least this much to the log-odds of a break (×1.16) */
const TRAIT_MIN_PULL = 0.15;
const MAX_TRAITS = 3;

const chartKey = (songId: string, difficulty: string): string => `${songId}::${difficulty}`;

class MyLevels {
  private patterns = new Map<string, PatternWindow[]>();
  private original = new Map<string, number>();
  private rated = new Map<string, { level: number; pull: number[] }>();
  private usableRuns = 0;
  private listeners = new Set<() => void>();

  /** Fetch the library's chart patterns, bring in the runs from before the log existed, fit */
  async load(entries: readonly SongEntry[]): Promise<void> {
    this.original.clear();
    for (const e of entries) for (const c of e.charts) if (!this.original.has(chartKey(e.id, c.difficulty))) this.original.set(chartKey(e.id, c.difficulty), c.level);
    this.patterns = await loadPatterns();
    this.refit();
  }

  subscribe(fn: () => void): void {
    this.listeners.add(fn);
  }

  get status(): MyLevelStatus {
    return { ready: this.rated.size > 0, runs: this.usableRuns, runsNeeded: MIN_RUNS };
  }

  level(songId: string, difficulty: Difficulty): number | undefined {
    return this.rated.get(chartKey(songId, difficulty))?.level;
  }

  /** The patterns that put this chart above charts of a similar personal level, heaviest first */
  traits(songId: string, difficulty: Difficulty): PatternFeature[] {
    const me = this.rated.get(chartKey(songId, difficulty));
    if (!me) return [];
    const peers = [...this.rated.values()].filter((r) => Math.abs(r.level - me.level) <= PEER_SPAN);
    return PATTERN_FEATURES.map((name, k) => ({ name, pull: me.pull[k]!, rank: peers.filter((p) => p.pull[k]! < me.pull[k]!).length / peers.length }))
      .filter((t) => t.pull >= TRAIT_MIN_PULL && t.rank >= TRAIT_PERCENTILE)
      .sort((a, b) => b.pull - a.pull)
      .slice(0, MAX_TRAITS)
      .map((t) => t.name);
  }

  /**
   * Log a run for learning. Left out: what the player did not play alone and as written
   * (autoplay, practice loop, battle with injected arrows, other rate, hands removed).
   */
  record(r: ResultsData, asWritten: boolean): void {
    if (!asWritten || r.autoplay || r.rate !== 1 || r.handsRemoved > 0) return;
    const windows = chartWindows(r.chart.notes);
    const breaks = runBreaks(windows, r.errors, r.failed);
    if (breaks.length === 0) return;
    const book = getRunBook();
    const run: RunLog = { key: chartKey(r.song.id, r.chart.difficulty), date: Date.now(), steps: windows.reduce((n, w) => n + w.notes, 0), breaks };
    saveRunBook({ ...book, runs: [...book.runs, run] });
    this.refit();
  }

  /** The last run of each chart played before the log existed, read with the charts' patterns */
  private seed(): void {
    const book = getRunBook();
    if (book.seeded || this.patterns.size === 0) return;
    const old = pastRuns().flatMap((p): RunLog[] => {
      const windows = this.patterns.get(p.key);
      if (!windows) return [];
      // Not the record run: it may have failed, so it counts up to its last error like a failed one
      const breaks = runBreaks(windows, p.errors, !p.cleared);
      return breaks.length ? [{ key: p.key, date: p.date, steps: windows.reduce((n, w) => n + w.notes, 0), breaks }] : [];
    });
    saveRunBook({ seeded: true, runs: [...old, ...book.runs] });
  }

  private refit(): void {
    this.seed();
    const perRun = getRunBook().runs.map((run) => observations(run, this.patterns.get(run.key) ?? []));
    const obs = perRun.flat();
    this.usableRuns = perRun.filter((o) => o.length > 0).length;
    this.rated.clear();
    const enough = this.usableRuns >= MIN_RUNS && obs.reduce((n, o) => n + o.breaks, 0) >= MIN_BREAKS;
    const beta = enough ? fitBreakModel(obs) : null;
    if (beta) {
      const keys = [...this.patterns.keys()].filter((k) => this.original.has(k) && this.patterns.get(k)!.length > 0);
      const levels = matchLevels(keys.map((k) => chartRisk(beta, this.patterns.get(k)!)), keys.map((k) => this.original.get(k)!));
      keys.forEach((k, i) => this.rated.set(k, { level: levels[i]!, pull: chartPull(beta, this.patterns.get(k)!) }));
    }
    this.listeners.forEach((fn) => fn());
  }
}

export const myLevels = new MyLevels();
