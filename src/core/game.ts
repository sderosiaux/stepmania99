import type { Song, Chart, Note, GameplayState, Settings, ResultsData } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { audioManager } from '../audio';
import { inputManager } from '../input';
import { Renderer } from '../render';
import { findMatchingNote, judgeNote, isNoteMissed } from './timing';
import { createScoreState, applyJudgment, calculateFinalScore, generateResults, type ScoreState } from './score';

// ============================================================================
// Game Controller
// ============================================================================

export type GameEventType = 'judgment' | 'combo-break' | 'song-end' | 'song-fail' | 'pause' | 'resume';

export interface GameEvent {
  type: GameEventType;
  data?: unknown;
}

export type GameEventListener = (event: GameEvent) => void;

export class GameController {
  private renderer: Renderer;
  private settings: Settings;

  /** Current gameplay state */
  private state: GameplayState | null = null;

  /** Score tracking */
  private scoreState: ScoreState | null = null;

  /** Animation frame ID */
  private frameId: number | null = null;

  /** Game timing - when we started (performance.now) */
  private gameStartTime: number = 0;

  /** Offset to apply to performance.now() timing */
  private perfTimeOffset: number = 0;

  /** Offset to apply to audio time (just the song offset) */
  private audioTimeOffset: number = 0;

  /** Preparation time before first note (ms) - lets arrows scroll up from bottom */
  private readonly PREP_TIME: number = 3000;

  /** Time when paused (for freezing game time) */
  private pauseTime: number = 0;

  /** Total time spent paused (to adjust game clock) */
  private totalPauseDuration: number = 0;

  /** Is game running */
  private running: boolean = false;

  /** Event listeners */
  private listeners: GameEventListener[] = [];

  /** Countdown state */
  private countdown: { active: boolean; count: number; startTime: number; isResume: boolean } = {
    active: false,
    count: 3,
    startTime: 0,
    isResume: false,
  };

  /** Whether audio is available for this song */
  private hasAudio: boolean = false;

  /** Demo/autoplay mode */
  private autoplay: boolean = false;

  constructor(canvas: HTMLCanvasElement, settings: Settings = DEFAULT_SETTINGS) {
    this.renderer = new Renderer(canvas);
    this.settings = settings;
  }

