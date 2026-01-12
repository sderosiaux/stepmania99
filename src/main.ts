import type { Song, Chart, GameScreen, ResultsData, Settings, Difficulty } from './types';
import { DEFAULT_SETTINGS } from './types';
import { audioManager } from './audio';
import { GameController } from './core/game';
import { loadAllSongs } from './core/loader';
import { SongSelectScreen, saveScore } from './ui/song-select';
import { ResultsScreen } from './ui/results';
import { LobbyScreen } from './ui/lobby';
import { multiplayerClient, multiplayerGameManager } from './multiplayer';
import type { MultiplayerEvent } from './multiplayer';

// ============================================================================
// Main Application
// ============================================================================

class App {
  private canvas: HTMLCanvasElement;
  private uiContainer: HTMLElement;
  private loadingElement: HTMLElement;

  private gameController: GameController | null = null;
  private songSelectScreen: SongSelectScreen | null = null;
  private resultsScreen: ResultsScreen | null = null;
  private lobbyScreen: LobbyScreen | null = null;

  private currentScreen: GameScreen | 'lobby' = 'loading';
  private songs: Song[] = [];
  private lastPlayedSong: Song | null = null;
  private lastPlayedChart: Chart | null = null;
  private currentSettings: Settings = { ...DEFAULT_SETTINGS };

  /** Multiplayer mode active */
  private isMultiplayerMode: boolean = false;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.loadingElement = document.getElementById('loading') as HTMLElement;

    // Create UI container
    this.uiContainer = document.createElement('div');
    this.uiContainer.id = 'ui-container';
    document.getElementById('app')!.appendChild(this.uiContainer);

    // Initialize screens
    this.songSelectScreen = new SongSelectScreen(this.uiContainer, {
      onSongSelect: (song, chart, settings) => this.startGame(song, chart, settings),
      onDemo: (song, chart, settings) => this.startGame(song, chart, settings, true),
      onMultiplayer: () => this.showLobby(),
    });

    this.resultsScreen = new ResultsScreen(this.uiContainer, {
      onContinue: () => this.handleResultsContinue(),
      onRetry: () => this.retryLastSong(),
    });

    this.lobbyScreen = new LobbyScreen(this.uiContainer, {
      onStartGame: (songId, difficulty) => this.startMultiplayerGame(songId, difficulty),
      onCancel: () => this.showSongSelect(),
    });

    // Global keyboard handlers for pause/exit
    window.addEventListener('keydown', this.handleGlobalKeyDown.bind(this));
    window.addEventListener('keyup', this.handleGlobalKeyUp.bind(this));

