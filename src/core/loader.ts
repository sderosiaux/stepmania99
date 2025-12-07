import type { Song } from '../types';
import { parseStpFile } from '../parser';
import { parseSmFile } from '../parser/sm-parser';

// ============================================================================
// Song Manifest Types
// ============================================================================

interface SongManifestEntry {
  pack: string;
  folder: string;
  smFile: string;
  path: string;
}

interface SongManifest {
  version: number;
  generated: string;
  songs: SongManifestEntry[];
}

// ============================================================================
// Song Loader
// ============================================================================

/**
 * Load a single song from a directory (for .stp files in public folder)
 */
export async function loadSong(songId: string): Promise<Song | null> {
  try {
    const chartUrl = `songs/${songId}/chart.stp`;
    const response = await fetch(chartUrl);

    if (!response.ok) {
      console.error(`Failed to load chart: ${chartUrl}`);
      return null;
    }

    const content = await response.text();
    const { song, errors } = parseStpFile(content, songId);

    if (errors.length > 0) {
      console.warn(`Parse warnings for ${songId}:`, errors);
    }

    return song;
  } catch (error) {
    console.error(`Error loading song ${songId}:`, error);
    return null;
  }
}

/**
 * Load a .sm file from the public folder
 */
export async function loadSmSong(entry: SongManifestEntry): Promise<Song | null> {
  try {
    const smUrl = `songs/${entry.path}/${entry.smFile}`;
    const response = await fetch(smUrl);

    if (!response.ok) {
      console.error(`Failed to load .sm file: ${smUrl}`);
      return null;
    }

    const content = await response.text();
    const songId = entry.path.replace(/\//g, '_');
    const { song, errors } = parseSmFile(content, songId, `songs/${entry.path}`);

    if (errors.length > 0) {
      console.warn(`Parse warnings for ${entry.path}:`, errors);
    }

    if (song) {
      song.pack = entry.pack;
    }

    return song;
  } catch (error) {
    console.error(`Error loading song ${entry.path}:`, error);
    return null;
  }
}

/**
 * Load all available songs from the manifest
 */
export async function loadAllSongs(): Promise<Song[]> {
  const songs: Song[] = [];

  try {
    // Load manifest
    const manifestResponse = await fetch('songs/manifest.json');
    if (manifestResponse.ok) {
      const manifest: SongManifest = await manifestResponse.json();
      console.log(`Loading ${manifest.songs.length} songs from manifest...`);

      // Load each song from manifest
      for (const entry of manifest.songs) {
        const song = await loadSmSong(entry);
        if (song) {
          songs.push(song);
        }
      }
    } else {
      console.log('No songs manifest found, using demo songs only');
    }
  } catch (error) {
    console.warn('Failed to load songs manifest:', error);
  }

  return songs;
}

