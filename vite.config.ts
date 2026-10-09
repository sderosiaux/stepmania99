import { defineConfig, type Plugin } from 'vite';
import { resolve, join, extname, normalize } from 'path';
import fs from 'fs';

const BASE = '/stepmania99/';
const PUBLIC = resolve(__dirname, 'public');

/**
 * Song packs in public/songs are often symlinks to a local StepMania/OutFox install (gigabytes).
 * The build copies public/ without following them; `vite preview` serves public/songs live instead.
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
    configurePreviewServer(server) {
      const songs = join(PUBLIC, 'songs');
      server.middlewares.use(`${BASE}songs`, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        const file = normalize(join(songs, rel));
        if (!file.startsWith(songs) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(file).pipe(res);
      });
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