    // Listen for multiplayer events
    multiplayerClient.addEventListener(this.handleMultiplayerEvent.bind(this));
  }

  /**
   * Initialize the application
   */
  async init(): Promise<void> {
    try {
      // Initialize audio in background (will activate on first user interaction)
      audioManager.init().catch(() => {
        // Audio init may fail until user interacts - that's fine
      });

      // Load songs from disk
      const loadedSongs = await loadAllSongs();

      // Use only real StepMania songs
      this.songs = loadedSongs;

      // Hide loading
      this.hideLoading();

      // Check for room code in URL (?room=ABC123)
      const urlParams = new URLSearchParams(window.location.search);
      const roomCode = urlParams.get('room');

      // Always show song select first
      this.showSongSelect();

      // If room code in URL, prompt to join
      if (roomCode) {
        this.songSelectScreen?.joinRoomFromUrl(roomCode);
      }
    } catch (error) {
      console.error('Failed to initialize:', error);
      this.showError('Failed to initialize. Please refresh the page.');
    }
  }

  /**
   * Hide loading screen
   */
  private hideLoading(): void {
    this.loadingElement.classList.add('hidden');
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    this.loadingElement.innerHTML = `
      <h1 style="color: #ff4444;">Error</h1>
      <p>${message}</p>
    `;
  }

  /**
   * Show song select screen
   */
  private showSongSelect(): void {
    this.currentScreen = 'song-select';
    this.isMultiplayerMode = false;
    this.canvas.classList.add('hidden');
    this.uiContainer.classList.remove('hidden');
    this.resultsScreen?.hide();
    this.lobbyScreen?.hide();
    this.songSelectScreen?.show(this.songs);
  }

  /**
   * Show multiplayer lobby
   * @param roomCode - Optional room code to pre-fill for joining
   */
  private showLobby(roomCode?: string): void {
    this.currentScreen = 'lobby';
    this.resultsScreen?.hide();
    this.songSelectScreen?.hide();
    this.lobbyScreen?.show(this.songs, roomCode);
  }

  /**
   * Handle multiplayer events
   */
  private handleMultiplayerEvent(event: MultiplayerEvent): void {
    if (event.type === 'game-ended' && this.isMultiplayerMode) {
      // Game ended - show results
      const results = this.gameController?.getResults();
      if (results) {
        this.showResults(results);
      }
    }
  }

  /**
   * Start a multiplayer game
   */
  private async startMultiplayerGame(songId: string, difficulty: Difficulty): Promise<void> {
    const song = this.songs.find(s => s.id === songId);
    if (!song) {
      console.error('Song not found:', songId);
      return;
    }

    const chart = song.charts.find(c => c.difficulty === difficulty);
    if (!chart) {
      console.error('Chart not found:', difficulty);
      return;
    }

    this.isMultiplayerMode = true;
    multiplayerGameManager.init();

    // Start the game
    await this.startGame(song, chart, {});
  }

  /**
   * Start a game
   */
  private async startGame(
    song: Song,
    chart: Chart,
    settings?: Partial<Settings>,
    autoplay: boolean = false
  ): Promise<void> {
    this.currentScreen = 'gameplay';
    this.lastPlayedSong = song;
    this.lastPlayedChart = chart;

    // Merge settings
    if (settings) {
      this.currentSettings = { ...this.currentSettings, ...settings };
    }

    // Hide UI, show canvas
    this.songSelectScreen?.hide();
    this.lobbyScreen?.hide();
    this.uiContainer.classList.add('hidden');
    this.canvas.classList.remove('hidden');

    // Create game controller with settings
    this.gameController = new GameController(this.canvas, this.currentSettings);

    // Listen for game events
    this.gameController.addEventListener((event) => {
      if (event.type === 'song-end' || event.type === 'song-fail') {
        this.showResults(event.data as ResultsData);
      }
    });

    // Start the game
    try {
      await this.gameController.start(song, chart, autoplay);
    } catch (error) {
      console.error('Failed to start game:', error);
      this.showSongSelect();
    }
  }

  /**
   * Show results screen
   */
  private showResults(results: ResultsData): void {
    this.currentScreen = 'results';
    this.gameController?.stop();
    this.gameController = null;

    // Save score to memory (only if not failed)
    if (!results.failed) {
      saveScore(results.song.id, results.chart.difficulty, {
        grade: results.grade,
        score: results.score,
        maxCombo: results.maxCombo,
        accuracy: results.percentage,
        date: Date.now(),
      });
    }

    this.canvas.classList.add('hidden');
    this.uiContainer.classList.remove('hidden');
    this.resultsScreen?.show(results);
  }

  /**
   * Handle continue from results screen
   * Returns to lobby if in multiplayer mode, otherwise to song select
   */
  private handleResultsContinue(): void {
    if (this.isMultiplayerMode) {
      // Return to lobby - player stays in room
      this.showLobby();
    } else {
      this.showSongSelect();
    }
  }

  /**
   * Retry the last played song
   */
  private retryLastSong(): void {
    if (this.lastPlayedSong && this.lastPlayedChart) {
      this.resultsScreen?.hide();
      this.startGame(this.lastPlayedSong, this.lastPlayedChart);
    }
  }

  /**
   * Handle global keydown events
   */
  private handleGlobalKeyDown(e: KeyboardEvent): void {
    if (this.currentScreen === 'gameplay' && this.gameController) {
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();

        // Ignore ESC during countdown
        if (this.gameController.isInCountdown()) {
          return;
        }

        if (this.gameController.isPaused()) {
          // Already paused - exit to song select
          this.gameController.stop();
          this.gameController = null;
          this.showSongSelect();
        } else {
          // Not paused - pause the game
          this.gameController.pause();
        }
      } else if (e.code === 'Enter' && this.gameController.isPaused()) {
        e.preventDefault();
        this.gameController.resume();
      }
    }
  }

  /**
   * Handle global keyup events
   */
  private handleGlobalKeyUp(_e: KeyboardEvent): void {
    // Reserved for future use
  }
}

// ============================================================================
// Bootstrap
// ============================================================================

const app = new App();
app.init().catch(console.error);