  /**
   * Add event listener
   */
  addEventListener(listener: GameEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: GameEventListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Emit event to listeners
   */
  private emit(event: GameEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Start a new game with the given song and chart
   */
  async start(song: Song, chart: Chart, autoplay: boolean = false): Promise<void> {
    this.autoplay = autoplay;
    // Try to load audio (may fail for demo songs)
    this.hasAudio = false;
    try {
      // Use basePath if available (for .sm files), otherwise use song id
      const audioPath = song.basePath
        ? `${song.basePath}/${song.musicFile}`
        : `songs/${song.id}/${song.musicFile}`;
      await audioManager.load(audioPath);
      this.hasAudio = true;
    } catch (error) {
      console.warn('Audio not available, running in silent mode:', error);
      this.hasAudio = false;
    }

    // Create fresh notes array (deep clone to avoid mutating original)
    const activeNotes: Note[] = chart.notes.map((n) => {
      const note: Note = {
        ...n,
        judged: false,
      };
      if (n.type === 'hold') {
        note.holdState = {
          isHeld: false,
          started: false,
          completed: false,
          dropped: false,
          progress: 0,
        };
      }
      return note;
    });

    // Initialize state
    this.state = {
      song,
      chart,
      activeNotes,
      judgments: [],
      score: 0,
      combo: 0,
      maxCombo: 0,
      startTime: 0,
      paused: false,
      ended: false,
    };

    this.scoreState = createScoreState(chart.notes.length);

    // Reset timing stats and pause tracking for new game
    this.renderer.resetTimings();
    this.renderer.setAudioOffset(this.settings.audioOffset);
    this.pauseTime = 0;
    this.totalPauseDuration = 0;

    // Start input listening
    inputManager.start();

    // Start countdown
    this.countdown = {
      active: true,
      count: 3,
      startTime: performance.now(),
      isResume: false,
    };

    this.running = true;
    this.frameId = requestAnimationFrame(this.loop.bind(this));
  }

  /**
   * Main game loop
   */
  private loop(timestamp: number): void {
    if (!this.running || !this.state) return;

    // Handle countdown
    if (this.countdown.active) {
      this.handleCountdown(timestamp);
      this.frameId = requestAnimationFrame(this.loop.bind(this));
      return;
    }

    // Handle pause
    if (this.state.paused) {
      this.renderer.renderGameplay(
        this.state,
        this.getCurrentGameTime(),
        new Set(inputManager.getHeldDirections()),
        this.settings.cmod,
        this.scoreState?.health ?? 50
      );
      this.frameId = requestAnimationFrame(this.loop.bind(this));
      return;
    }

    // Get current game time (synced to audio)
    const currentTime = this.getCurrentGameTime();

    // Handle autoplay mode
    if (this.autoplay) {
      this.processAutoplay(currentTime);
    }

    // Process inputs (skip in autoplay)
    if (!this.autoplay) {
      this.processInputs(currentTime);
    }

    // Update hold notes
    this.updateHolds(currentTime);

    // Check for missed notes
    this.checkMisses(currentTime);

    // Update score display
    if (this.scoreState) {
      this.state.score = calculateFinalScore(this.scoreState);

      // Check for lifebar fail
      if (this.scoreState.failed && !this.state.ended) {
        this.failSong();
        return;
      }
    }

    // Check for song end
    this.checkSongEnd(currentTime);

    // Render
    this.renderer.renderGameplay(
      this.state,
      currentTime,
      new Set(inputManager.getHeldDirections()),
      this.settings.cmod,
      this.scoreState?.health ?? 50,
      this.autoplay
    );

    // Continue loop
    if (this.running && !this.state.ended) {
      this.frameId = requestAnimationFrame(this.loop.bind(this));
    }
  }

  /**
   * Handle countdown before song starts
   */
  private handleCountdown(timestamp: number): void {
    const elapsed = timestamp - this.countdown.startTime;
    const countdownDuration = 1000; // 1 second per count

    const currentCount = 3 - Math.floor(elapsed / countdownDuration);

    if (currentCount <= 0) {
      // Countdown finished
      this.countdown.active = false;

      if (this.countdown.isResume) {
        // Resume: calculate total pause duration and resume audio
        if (this.pauseTime > 0) {
          this.totalPauseDuration += performance.now() - this.pauseTime;
          this.pauseTime = 0;
        }
        if (this.hasAudio) {
          audioManager.resume();
        }
      } else {
        // Initial start: set up timing
        this.gameStartTime = performance.now();

        // For performance.now() timing: starts at -PREP_TIME and increases
        // Game time 0 = when beat 0 occurs = PREP_TIME after gameStartTime
        this.perfTimeOffset = this.state!.song.offset + this.settings.audioOffset - this.PREP_TIME;

        // For audio timing: audio time 0 = game time (song.offset)
        // Because audio.play() is called at PREP_TIME, when game time should be 0
        this.audioTimeOffset = this.state!.song.offset + this.settings.audioOffset;

        // Delay audio start by prep time (only if audio is available)
        if (this.hasAudio) {
          setTimeout(() => {
            if (this.running && !this.state?.paused) {
              // Start audio at time 0 (offset is already baked into note times)
              audioManager.play(0);
            }
          }, this.PREP_TIME);
        }
      }
    } else {
      this.countdown.count = currentCount;
    }

    // Render countdown
    this.renderer.clear();
    this.renderer.drawLanes();
    this.renderer.drawReceptors(timestamp, new Set());
    this.renderer.drawCountdown(this.countdown.count);
  }

  /**
   * Get current game time in milliseconds
   */
  private getCurrentGameTime(): number {
    if (this.countdown.active) return -this.PREP_TIME - 1000;

    // When paused, return the frozen pause time (use perf timing)
    if (this.state?.paused && this.pauseTime > 0) {
      return this.pauseTime - this.gameStartTime - this.totalPauseDuration + this.perfTimeOffset;
    }

    // Use audio time as master clock when playing (if audio is available)
    if (this.hasAudio && audioManager.isPlaying) {
      // Audio time 0 = game time (song.offset), which is usually 0
      return audioManager.getCurrentTimeMs() + this.audioTimeOffset;
    }

    // Fallback to performance timing (always used in silent mode)
    return performance.now() - this.gameStartTime - this.totalPauseDuration + this.perfTimeOffset;
  }

  /**
   * Process buffered inputs
   */
  private processInputs(currentTime: number): void {
    if (!this.state || !this.scoreState) return;

    const inputs = inputManager.flush();
    const now = performance.now();

    for (const input of inputs) {
      if (!input.pressed) continue; // Only process key presses

      // Calculate input game time
      // When audio is playing, use audio time minus the delta since input happened
      // This keeps input timing in sync with audio playback
      let inputGameTime: number;
      if (this.hasAudio && audioManager.isPlaying) {
        const timeSinceInput = now - input.timestamp;
        inputGameTime = currentTime - timeSinceInput;
      } else {
        // Fallback to performance timing
        inputGameTime = input.timestamp - this.gameStartTime - this.totalPauseDuration + this.perfTimeOffset;
      }

      // Find matching note (check both tap and hold note heads)
      const note = findMatchingNote(this.state.activeNotes, input.direction, inputGameTime);

      if (note) {
        // Judge the note head
        const judgment = judgeNote(note, inputGameTime);

        // For hold notes, start the hold instead of marking as fully judged
        if (note.type === 'hold' && note.holdState) {
          note.holdState.started = true;
          note.holdState.isHeld = true;
          // Don't mark as judged yet - will be judged when completed or dropped

          this.state.judgments.push(judgment);

          // Update score for the head hit
          const prevCombo = this.scoreState.combo;
          this.scoreState = applyJudgment(this.scoreState, judgment);

          // Update state
          this.state.combo = this.scoreState.combo;
          this.state.maxCombo = this.scoreState.maxCombo;

          // Trigger visual feedback
          this.renderer.triggerReceptorGlow(input.direction, currentTime);
          this.renderer.triggerBackgroundFlash(input.direction, currentTime);
          this.renderer.setJudgment(judgment.grade, currentTime, judgment.timingDiff);
          this.renderer.addHitEffect(input.direction, judgment.grade, currentTime);

          // Record timing for per-direction stats (skip misses)
          if (judgment.grade !== 'miss') {
            this.renderer.recordTiming(input.direction, judgment.timingDiff);
          }

          // Emit events
          this.emit({ type: 'judgment', data: judgment });

          if (prevCombo > 0 && this.scoreState.combo === 0) {
            this.emit({ type: 'combo-break' });
          }
        } else {
          // Regular tap note
          note.judged = true;
          note.judgment = judgment;

          this.state.judgments.push(judgment);

          // Update score
          const prevCombo = this.scoreState.combo;
          this.scoreState = applyJudgment(this.scoreState, judgment);

          // Update state
          this.state.combo = this.scoreState.combo;
          this.state.maxCombo = this.scoreState.maxCombo;

          // Trigger visual feedback
          this.renderer.triggerReceptorGlow(input.direction, currentTime);
          this.renderer.triggerBackgroundFlash(input.direction, currentTime);
          this.renderer.setJudgment(judgment.grade, currentTime, judgment.timingDiff);
          this.renderer.addHitEffect(input.direction, judgment.grade, currentTime);

          // Record timing for per-direction stats (skip misses)
          if (judgment.grade !== 'miss') {
            this.renderer.recordTiming(input.direction, judgment.timingDiff);
          }

          // Emit events
          this.emit({ type: 'judgment', data: judgment });

          if (prevCombo > 0 && this.scoreState.combo === 0) {
            this.emit({ type: 'combo-break' });
          }
        }
      } else {
        // No matching note - still show receptor press and flash
        this.renderer.triggerReceptorGlow(input.direction, currentTime);
        this.renderer.triggerBackgroundFlash(input.direction, currentTime);
      }
    }
  }

  /**
   * Process autoplay - auto-hit notes at perfect timing
   */
  private processAutoplay(currentTime: number): void {
    if (!this.state || !this.scoreState) return;

    // Hit notes that are at the current time (within a small window)
    for (const note of this.state.activeNotes) {
      if (note.judged) continue;

      // For hold notes that haven't started yet
      if (note.type === 'hold' && note.holdState && !note.holdState.started) {
        const timeDiff = currentTime - note.time;
        if (timeDiff >= -5 && timeDiff <= 20) {
          // Start the hold
          note.holdState.started = true;
          note.holdState.isHeld = true;

          // Create a "marvelous" judgment for the head hit
          const judgment = {
            noteId: note.id,
            timingDiff: Math.random() * 10 - 5,
            grade: 'marvelous' as const,
            time: currentTime,
          };

          this.state.judgments.push(judgment);

          // Update score
          this.scoreState = applyJudgment(this.scoreState, judgment);
          this.state.combo = this.scoreState.combo;
          this.state.maxCombo = this.scoreState.maxCombo;

          // Trigger visual feedback
          this.renderer.triggerReceptorGlow(note.direction, currentTime);
          this.renderer.triggerBackgroundFlash(note.direction, currentTime);
          this.renderer.setJudgment(judgment.grade, currentTime, judgment.timingDiff);
          this.renderer.addHitEffect(note.direction, judgment.grade, currentTime);

          // Emit events
          this.emit({ type: 'judgment', data: judgment });
        }
        continue;
      }

      // For active holds in autoplay - keep them held until completion
      if (note.type === 'hold' && note.holdState?.started && !note.holdState?.completed) {
        note.holdState.isHeld = true;
        continue;
      }

      // For tap notes
      if (note.type !== 'hold') {
        // Auto-hit notes that are within 5ms of current time (nearly perfect)
        const timeDiff = currentTime - note.time;
        if (timeDiff >= -5 && timeDiff <= 20) {
          // Create a "marvelous" judgment with tiny timing diff
          const judgment = {
            noteId: note.id,
            timingDiff: Math.random() * 10 - 5, // Slight variation for realism
            grade: 'marvelous' as const,
            time: currentTime,
          };

          note.judged = true;
          note.judgment = judgment;

          this.state.judgments.push(judgment);

          // Update score
          this.scoreState = applyJudgment(this.scoreState, judgment);
          this.state.combo = this.scoreState.combo;
          this.state.maxCombo = this.scoreState.maxCombo;

          // Trigger visual feedback
          this.renderer.triggerReceptorGlow(note.direction, currentTime);
          this.renderer.triggerBackgroundFlash(note.direction, currentTime);
          this.renderer.setJudgment(judgment.grade, currentTime, judgment.timingDiff);
          this.renderer.addHitEffect(note.direction, judgment.grade, currentTime);

          // Emit events
          this.emit({ type: 'judgment', data: judgment });
        }
      }
    }
  }

  /**
   * Check for missed notes
   */
  private checkMisses(currentTime: number): void {
    if (!this.state || !this.scoreState) return;

    for (const note of this.state.activeNotes) {
      if (note.judged) continue;

      // For hold notes, only check the head timing
      if (note.type === 'hold' && note.holdState?.started) continue;

      if (isNoteMissed(note.time, currentTime)) {
        note.judged = true;

        // For hold notes, also mark as dropped
        if (note.type === 'hold' && note.holdState) {
          note.holdState.dropped = true;
        }

        const judgment = {
          noteId: note.id,
          timingDiff: currentTime - note.time,
          grade: 'miss' as const,
          time: currentTime,
        };

        note.judgment = judgment;
        this.state.judgments.push(judgment);

        // Update score
        const prevCombo = this.scoreState.combo;
        this.scoreState = applyJudgment(this.scoreState, judgment);

        this.state.combo = this.scoreState.combo;
        this.state.maxCombo = this.scoreState.maxCombo;

        // Visual feedback
        this.renderer.setJudgment('miss', currentTime);

        // Emit events
        this.emit({ type: 'judgment', data: judgment });

        if (prevCombo > 0) {
          this.emit({ type: 'combo-break' });
        }
      }
    }
  }

  /**
   * Update hold notes - check if still being held, mark completed or dropped
   */
  private updateHolds(currentTime: number): void {
    if (!this.state || !this.scoreState) return;

    const heldDirections = inputManager.getHeldDirections();

    for (const note of this.state.activeNotes) {
      if (note.type !== 'hold') continue;
      if (!note.holdState) continue;
      if (note.holdState.completed || note.holdState.dropped) continue;

      // Update isHeld status
      const isCurrentlyHeld = heldDirections.includes(note.direction);
      note.holdState.isHeld = isCurrentlyHeld;

      // If hold has started, check for drop or completion
      if (note.holdState.started) {
        // Calculate progress
        const endTime = note.endTime ?? note.time;
        const duration = endTime - note.time;
        note.holdState.progress = Math.min(1, (currentTime - note.time) / duration);

        // Grace window for releasing hold (generous window for comfort)
        const holdGraceWindow = 200;

        // Check for release
        if (!isCurrentlyHeld) {
          const timeUntilEnd = endTime - currentTime;

          if (timeUntilEnd > holdGraceWindow) {
            // Released too early - dropped the hold
            note.holdState.dropped = true;
            note.judged = true;

            const judgment = {
              noteId: note.id,
              timingDiff: currentTime - endTime,
              grade: 'boo' as const,
              time: currentTime,
            };

            this.state.judgments.push(judgment);

            // Update score
            const prevCombo = this.scoreState.combo;
            this.scoreState = applyJudgment(this.scoreState, judgment);

            this.state.combo = this.scoreState.combo;
            this.state.maxCombo = this.scoreState.maxCombo;

            // Visual feedback
            this.renderer.setJudgment('boo', currentTime);

            // Emit events
            this.emit({ type: 'judgment', data: judgment });

            if (prevCombo > 0) {
              this.emit({ type: 'combo-break' });
            }
          } else {
            // Released within grace window - complete the hold successfully
            note.holdState.completed = true;
            note.holdState.progress = 1;
            note.judged = true;

            const judgment = {
              noteId: note.id,
              timingDiff: -timeUntilEnd, // Negative = early
              grade: 'perfect' as const,
              time: currentTime,
            };

            this.state.judgments.push(judgment);
            this.scoreState = applyJudgment(this.scoreState, judgment);
            this.state.combo = this.scoreState.combo;
            this.state.maxCombo = this.scoreState.maxCombo;

            this.renderer.setJudgment('perfect', currentTime, -timeUntilEnd);
            this.renderer.addHitEffect(note.direction, 'perfect', currentTime);
          }
        }

        // Check for completion (held all the way)
        if (currentTime >= endTime && !note.holdState.dropped && !note.holdState.completed) {
          note.holdState.completed = true;
          note.holdState.progress = 1;
          note.judged = true;

          // Award OK judgment for completing the hold
          const judgment = {
            noteId: note.id,
            timingDiff: 0,
            grade: 'perfect' as const, // Completing a hold gives perfect
            time: currentTime,
          };

          this.state.judgments.push(judgment);

          // Update score
          this.scoreState = applyJudgment(this.scoreState, judgment);

          this.state.combo = this.scoreState.combo;
          this.state.maxCombo = this.scoreState.maxCombo;

          // Visual feedback
          this.renderer.setJudgment('perfect', currentTime, 0);
          this.renderer.addHitEffect(note.direction, 'perfect', currentTime);
        }
      }
    }
  }

  /**
   * Check if song has ended
   */
  private checkSongEnd(currentTime: number): void {
    if (!this.state || !this.scoreState) return;

    // Force-complete any hold notes that are past their end time
    for (const note of this.state.activeNotes) {
      if (note.type !== 'hold' || !note.holdState) continue;
      if (note.judged || note.holdState.completed || note.holdState.dropped) continue;

      const endTime = note.endTime ?? note.time;
      if (currentTime > endTime + 200) {
        // Hold time passed - complete if started, miss if not
        if (note.holdState.started) {
          note.holdState.completed = true;
          note.holdState.progress = 1;
        } else {
          note.holdState.dropped = true;
        }
        note.judged = true;
      }
    }

    // Check if all notes are judged
    const allJudged = this.state.activeNotes.every((n) => n.judged);

    // Check if we've passed the last note by a margin (use endTime for holds)
    const lastNote = this.state.activeNotes[this.state.activeNotes.length - 1];
    const lastNoteEndTime = lastNote
      ? (lastNote.endTime ?? lastNote.time)
      : 0;
    const pastLastNote = lastNote ? currentTime > lastNoteEndTime + 2000 : true;

    // Check if audio has ended (only if we have audio)
    let pastAudioEnd = false;
    if (this.hasAudio) {
      const audioDuration = audioManager.getDurationMs();
      pastAudioEnd = audioDuration > 0 && currentTime > audioDuration + 1000;
    }

    if ((allJudged && pastLastNote) || pastAudioEnd) {
      this.endSong();
    }
  }

  /**
   * End the current song
   */
  private endSong(): void {
    if (!this.state || this.state.ended) return;

    this.state.ended = true;
    if (this.hasAudio) {
      audioManager.stop();
    }
    inputManager.stop();
    this.running = false;

    this.emit({ type: 'song-end', data: this.getResults() });
  }

  /**
   * Fail the song (lifebar depleted)
   */
  private failSong(): void {
    if (!this.state || this.state.ended) return;

    this.state.ended = true;
    if (this.hasAudio) {
      audioManager.stop();
    }
    inputManager.stop();
    this.running = false;

    this.emit({ type: 'song-fail', data: this.getResults() });
  }

  /**
   * Pause the game
   */
  pause(): void {
    if (!this.state || this.state.paused || this.state.ended || this.countdown.active) return;

    this.state.paused = true;
    this.pauseTime = performance.now(); // Record when we paused
    if (this.hasAudio) {
      audioManager.pause();
    }
    inputManager.clear();

    this.emit({ type: 'pause' });
  }

  /**
   * Resume the game
   */
  resume(): void {
    if (!this.state || !this.state.paused) return;

    // Start a short countdown before resuming
    // Note: pauseTime stays set - we'll calculate duration when countdown finishes
    this.countdown = {
      active: true,
      count: 3,
      startTime: performance.now(),
      isResume: true,
    };

    this.state.paused = false;

    // Audio will be resumed after countdown
  }

  /**
   * Toggle pause state
   */
  togglePause(): void {
    if (!this.state) return;

    if (this.state.paused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  /**
   * Stop the game completely
   */
  stop(): void {
    this.running = false;

    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    if (this.hasAudio) {
      audioManager.stop();
    }
    inputManager.stop();

    this.state = null;
    this.scoreState = null;
  }

  /**
   * Get current results
   */
  getResults(): ResultsData | null {
    if (!this.state || !this.scoreState) return null;

    const results = generateResults(this.scoreState, this.state.song, this.state.chart);
    // Add direction stats from renderer
    results.directionStats = this.renderer.getDirectionStats();
    return results;
  }

  /**
   * Check if game is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Check if game is paused
   */
  isPaused(): boolean {
    return this.state?.paused ?? false;
  }

  /**
   * Check if game is in countdown (either start or resume countdown)
   */
  isInCountdown(): boolean {
    return this.countdown.active;
  }

  /**
   * Update settings
   */
  setSettings(settings: Partial<Settings>): void {
    this.settings = { ...this.settings, ...settings };
  }
}
