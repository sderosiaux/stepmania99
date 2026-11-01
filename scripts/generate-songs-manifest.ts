/**
 * Scan public/songs (following symlinked packs) and write public/songs/manifest.json,
 * the song list the web build serves. The desktop app scans its own folders at startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSongLibrary, describeLibrary } from './song-library';

const songsDir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'public', 'songs');

const { library } = await scanSongLibrary([songsDir]);
fs.mkdirSync(songsDir, { recursive: true });
fs.writeFileSync(path.join(songsDir, 'manifest.json'), JSON.stringify(library.manifest));
console.log(describeLibrary(library));
