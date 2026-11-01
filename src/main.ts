// Fonts are bundled, not fetched from Google: the game has to look right offline
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/chakra-petch/600-italic.css';
import '@fontsource/chakra-petch/700-italic.css';
import '@fontsource/orbitron/600.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/orbitron/900.css';
import './styles/base.css';
import './styles/hud.css';
import './styles/select.css';
import './styles/results.css';
import type { Difficulty, GameScreen, ResultsData, Settings } from './types';
import { audio } from './audio';
import { GameController } from './core/game';
import { loadManifest, loadSong } from './core/loader';
import { closestChart, type SongEntry } from './core/manifest';
import { Jukebox } from './core/jukebox';
import { buildTimingData, type TimingData } from './core/timing-data';
import { Stage } from './render/stage';
import { Hud } from './render/hud';
import { applyThemeVars } from './render/theme';
import { SongSelectScreen } from './ui/song-select';
import { ResultsScreen } from './ui/results';
import { CalibrationScreen } from './ui/calibration';
import { toast, escapeHtml } from './ui/dom';
import { loadSettings, saveSettings, submitScore, getBest, saveLastRunErrors, getForgotten, setForgotten } from './ui/storage';
import { multiplayerClient, multiplayerGameManager, type MultiplayerEvent } from './multiplayer';

// ============================================================================
// App shell: one WebGL stage behind everything, DOM screens on top.
// title → song select ⇄ gameplay → results, plus calibration.
// ============================================================================

const JUKEBOX_KEYS = '<span><kbd>←</kbd><kbd>→</kbd>Previous · Next</span><span><kbd>⌫</kbd>Not for me</span><span><kbd>U</kbd>Undo</span><span><kbd>Esc</kbd>Exit</span>';
/** Songs in a row that fail to load before the jukebox gives up */
const JUKEBOX_MAX_FAILURES = 5;
/** Hold Tab: menus run this many times faster, StepMania's fast-forward */
const TAB_WARP = 4;

class App {
  private readonly ui: HTMLElement;
  private readonly stage: Stage;
  private readonly hud: Hud;
  private readonly select: SongSelectScreen;
  private readonly results: ResultsScreen;
  private readonly calibration: CalibrationScreen;
  private game: GameController | null = null;

  private screen: GameScreen | 'title' = 'loading';
  private settings: Settings = loadSettings();
  private songs: SongEntry[] = [];
  private last: { entry: SongEntry; difficulty: Difficulty; autoplay: boolean; practice?: { from: number; to: number } } | null = null;
  private multiplayer = false;
  private escArmedUntil = 0;
  /** Set while the jukebox runs: `dropped` is this session's ⌫ history, for U */
  private jukebox: { box: Jukebox; difficulty: Difficulty; dropped: SongEntry[]; failures: number } | null = null;

  // Menu backdrop clock
  private menuLast = performance.now();
  /** Tab warp: time and beats gained on top of the music's clock while Tab is held */
  private warp = { scale: 1, time: 0, beats: 0, lastBeat: null as number | null };
  private previewTiming: { songId: string; timing: TimingData } | null = null;

