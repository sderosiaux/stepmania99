import { defineConfig, type Plugin, type Connect } from 'vite';
import { resolve, join, extname, normalize } from 'path';
import fs from 'fs';

const BASE = '/stepmania99/';
const PUBLIC = resolve(__dirname, 'public');

/**
 * Song packs in public/songs are often symlinks to a local StepMania/OutFox install (gigabytes).
 * The build copies public/ without following them; dev and `vite preview` serve public/songs live instead.
 * Vite's own public middleware decodes with decodeURI, which leaves %23 %26 %2B %2C %3D %40 encoded:
 * songs named "Theme #1.mp3" or "Stop! & Go" would 404 there.
 */
function linkedSongPacks(): Plugin {
  const MIME: Record<string, string> = {
    '.json': 'application/json',
    '.sm': 'text/plain; charset=utf-8',
    '.ssc': 'text/plain; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.wav': 'audio/wav',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
  };
  const songs = join(PUBLIC, 'songs');
  // A miss is a 404, not the SPA's index.html: it would otherwise reach the simfile parser or decodeAudioData
  const serveSongs = (middlewares: Connect.Server): void => {
    middlewares.use(`${BASE}songs`, (req, res) => {
      let file: string | null = null;
      try {
        file = normalize(join(songs, decodeURIComponent((req.url ?? '/').split('?')[0]!)));
      } catch {
        // malformed percent-encoding
      }
      if (!file || !file.startsWith(songs) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      fs.createReadStream(file).pipe(res);
    });
  };
  let outDir = 'dist';
  return {
    name: 'linked-song-packs',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    writeBundle() {
      fs.cpSync(PUBLIC, outDir, {
        recursive: true,
        filter: (src) => !fs.lstatSync(src).isSymbolicLink(),
      });
    },
    configureServer(server) {
      serveSongs(server.middlewares);
    },
    configurePreviewServer(server) {
      serveSongs(server.middlewares);
    },
  };
}

export default defineConfig({
  base: BASE,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [linkedSongPacks()],
  build: {
    target: 'ES2022',
    outDir: 'dist',
    sourcemap: true,
    copyPublicDir: false,
  },
  server: {
    port: 3000,
    open: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
