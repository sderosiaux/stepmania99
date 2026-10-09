/**
 * Scan public/songs for .ssc/.sm simfiles (following symlinked packs) and write
 * public/songs/manifest.json with the metadata song select needs.
 * Uses the game's own parser, so a song listed here is a song the game can play.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSimfile } from '../src/parser/simfile';
import { MANIFEST_VERSION, type SongEntry, type SongManifest } from '../src/core/manifest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const songsDir = path.join(root, 'public', 'songs');

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false; // broken symlink
  }
};

/** Song folders: directories that directly contain a simfile. The first level below songs/ is the pack. */
function findSongs(dir: string, rel: string[] = []): { rel: string[]; file: string }[] {
  const entries = fs.readdirSync(dir).sort();
  const simfile = entries.find((f) => f.toLowerCase().endsWith('.ssc')) ?? entries.find((f) => f.toLowerCase().endsWith('.sm'));
  if (simfile && rel.length >= 2) return [{ rel, file: simfile }];
  return entries.filter((e) => !e.startsWith('.') && isDir(path.join(dir, e))).flatMap((e) => findSongs(path.join(dir, e), [...rel, e]));
}

const found = isDir(songsDir) ? findSongs(songsDir) : [];
const songs: SongEntry[] = [];
let skipped = 0;

for (const { rel, file } of found) {
  const relPath = rel.join('/');
  // The relative path is unique; flattening '/' to '_' made A_B/C and A/B_C collide
  const id = relPath;
  const { song } = parseSimfile(fs.readFileSync(path.join(songsDir, relPath, file), 'utf8'), id);
  if (!song) {
    skipped++;
    continue;
  }
  const bpms = song.timing.bpms.map((b) => b.bpm);
  const entry: SongEntry = {
    id,
    pack: rel[0]!,
    path: relPath,
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
  songs.push(entry);
}

const manifest: SongManifest = { version: MANIFEST_VERSION, generated: new Date().toISOString(), songs };
fs.mkdirSync(songsDir, { recursive: true });
fs.writeFileSync(path.join(songsDir, 'manifest.json'), JSON.stringify(manifest));
const packs = new Set(songs.map((s) => s.pack));
console.log(`${songs.length} songs in ${packs.size} packs${skipped ? ` (${skipped} without a playable dance-single chart)` : ''}`);