  constructor() {
    applyThemeVars();
    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    this.ui = document.getElementById('ui') as HTMLElement;
    this.stage = new Stage(canvas);
    this.hud = new Hud(this.ui);
    this.select = new SongSelectScreen(this.ui, this.settings, {
      onPlay: (entry, difficulty, autoplay, practice) => void this.play(entry, difficulty, autoplay, false, practice),
      onCalibrate: () => this.showCalibration(),
      onSettings: (s) => this.updateSettings(s),
      onJukebox: (entries, difficulty) => this.startJukebox(entries, difficulty),
    });
    this.results = new ResultsScreen(this.ui, {
      onContinue: () => this.showSelect(),
      onRetry: () => this.last && void this.play(this.last.entry, this.last.difficulty, this.last.autoplay, false, this.last.practice),
      onApplyOffset: (d) => this.updateSettings({ ...this.settings, offsetMs: this.settings.offsetMs + d }),
    });
    this.calibration = new CalibrationScreen(this.ui, {
      onDone: (offset) => {
        if (offset !== null) this.updateSettings({ ...this.settings, offsetMs: offset });
        this.showSelect();
      },
    });

    window.addEventListener('resize', () => this.stage.resize());
    // Tab is StepMania's fast-forward. Left alone, it walks the focus out to the browser's address bar
    // and the game stops hearing the keyboard; only the multiplayer modal keeps it, to move between its fields.
    // Capture phase: the search box stops its keys from bubbling.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'Tab' || (e.target as Element | null)?.closest?.('.modal')) return;
        e.preventDefault();
        this.setWarp(TAB_WARP);
      },
      true
    );
    window.addEventListener('keyup', (e) => e.code === 'Tab' && this.setWarp(1), true);
    // Released outside the window: no keyup ever comes
    window.addEventListener('blur', () => this.setWarp(1));
    window.addEventListener('keydown', this.onKey);
    multiplayerClient.addEventListener(this.onMultiplayer);
  }

  async init(): Promise<void> {
    const loading = document.getElementById('loading')!;
    try {
      this.songs = await loadManifest();
    } catch (e) {
      console.error(e);
    }
    loading.classList.add('hidden');
    this.showTitle();
    this.menuLoop();
  }

  // --------------------------------------------------------------------------
  // Screens
  // --------------------------------------------------------------------------

  private showTitle(): void {
    this.screen = 'title';
    const title = document.createElement('div');
    title.className = 'title-screen';
    // A shared song link lands on that song: the click is still needed to unlock audio, but no attract-mode intro
    const params = new URLSearchParams(window.location.search);
    const linked = this.songs.find((s) => s.id === params.get('song'));
    const diff = linked?.charts.find((c) => c.difficulty === params.get('diff')) ?? linked?.charts[linked.charts.length - 1];
    title.innerHTML = linked
      ? `
      <div class="title-linked">
        <div class="title-linked-pack">${escapeHtml(linked.pack)}</div>
        <div class="title-linked-song">${escapeHtml(linked.title)}</div>
        <div class="title-linked-artist">${escapeHtml(linked.artist)}${diff ? ` · <b data-diff="${diff.difficulty}">${diff.difficulty.toUpperCase()} ${diff.level}</b>` : ''}</div>
      </div>
      <button class="title-start">PRESS <kbd>ENTER</kbd></button>
      <p class="title-foot">STEPMANIA 99 · headphones recommended</p>`
      : `
      <div class="title-logo"><span class="title-step">STEPMANIA</span><span class="title-99" data-text="99">99</span></div>
      <p class="title-tag">Rhythm battle royale</p>
      <button class="title-start">PRESS <kbd>ENTER</kbd></button>
      <p class="title-foot">${this.songs.length} songs · headphones recommended</p>`;
    this.ui.appendChild(title);
    let started = false;
    const start = async () => {
      if (started) return;
      started = true;
      window.removeEventListener('keydown', onKey);
      await audio.unlock();
      audio.setVolumes({ music: this.settings.musicVolume, sfx: this.settings.sfxVolume, voice: this.settings.voiceVolume });
      await audio.loadSfx();
      if (linked) {
        audio.play1('ui-select');
      } else {
        audio.play1('ui-start');
        audio.playMenuMusic(1500);
        // The announcer lands on the music, not on silence
        setTimeout(() => audio.play1('vo-welcome', { duck: true, gain: 0.85 }), 900);
      }
      title.classList.add('leaving');
      setTimeout(() => {
        title.remove();
        this.afterTitle();
      }, 450);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        void start();
      }
    };
    window.addEventListener('keydown', onKey);
    title.querySelector('.title-start')!.addEventListener('click', () => void start());
  }

  /** Deep links: ?room=CODE joins a battle, ?song=<id>&diff=<Difficulty>&autoplay=1 starts a chart */
  private afterTitle(): void {
    const params = new URLSearchParams(window.location.search);
    this.showSelect();
    const room = params.get('room');
    if (room) void this.select.joinFromUrl(room);
    // ?song=<id>&diff=<Difficulty> focuses a chart; &play=1 starts it, &autoplay=1 starts the demo
    const songId = params.get('song');
    if (!songId) return;
    if (!this.select.focusSong(songId, params.get('diff'))) {
      toast(`"${songId}" is not in this song library`, 4000);
      return;
    }
    const cur = this.select.current;
    if (cur && (params.get('play') === '1' || params.get('autoplay') === '1')) void this.play(cur.entry, cur.meta.difficulty, params.get('autoplay') === '1');
  }

  private showSelect(): void {
    this.screen = 'song-select';
    this.multiplayer = false;
    this.results.hide();
    this.select.show(this.songs, this.settings);
  }

  private showCalibration(): void {
    this.screen = 'calibration';
    this.select.hide();
    audio.stopMenuMusic(300);
    void this.calibration.show(this.settings.offsetMs);
  }

  private async play(entry: SongEntry, difficulty: Difficulty, autoplay: boolean, multiplayer = false, practice?: { from: number; to: number }): Promise<void> {
    this.game?.stop();
    this.select.hide();
    this.results.hide();
    this.screen = 'gameplay';
    this.multiplayer = multiplayer;
    this.last = practice ? { entry, difficulty, autoplay, practice } : { entry, difficulty, autoplay };
    document.body.classList.add('in-game');
    this.hud.setKeys(this.jukebox ? JUKEBOX_KEYS : null);
    const game = new GameController(this.stage, this.hud, this.settings);
    this.game = game;
    game.onFinish = (r) => (this.jukebox ? this.jukeboxPlay(this.jukebox.box.next()) : this.showResults(r));
    try {
      const song = await loadSong(entry);
      const chart = song.charts.find((c) => c.difficulty === difficulty) ?? song.charts[0]!;
      if (this.game !== game) return;
      const best = getBest(song.id, chart.difficulty);
      await game.start(song, chart, {
        autoplay,
        multiplayer,
        jukebox: this.jukebox !== null,
        ...(practice ? { practice } : {}),
        paceCurve: best?.lossCurve ?? null,
        paceTarget: best ? { label: 'PB', percentage: best.percentage } : { label: 'AA', percentage: 93 },
      });
      if (this.jukebox && this.game === game) this.jukebox.failures = 0;
    } catch (e) {
      console.error('Failed to start', e);
      // Another song may have started meanwhile (a jukebox skip): it is not ours to tear down
      if (this.game !== game) return;
      this.game = null;
      document.body.classList.remove('in-game');
      if (this.jukebox && ++this.jukebox.failures < JUKEBOX_MAX_FAILURES) return this.jukeboxPlay(this.jukebox.box.next());
      this.jukebox = null;
      this.showSelect();
    }
  }

  // --------------------------------------------------------------------------
  // Jukebox: autoplay runs back to back; ⌫ drops a song for good (persisted)
  // --------------------------------------------------------------------------

  private startJukebox(entries: SongEntry[], difficulty: Difficulty): void {
    this.jukebox = { box: new Jukebox(entries, getForgotten), difficulty, dropped: [], failures: 0 };
    this.jukeboxPlay(this.jukebox.box.next());
  }

  private jukeboxPlay(entry: SongEntry | null): void {
    const j = this.jukebox;
    if (!j) return;
    if (!entry) {
      toast('Nothing left to play in this list: every song is skipped or has no audio', 4000);
      this.exitJukebox();
      return;
    }
    void this.play(entry, closestChart(entry, j.difficulty).difficulty, true);
  }

  /** ⌫: never pick this song again, on to the next */
  private jukeboxDrop(): void {
    const j = this.jukebox;
    const cur = j?.box.current;
    if (!j || !cur) return;
    setForgotten(cur.id, true);
    j.dropped.push(cur);
    toast(`"${cur.title}" won't come back · U to undo`, 3000);
    audio.play1('ui-back', { gain: 0.6 });
    this.jukeboxPlay(j.box.next());
  }

  /** U: bring back the last song dropped and play it now */
  private jukeboxUndo(): void {
    const j = this.jukebox;
    const back = j?.dropped.pop();
    if (!j || !back) return;
    setForgotten(back.id, false);
    toast(`"${back.title}" is back in the jukebox`, 2200);
    audio.play1('ui-select', { gain: 0.6 });
    this.jukeboxPlay(j.box.playNow(back));
  }

  /** Jukebox controls; false for any other key (V, Enter on pause… keep working) */
  private onJukeboxKey(code: string): boolean {
    switch (code) {
      case 'Backspace':
      case 'Delete':
        this.jukeboxDrop();
        return true;
      case 'ArrowRight':
        this.jukeboxPlay(this.jukebox?.box.next() ?? null);
        return true;
      case 'ArrowLeft': {
        // Already on the first song of the session: nothing to go back to
        const prev = this.jukebox?.box.previous();
        if (prev) this.jukeboxPlay(prev);
        return true;
      }
      case 'KeyU':
        this.jukeboxUndo();
        return true;
      case 'Escape':
        this.exitJukebox();
        return true;
      default:
        return false;
    }
  }

  /** Back to song select, on the song that was playing */
  private exitJukebox(): void {
    const j = this.jukebox;
    this.jukebox = null;
    this.hud.setKeys(null);
    this.game?.stop();
    this.game = null;
    document.body.classList.remove('in-game');
    audio.play1('ui-back');
    this.showSelect();
    const last = j?.box.current;
    if (j && last) this.select.focusSong(last.id, j.difficulty);
  }

  private showResults(r: ResultsData): void {
    this.game = null;
    document.body.classList.remove('in-game');
    this.screen = 'results';
    if (!r.autoplay) saveLastRunErrors(r.song.id, r.chart.difficulty, r.errors);
    const record = r.autoplay || r.failed || r.rate !== 1
      ? false
      : submitScore(r.song.id, r.chart.difficulty, {
          grade: r.grade,
          score: r.score,
          exScore: r.exScore,
          maxCombo: r.maxCombo,
          percentage: r.percentage,
          fullCombo: r.isFullCombo,
          date: Date.now(),
          lossCurve: r.lossCurve,
        });
    this.results.show(r, record, this.multiplayer);
    // Music comes back once the grade has been announced
    setTimeout(() => this.screen === 'results' && audio.playMenuMusic(2500), 3600);
  }

  private quitGame(): void {
    if (this.multiplayer) multiplayerGameManager.notifyDeath();
    this.game?.stop();
    this.game = null;
    document.body.classList.remove('in-game');
    audio.play1('ui-back');
    this.showSelect();
  }

  private updateSettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    audio.setVolumes({ music: s.musicVolume, sfx: s.sfxVolume, voice: s.voiceVolume });
    this.game?.setSettings(s);
    if (this.screen === 'song-select') this.select.show(this.songs, s);
  }

  // --------------------------------------------------------------------------
  // Global input (gameplay only; screens own their keys)
  // --------------------------------------------------------------------------

  private onKey = (e: KeyboardEvent) => {
    if (this.screen !== 'gameplay' || !this.game || e.repeat) return;
    if (this.jukebox && this.onJukeboxKey(e.code)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyV') {
      e.preventDefault();
      this.updateSettings({ ...this.settings, focus: !this.settings.focus });
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.game.isPaused) return this.quitGame();
      if (this.game.isResuming) return this.game.pause();
      if (this.game.canPause) return this.game.pause();
      if (this.multiplayer || this.last?.autoplay) {
        const now = performance.now();
        if (now < this.escArmedUntil || this.last?.autoplay) return this.quitGame();
        this.escArmedUntil = now + 1500;
        this.hud.message('ESC AGAIN TO QUIT', 'hint', 1500);
      }
    } else if (e.code === 'Enter' && this.game.isPaused) {
      e.preventDefault();
      this.game.resume();
    }
  };

  private onMultiplayer = (e: MultiplayerEvent) => {
    if (e.type === 'game-ended' && this.screen === 'gameplay' && this.multiplayer) {
      // Battle decided; the song plays out, the placement is announced now
      const me = multiplayerClient.getPlayerId();
      const placement = (e.data as { playerId: string; placement: number }[] | undefined)?.find((p) => p.playerId === me)?.placement;
      if (placement === 1) {
        audio.play1('clear-fanfare', { gain: 0.7 });
        this.hud.message('VICTORY', 'fc-perfect', 2600);
      } else if (placement) {
        this.hud.message(`#${placement}`, 'hint', 2000);
      }
      return;
    }
    if (e.type === 'game-started') {
      const room = multiplayerClient.getRoom();
      const entry = this.songs.find((s) => s.id === room?.songId);
      if (!entry || !room?.difficulty) {
        // Without the song we can't play: bow out so the room can still finish
        console.error('Battle song not found locally', room?.songId);
        multiplayerGameManager.notifyDeath();
        toast(`The host picked a song you don't have (${room?.songId ?? '?'}). You sit this round out.`, 5000);
        return;
      }
      multiplayerGameManager.init();
      void this.play(entry, room.difficulty, false, true);
    }
  };

  // --------------------------------------------------------------------------
  // Menu backdrop: beat-synced to the song preview
  // --------------------------------------------------------------------------

  private menuLoop = () => {
    requestAnimationFrame(this.menuLoop);
    if (this.screen === 'gameplay' || document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.menuLast) / 1000);
    this.menuLast = now;
    audio.sync();
    let beat = audio.menuBeatAt(now) ?? (now / 1000) * (96 / 60);
    const cur = this.screen === 'song-select' ? this.select.current : null;
    const previewMs = audio.previewTimeAt(now);
    if (cur && previewMs !== null) {
      if (this.previewTiming?.songId !== cur.entry.id) this.previewTiming = { songId: cur.entry.id, timing: buildTimingData(cur.entry.timing) };
      beat = this.previewTiming.timing.timeToBeat(previewMs);
    }
    const w = this.warp;
    const dBeat = w.lastBeat === null ? 0 : beat - w.lastBeat;
    w.lastBeat = beat;
    if (w.scale !== 1) {
      w.time += dt * (w.scale - 1);
      // At the music's tempo; a jump (preview loop, another song) is not tempo
      if (dBeat > 0 && dBeat < 1) w.beats += dBeat * (w.scale - 1);
      // CSS animations and transitions too, including ones that started since the last frame
      for (const a of document.getAnimations()) a.playbackRate = w.scale;
    }
    this.stage.renderMenu({ time: now / 1000 + w.time, beat: beat + w.beats, dt: dt * w.scale, energy: this.screen === 'results' ? 0.6 : 0.25 });
  };

  /** Tab held: the menus' pulse and animations run TAB_WARP× (the music keeps its tempo). Gameplay runs on the music's clock: untouched. */
  private setWarp(scale: number): void {
    const w = this.warp;
    if (w.scale === scale) return;
    w.scale = scale;
    if (scale !== 1) return;
    // Pulse back on the music's beats, not a fraction off
    w.beats = Math.round(w.beats);
    for (const a of document.getAnimations()) a.playbackRate = 1;
  }
}

const app = new App();
app.init().catch(console.error);
// Dev-only handle for automated timing/perf checks
if (import.meta.env.DEV) Object.assign(window, { __sm99: { app, audio } });
