/**
 * Bundle the desktop app's main process (electron/main.ts + the song scanner) into dist-electron/main.cjs.
 * The build id lets the app drop its library cache when the parser may have changed.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  define: { __BUILD_ID__: JSON.stringify(String(Date.now())) },
  logLevel: 'warning',
});
