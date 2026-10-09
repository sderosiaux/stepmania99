import './styles/base.css';
import './styles/hud.css';
import './styles/select.css';
import './styles/results.css';
import type { Difficulty, GameScreen, ResultsData, Settings } from './types';
import { audio } from './audio';
import { GameController } from './core/game';
import { loadManifest, loadSong } from './core/loader';
import type { SongEntry } from './core/manifest';
import { buildTimingData, type TimingData } from './core/timing-data';
import { Stage } from './render/stage';
import { Hud } from './render/hud';
import { applyThemeVars } from './render/theme';
import { SongSelectScreen } from './ui/song-select';
import { ResultsScreen } from './ui/results';
import { CalibrationScreen } from './ui/calibration';
import { toast } from './ui/dom';
import { loadSettings, saveSettings, submitScore, getBest, saveLastRunErrors } from './ui/storage';
import { multiplayerClient, multiplayerGameManager, type MultiplayerEvent } from './multiplayer';

// ============================================================================
// App shell: one WebGL stage behind everything, DOM screens on top.
// title → song select ⇄ gameplay → results, plus calibration.
// ============================================================================

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

  // Menu backdrop clock
  private menuLast = performance.now();
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
    title.innerHTML = `
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
      audio.play1('ui-start');
      audio.play1('vo-welcome');
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
    const songId = params.get('song');
    if (songId) {
      const entry = this.songs.find((s) => s.id === songId);
      const meta = entry?.charts.find((c) => c.difficulty === params.get('diff')) ?? entry?.charts[entry.charts.length - 1];
      if (entry && meta) void this.play(entry, meta.difficulty, params.get('autoplay') === '1');
    }
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
    const game = new GameController(this.stage, this.hud, this.settings);
    this.game = game;
    game.onFinish = (r) => this.showResults(r);
    try {
      const song = await loadSong(entry);
      const chart = song.charts.find((c) => c.difficulty === difficulty) ?? song.charts[0]!;
      if (this.game !== game) return;
      const best = getBest(song.id, chart.difficulty);
      await game.start(song, chart, {
        autoplay,
        multiplayer,
        ...(practice ? { practice } : {}),
        paceCurve: best?.lossCurve ?? null,
        paceTarget: best ? { label: 'PB', percentage: best.percentage } : { label: 'AA', percentage: 93 },
      });
    } catch (e) {
      console.error('Failed to start', e);
      this.game = null;
      document.body.classList.remove('in-game');
      this.showSelect();
    }
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
    let beat = (now / 1000) * (96 / 60);
    const cur = this.screen === 'song-select' ? this.select.current : null;
    const previewMs = audio.previewTimeAt(now);
    if (cur && previewMs !== null) {
      if (this.previewTiming?.songId !== cur.entry.id) this.previewTiming = { songId: cur.entry.id, timing: buildTimingData(cur.entry.timing) };
      beat = this.previewTiming.timing.timeToBeat(previewMs);
    }
    this.stage.renderMenu({ time: now / 1000, beat, dt, energy: this.screen === 'results' ? 0.6 : 0.25 });
  };
}

const app = new App();
app.init().catch(console.error);
// Dev-only handle for automated timing/perf checks
if (import.meta.env.DEV) Object.assign(window, { __sm99: { app, audio } });
