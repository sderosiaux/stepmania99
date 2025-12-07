#!/usr/bin/env node

/**
 * Scans public/songs for .sm files and generates a manifest.
 *
 * Directory structure expected:
 *   public/songs/
 *     PackName/
 *       SongName/
 *         song.sm
 *         audio.mp3 (or .ogg)
 *         banner.png (optional)
 *         background.png (optional)
 *
 * Output: public/songs/manifest.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const songsDir = path.join(projectRoot, 'public', 'songs');
const manifestPath = path.join(songsDir, 'manifest.json');

function findSmFiles(dir, packName = '') {
  const entries = [];

  if (!fs.existsSync(dir)) {
    return entries;
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const subPath = path.join(dir, item.name);

    // Check if it's a directory (or a symlink to a directory)
    let isDir = item.isDirectory();
    if (item.isSymbolicLink()) {
      try {
        const stat = fs.statSync(subPath);
        isDir = stat.isDirectory();
      } catch {
        continue; // Broken symlink, skip
      }
    }

    if (isDir) {

      // Check if this directory contains a .sm file
      const filesInDir = fs.readdirSync(subPath);
      const smFile = filesInDir.find(f => f.endsWith('.sm'));

      if (smFile) {
        // This is a song directory
        const currentPack = packName || 'Uncategorized';
        entries.push({
          pack: currentPack,
          folder: item.name,
          smFile: smFile,
          path: packName ? `${packName}/${item.name}` : item.name,
        });
      } else {
        // This might be a pack directory, recurse
        const subEntries = findSmFiles(subPath, packName ? `${packName}/${item.name}` : item.name);
        entries.push(...subEntries);
      }
    }
  }

  return entries;
}

function generateManifest() {
  console.log('Scanning for songs in:', songsDir);

  const songs = findSmFiles(songsDir);

  if (songs.length === 0) {
    console.log('No songs found. Place .sm files in public/songs/PackName/SongName/');
  } else {
    console.log(`Found ${songs.length} song(s):`);
    for (const song of songs) {
      console.log(`  - ${song.pack}/${song.folder}`);
    }
  }

  const manifest = {
    version: 1,
    generated: new Date().toISOString(),
    songs: songs,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('Manifest written to:', manifestPath);
}

generateManifest();
