import { app, BrowserWindow, net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanSongLibrary, describeLibrary, type ScanCache, type SongLibrary } from '../scripts/song-library';

// ============================================================================
// Desktop shell: the web build served from app://, songs read straight from
// disk. No dev server, no symlinks, no browser chrome to take Tab or focus.
//
// Song folders come from library.json in the app's data folder (OutFox's
// Songs by default), then the songs bundled with the game.
// ============================================================================

/** Set by scripts/build-app.ts: a new build may parse differently, so it rescans */
declare const __BUILD_ID__: string;

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://game`;
/** The web build's base path (vite.config.ts) */
const BASE = '/stepmania99/';
const DIST = path.join(__dirname, '..', 'dist');
const DEFAULT_SONG_DIRS = ['/Applications/OutFox/Songs'];

/** --background: never on screen, muted, no Dock icon, its own profile. For automated checks while the machine is in use. */
const BACKGROUND = process.argv.includes('--background');

// Full speed when the window is hidden or another app has focus (jukebox, alt-tab mid-song),
// and audio may start before the first key press
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

if (BACKGROUND) {
  app.setPath('userData', path.join(app.getPath('temp'), 'stepmania99-background'));
  app.dock?.hide();
}

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// --------------------------------------------------------------------------
// Song library
// --------------------------------------------------------------------------

function songDirs(): string[] {
  const file = path.join(app.getPath('userData'), 'library.json');
  let dirs = DEFAULT_SONG_DIRS;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { songDirs?: unknown };
    if (Array.isArray(parsed.songDirs)) dirs = parsed.songDirs.filter((d): d is string => typeof d === 'string');
  } catch (e) {
    // First launch: write the defaults, so there is a file to edit
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') fs.writeFileSync(file, `${JSON.stringify({ songDirs: DEFAULT_SONG_DIRS }, null, 2)}\n`);
    else console.error(`${file} is not valid JSON: using the default song folders`, e);
  }
  return [...dirs, path.join(DIST, 'songs')];
}

async function loadLibrary(): Promise<SongLibrary> {
  const cacheFile = path.join(app.getPath('userData'), 'library-cache.json');
  let cache: ScanCache | null = null;
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as ScanCache;
  } catch {
    // First launch or unreadable: full scan
  }
  const t0 = performance.now();
  const { library, cache: next } = await scanSongLibrary(songDirs(), { cache, build: __BUILD_ID__, yieldEveryMs: 8 });
  console.log(`${describeLibrary(library)}, scanned in ${Math.round(performance.now() - t0)} ms`);
  fs.writeFile(cacheFile, JSON.stringify(next), (e) => e && console.error('Could not write the library cache', e));
  return library;
}

// --------------------------------------------------------------------------
// app:// — the build from dist/, the manifest from the scan, songs from their pack's folder
// --------------------------------------------------------------------------

const notFound = (): Response => new Response(null, { status: 404 });

/** A file under `root`, never outside it (a decoded URL can carry ../) */
async function serveFile(root: string, rel: string): Promise<Response> {
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) return notFound();
  try {
    return await net.fetch(pathToFileURL(file).toString());
  } catch {
    return notFound();
  }
}

function serve(library: Promise<SongLibrary>): void {
  protocol.handle(SCHEME, async (req) => {
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(req.url).pathname);
    } catch {
      return notFound(); // malformed percent-encoding
    }
    if (!rel.startsWith(BASE)) return notFound();
    rel = rel.slice(BASE.length);
    if (rel === 'songs/manifest.json') return Response.json((await library).manifest);
    if (rel === 'songs/patterns.json') return Response.json((await library).patterns);
    if (rel.startsWith('songs/')) {
      const songRel = rel.slice('songs/'.length);
      const root = (await library).packRoots.get(songRel.split('/')[0]!);
      return root ? serveFile(root, songRel) : notFound();
    }
    return serveFile(DIST, rel || 'index.html');
  });
}

// --------------------------------------------------------------------------
// Window
// --------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    ...(BACKGROUND ? {} : { fullscreen: true }),
    // index.html's theme-color: no white flash before the first frame
    backgroundColor: '#05040d',
    title: 'StepMania 99',
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) e.preventDefault();
  });
  if (BACKGROUND) win.webContents.setAudioMuted(true);
  else win.once('ready-to-show', () => win.show());
  void win.loadURL(`${ORIGIN}${BASE}`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(() => {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const library = loadLibrary();
    library.catch((e) => console.error('Song library scan failed', e));
    serve(library);
    win = createWindow();
  });
}
