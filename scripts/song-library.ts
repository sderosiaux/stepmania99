/**
 * The song library: StepMania song folders under one or more roots, read with the game's own parser,
 * so a song listed here is a song the game can play. The first level below a root is the pack; a pack
 * name already found under an earlier root is skipped (its songs would get the same ids).
 * Used by `npm run scan-songs` for the web build and by the desktop app at startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseSimfile } from '../src/parser/simfile';
import { MANIFEST_VERSION, type SongEntry, type SongManifest } from '../src/core/manifest';
import { PATTERNS_VERSION, chartWindows, packWindows, type PatternsFile } from '../src/core/patterns';

export interface SongLibrary {
  manifest: SongManifest;
  /** Pattern windows of every playable chart: what the personal level is computed from */
  patterns: PatternsFile;
  /** Pack name → the root folder holding it */
  packRoots: Map<string, string>;
  /** Simfiles without a playable dance-single chart */
  skipped: number;
  /** Songs whose folder holds no audio */
  noAudio: number;
}

type Outcome = SongEntry | 'no-chart' | 'no-audio';
/** Packed pattern windows by difficulty */
type ChartPatterns = Record<string, number[]>;

/**
 * Parsing costs ~2 ms a simfile, seconds for a big library. A result is reused while the simfile and its
 * folder are unchanged (the folder's mtime moves when audio is added or removed); `build` drops the whole
 * cache when the parser itself may have changed.
 */
export interface ScanCache {
  build: string;
  songs: Record<string, { stamp: string; outcome: Outcome; patterns?: ChartPatterns }>;
}

export interface ScanOptions {
  cache?: ScanCache | null;
  build?: string;
  /** Hand the event loop back this often (ms): a cold scan must not freeze the desktop app */
  yieldEveryMs?: number;
}

const AUDIO = /\.(mp3|ogg|oga|wav)$/i;

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false; // broken symlink
  }
};

/** Song folders: directories that directly contain a simfile, below the pack folder */
function findSongs(dir: string, rel: string[]): { rel: string[]; file: string }[] {
  const entries = fs.readdirSync(dir).sort();
  const simfile = entries.find((f) => f.toLowerCase().endsWith('.ssc')) ?? entries.find((f) => f.toLowerCase().endsWith('.sm'));
  if (simfile && rel.length >= 2) return [{ rel, file: simfile }];
  return entries.filter((e) => !e.startsWith('.') && isDir(path.join(dir, e))).flatMap((e) => findSongs(path.join(dir, e), [...rel, e]));
}

/**
 * Like StepMania: when #MUSIC names a file that isn't there (renamed audio, Shift-JIS names
 * read as UTF-8), play the folder's audio instead, skipping a KSF-style "intro" file.
 */
function resolveMusic(dir: string, declared: string): string | null {
  if (declared && fs.existsSync(path.join(dir, declared))) return declared;
  const audio = fs.readdirSync(dir).filter((f) => AUDIO.test(f)).sort();
  return (audio.length > 1 && /^intro/i.test(audio[0]!) ? audio[1] : audio[0]) ?? null;
}

function readSong(dir: string, rel: string[], file: string): { outcome: Outcome; patterns?: ChartPatterns } {
  // The relative path is unique; flattening '/' to '_' made A_B/C and A/B_C collide
  const id = rel.join('/');
  const { song } = parseSimfile(fs.readFileSync(path.join(dir, file), 'utf8'), id);
  if (!song) return { outcome: 'no-chart' };
  if (!song.silent) {
    const music = resolveMusic(dir, song.musicFile);
    if (!music) return { outcome: 'no-audio' };
    song.musicFile = music;
  }
  const bpms = song.timing.bpms.map((b) => b.bpm);
  const entry: SongEntry = {
    id,
    pack: rel[0]!,
    path: id,
    file,
    title: song.title,
    artist: song.artist,
    musicFile: song.musicFile,
    previewStart: song.previewStart,
    previewLength: song.previewLength,
    bpmMin: Math.min(...bpms),
    bpmMax: Math.max(...bpms),
    timing: song.timing,
    charts: song.charts.map((c) => ({ difficulty: c.difficulty, level: c.level, steps: c.notes.filter((n) => n.type !== 'mine').length })),
  };
  if (song.subtitle) entry.subtitle = song.subtitle;
  if (song.silent) entry.silent = true;
  if (song.banner) entry.banner = song.banner;
  if (song.background) entry.background = song.background;
  if (song.jacket) entry.jacket = song.jacket;
  // Two charts under one difficulty name: only the first can be played, so only it is described
  const patterns: ChartPatterns = {};
  for (const c of song.charts) patterns[c.difficulty] ??= packWindows(chartWindows(c.notes));
  return { outcome: entry, patterns };
}

const stampOf = (simfile: string, dir: string): string => {
  const f = fs.statSync(simfile);
  return `${f.mtimeMs}:${f.size}:${fs.statSync(dir).mtimeMs}`;
};

export async function scanSongLibrary(roots: readonly string[], opts: ScanOptions = {}): Promise<{ library: SongLibrary; cache: ScanCache }> {
  const build = opts.build ?? '';
  const previous = opts.cache?.build === build ? opts.cache.songs : {};
  const cache: ScanCache = { build, songs: {} };
  const packRoots = new Map<string, string>();
  const songs: SongEntry[] = [];
  const patterns: PatternsFile = { version: PATTERNS_VERSION, charts: {} };
  let skipped = 0;
  let noAudio = 0;
  let lastYield = performance.now();

  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const pack of fs.readdirSync(root).sort()) {
      if (pack.startsWith('.') || packRoots.has(pack) || !isDir(path.join(root, pack))) continue;
      packRoots.set(pack, root);
      for (const { rel, file } of findSongs(path.join(root, pack), [pack])) {
        const dir = path.join(root, ...rel);
        const simfile = path.join(dir, file);
        const stamp = stampOf(simfile, dir);
        const hit = previous[simfile];
        const read = hit?.stamp === stamp ? hit : readSong(dir, rel, file);
        const { outcome } = read;
        cache.songs[simfile] = { stamp, ...read };
        if (outcome === 'no-chart') skipped++;
        else if (outcome === 'no-audio') noAudio++;
        else {
          songs.push(outcome);
          for (const [difficulty, packed] of Object.entries(read.patterns ?? {})) patterns.charts[`${outcome.id}::${difficulty}`] = packed;
        }
        if (opts.yieldEveryMs && performance.now() - lastYield > opts.yieldEveryMs) {
          await new Promise((r) => setImmediate(r));
          lastYield = performance.now();
        }
      }
    }
  }

  const manifest: SongManifest = { version: MANIFEST_VERSION, generated: new Date().toISOString(), songs };
  return { library: { manifest, patterns, packRoots, skipped, noAudio }, cache };
}

export function describeLibrary(l: SongLibrary): string {
  const packs = new Set(l.manifest.songs.map((s) => s.pack)).size;
  const left = [l.skipped && `${l.skipped} without a playable dance-single chart`, l.noAudio && `${l.noAudio} without audio`].filter(Boolean);
  return `${l.manifest.songs.length} songs in ${packs} packs${left.length ? ` (${left.join(', ')})` : ''}`;
}
