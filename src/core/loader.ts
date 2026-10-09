import type { Song } from '../types';
import { parseSimfile } from '../parser/simfile';
import { MANIFEST_VERSION, type SongEntry, type SongManifest } from './manifest';

// ============================================================================
// Songs: the manifest lists them all; a simfile is fetched and parsed only
// when a song is focused or played (packs can hold thousands of songs).
// ============================================================================

const BASE = import.meta.env.BASE_URL;
const CACHE_SIZE = 32;
const cache = new Map<string, Promise<Song>>();

export const songDir = (entry: Pick<SongEntry, 'path'>): string => `${BASE}songs/${entry.path}`;

export async function loadManifest(): Promise<SongEntry[]> {
  const res = await fetch(`${BASE}songs/manifest.json`, { cache: 'no-cache' });
  if (!res.ok) return [];
  const manifest = (await res.json()) as SongManifest;
  if (manifest.version !== MANIFEST_VERSION) {
    console.warn('Song manifest is outdated: run `npm run scan-songs`');
    return [];
  }
  return manifest.songs;
}

export function loadSong(entry: SongEntry): Promise<Song> {
  const hit = cache.get(entry.id);
  if (hit) {
    // LRU: move to the most recent position
    cache.delete(entry.id);
    cache.set(entry.id, hit);
    return hit;
  }
  const p = (async () => {
    const dir = songDir(entry);
    const res = await fetch(`${dir}/${entry.file}`);
    if (!res.ok) throw new Error(`Could not load ${entry.path} (HTTP ${res.status})`);
    const { song, errors } = parseSimfile(await res.text(), entry.id, dir);
    if (errors.length) console.warn(`Simfile issues in ${entry.path}:`, errors.map((e) => e.message));
    if (!song) throw new Error(`No playable chart in ${entry.path}`);
    song.pack = entry.pack;
    return song;
  })();
  p.catch(() => cache.delete(entry.id));
  cache.set(entry.id, p);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return p;
}
