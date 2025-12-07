import type { Song, Chart, Settings, SongPack, Note } from '../types';
import { THEME } from '../render';
import { DEFAULT_SETTINGS } from '../types';
import { audioManager } from '../audio';

// ============================================================================
// BPM Display Helper
// ============================================================================

/**
 * Format BPM for display - shows min-max range for variable BPM songs
 */
function formatBpm(song: Song): string {
  if (!song.bpmChanges || song.bpmChanges.length <= 1) {
    // Single BPM - truncate decimals
    return `${Math.round(song.bpm)} BPM`;
  }

  // Multiple BPM changes - show min-max range
  const bpms = song.bpmChanges.map((c) => c.bpm);
  const minBpm = Math.round(Math.min(...bpms));
  const maxBpm = Math.round(Math.max(...bpms));

  if (minBpm === maxBpm) {
    return `${minBpm} BPM`;
  }

  return `${minBpm}-${maxBpm} BPM`;
}

// ============================================================================
// Chart Stats Calculator
// ============================================================================

interface ChartStats {
  totalNotes: number;
  taps: number;
  jumps: number;
  hands: number;
  quads: number;
  durationSec: number;
  nps: number;
  peakNps: number;
}

function calculateChartStats(notes: Note[]): ChartStats {
  if (notes.length === 0) {
    return { totalNotes: 0, taps: 0, jumps: 0, hands: 0, quads: 0, durationSec: 0, nps: 0, peakNps: 0 };
  }

  const notesByTime = new Map<number, Note[]>();
  for (const note of notes) {
    const time = Math.round(note.time);
    if (!notesByTime.has(time)) {
      notesByTime.set(time, []);
    }
    notesByTime.get(time)!.push(note);
  }

  let taps = 0, jumps = 0, hands = 0, quads = 0;

  for (const [, notesAtTime] of notesByTime) {
    const count = notesAtTime.length;
    if (count === 1) taps++;
    else if (count === 2) jumps++;
    else if (count === 3) hands++;
    else if (count >= 4) quads++;
  }

  const firstNote = notes[0]!;
  const lastNote = notes[notes.length - 1]!;
  const durationMs = lastNote.time - firstNote.time;
  const durationSec = Math.max(1, durationMs / 1000);
  const nps = notes.length / durationSec;

  let peakNps = 0;
  for (let windowStart = firstNote.time; windowStart <= lastNote.time; windowStart += 500) {
    const notesInWindow = notes.filter(n => n.time >= windowStart && n.time < windowStart + 1000);
    peakNps = Math.max(peakNps, notesInWindow.length);
  }

  return { totalNotes: notes.length, taps, jumps, hands, quads, durationSec, nps: Math.round(nps * 10) / 10, peakNps };
}

// ============================================================================
// Groove Radar Calculator
// ============================================================================

interface GrooveRadar {
  stream: number;   // Note density (0-100)
  voltage: number;  // Peak difficulty (0-100)
  air: number;      // Jumps/hands (0-100)
  freeze: number;   // Hold notes (0-100)
  chaos: number;    // Pattern complexity (0-100)
}

function calculateGrooveRadar(notes: Note[], durationSec: number): GrooveRadar {
  if (notes.length === 0 || durationSec <= 0) {
    return { stream: 0, voltage: 0, air: 0, freeze: 0, chaos: 0 };
  }

  const notesByTime = new Map<number, Note[]>();
  for (const note of notes) {
    const time = Math.round(note.time);
    if (!notesByTime.has(time)) {
      notesByTime.set(time, []);
    }
    notesByTime.get(time)!.push(note);
  }

  // Stream: Based on average NPS (normalized to 0-100, where 10 NPS = 100)
  const nps = notes.length / durationSec;
  const stream = Math.min(100, (nps / 10) * 100);

  // Voltage: Based on peak NPS (normalized, 15 NPS peak = 100)
  const firstNote = notes[0]!;
  const lastNote = notes[notes.length - 1]!;
  let peakNps = 0;
  for (let windowStart = firstNote.time; windowStart <= lastNote.time; windowStart += 500) {
    const notesInWindow = notes.filter(n => n.time >= windowStart && n.time < windowStart + 1000);
    peakNps = Math.max(peakNps, notesInWindow.length);
  }
  const voltage = Math.min(100, (peakNps / 15) * 100);

  // Air: Percentage of jumps/hands (notes with 2+ at same time)
  let jumpsAndHands = 0;
  for (const [, notesAtTime] of notesByTime) {
    if (notesAtTime.length >= 2) jumpsAndHands++;
  }
  const air = Math.min(100, (jumpsAndHands / notesByTime.size) * 200);

  // Freeze: Percentage of hold notes
  const holdNotes = notes.filter(n => n.type === 'hold').length;
  const freeze = Math.min(100, (holdNotes / notes.length) * 400);

  // Chaos: Based on timing variance (irregular patterns)
  const intervals: number[] = [];
  const sortedTimes = Array.from(notesByTime.keys()).sort((a, b) => a - b);
  for (let i = 1; i < sortedTimes.length; i++) {
    intervals.push(sortedTimes[i]! - sortedTimes[i - 1]!);
  }

  let chaos = 0;
  if (intervals.length > 0) {
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    // High stdDev = irregular patterns = high chaos
    chaos = Math.min(100, (stdDev / avgInterval) * 100);
  }

  return {
    stream: Math.round(stream),
    voltage: Math.round(voltage),
    air: Math.round(air),
    freeze: Math.round(freeze),
    chaos: Math.round(chaos),
  };
}

// ============================================================================
// Score Storage (in-memory)
// ============================================================================

interface ScoreRecord {
  grade: string;
  score: number;
  maxCombo: number;
  accuracy: number;
  date: number;
}

// Map of "songId-difficulty" -> best score
const scoreStorage = new Map<string, ScoreRecord>();

export function saveScore(songId: string, difficulty: string, record: ScoreRecord): void {
  const key = `${songId}-${difficulty}`;
  const existing = scoreStorage.get(key);
  if (!existing || record.score > existing.score) {
    scoreStorage.set(key, record);
  }
}

function getScore(songId: string, difficulty: string): ScoreRecord | null {
  return scoreStorage.get(`${songId}-${difficulty}`) ?? null;
}

// ============================================================================
// Song Select Screen - 3 Column Layout
// ============================================================================

export interface SongSelectCallbacks {
  onSongSelect: (song: Song, chart: Chart, settings: Partial<Settings>) => void;
  onDemo?: (song: Song, chart: Chart, settings: Partial<Settings>) => void;
  onBack?: () => void;
  onMultiplayer?: () => void;
}

const DIFFICULTY_FILTERS = ['All', 'Easy+', 'Medium+', 'Hard+', 'Challenge'] as const;
type DifficultyFilter = typeof DIFFICULTY_FILTERS[number];
const DIFFICULTY_ORDER = ['Beginner', 'Easy', 'Medium', 'Hard', 'Challenge'] as const;

export class SongSelectScreen {
  private container: HTMLElement;
  private allSongs: Song[] = [];
  private packs: SongPack[] = [];
  private selectedPackIndex: number = 0;
  private selectedSongIndex: number = 0;
  private selectedDifficultyIndex: number = 0;
  private cmod: number = DEFAULT_SETTINGS.cmod;
  private audioOffset: number = DEFAULT_SETTINGS.audioOffset;
  private difficultyFilter: DifficultyFilter = 'All';
  private activeColumn: 'packs' | 'songs' | 'difficulties' = 'packs';
  private callbacks: SongSelectCallbacks;
  private boundKeyHandler: (e: KeyboardEvent) => void;
  private boundKeyUpHandler: (e: KeyboardEvent) => void;
  private hasBeenShown: boolean = false;
  private pendingRadarData: GrooveRadar | null = null;
  private currentPreviewSongId: string | null = null;
  private previewDebounceTimer: number | null = null;

  constructor(container: HTMLElement, callbacks: SongSelectCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.boundKeyHandler = this.handleKey.bind(this);
    this.boundKeyUpHandler = this.handleKeyUp.bind(this);
    this.cmod = this.loadCmod();
    this.audioOffset = this.loadAudioOffset();
  }

  private loadCmod(): number {
    const saved = localStorage.getItem('cmod');
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 2000) return parsed;
    }
    return DEFAULT_SETTINGS.cmod;
  }

  private saveCmod(): void {
    localStorage.setItem('cmod', this.cmod.toString());
  }

  private loadAudioOffset(): number {
    const saved = localStorage.getItem('audioOffset');
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed)) return parsed;
    }
    return DEFAULT_SETTINGS.audioOffset;
  }

  private saveAudioOffset(): void {
    localStorage.setItem('audioOffset', this.audioOffset.toString());
  }

  show(songs: Song[]): void {
    const songsChanged = this.allSongs.length !== songs.length;
    this.allSongs = songs;
    this.applyFilter();

    // Only reset position on first show or if songs changed
    if (!this.hasBeenShown || songsChanged) {
      this.selectedPackIndex = 0;
      this.selectedSongIndex = 0;
      this.selectedDifficultyIndex = 0;
      this.activeColumn = 'packs';
      this.hasBeenShown = true;
    } else {
      // Validate indices are still in range
      this.selectedPackIndex = Math.min(this.selectedPackIndex, Math.max(0, this.packs.length - 1));
      const currentPack = this.packs[this.selectedPackIndex];
      if (currentPack) {
        this.selectedSongIndex = Math.min(this.selectedSongIndex, Math.max(0, currentPack.songs.length - 1));
        const currentSong = currentPack.songs[this.selectedSongIndex];
        if (currentSong) {
          this.selectedDifficultyIndex = Math.min(this.selectedDifficultyIndex, Math.max(0, currentSong.charts.length - 1));
        }
      }
    }

    this.render();
    window.addEventListener('keydown', this.boundKeyHandler);
    window.addEventListener('keyup', this.boundKeyUpHandler);
  }

  hide(): void {
    window.removeEventListener('keydown', this.boundKeyHandler);
    window.removeEventListener('keyup', this.boundKeyUpHandler);
    this.container.innerHTML = '';
    this.stopPreview();
  }

  private playPreview(song: Song): void {
    // Don't replay if it's the same song
    if (this.currentPreviewSongId === song.id) return;

    // Clear any pending preview load
    if (this.previewDebounceTimer !== null) {
      clearTimeout(this.previewDebounceTimer);
    }

    // Debounce: wait 50ms before loading to avoid loading while fast-scrolling
    this.previewDebounceTimer = window.setTimeout(async () => {
      // Double-check we still want this song
      if (this.currentPreviewSongId === song.id) return;

      this.currentPreviewSongId = song.id;

      try {
        // Build audio path
        const audioPath = song.basePath
          ? `${song.basePath}/${song.musicFile}`
          : `songs/${song.id}/${song.musicFile}`;

        await audioManager.load(audioPath);

        // Verify this is still the song we want (user may have navigated away during load)
        if (this.currentPreviewSongId !== song.id) return;

        // Start at preview time (previewStart is already in seconds)
        audioManager.play(song.previewStart ?? 0);
        audioManager.setVolume(0.5); // Lower volume for preview
      } catch (error) {
        console.warn('Failed to play preview:', error);
      }
    }, 150);
  }

  private stopPreview(): void {
    if (this.previewDebounceTimer !== null) {
      clearTimeout(this.previewDebounceTimer);
      this.previewDebounceTimer = null;
    }
    audioManager.stop();
    this.currentPreviewSongId = null;
  }

  private applyFilter(): void {
    const minDifficultyIndex = this.getMinDifficultyIndex();
    const filteredSongs = this.allSongs.map(song => {
      if (minDifficultyIndex === 0) {
        // Sort charts by level ascending
        return { ...song, charts: [...song.charts].sort((a, b) => a.level - b.level) };
      }
      const filteredCharts = song.charts.filter(chart => {
        const chartDiffIndex = DIFFICULTY_ORDER.indexOf(chart.difficulty as typeof DIFFICULTY_ORDER[number]);
        return chartDiffIndex >= minDifficultyIndex;
      });
      if (filteredCharts.length === 0) return null;
      // Sort charts by level ascending
      return { ...song, charts: filteredCharts.sort((a, b) => a.level - b.level) };
    }).filter((song): song is Song => song !== null);
    this.packs = this.organizeSongsIntoPacks(filteredSongs);
  }

  private getMinDifficultyIndex(): number {
    switch (this.difficultyFilter) {
      case 'All': return 0;
      case 'Easy+': return 1;
      case 'Medium+': return 2;
      case 'Hard+': return 3;
      case 'Challenge': return 4;
      default: return 0;
    }
  }

  private setGlowSpeed(multiplier: number): void {
    document.documentElement.style.setProperty('--glow-speed', `${2 / multiplier}s`);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Tab') {
      e.preventDefault();
      this.setGlowSpeed(1);
    }
  }

  private cycleDifficultyFilter(direction: number): void {
    const currentIndex = DIFFICULTY_FILTERS.indexOf(this.difficultyFilter);
    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = DIFFICULTY_FILTERS.length - 1;
    if (newIndex >= DIFFICULTY_FILTERS.length) newIndex = 0;
    this.difficultyFilter = DIFFICULTY_FILTERS[newIndex]!;
    this.applyFilter();
    this.selectedPackIndex = Math.min(this.selectedPackIndex, Math.max(0, this.packs.length - 1));
    this.selectedSongIndex = 0;
    this.selectedDifficultyIndex = 0;
    this.render();
  }

  private organizeSongsIntoPacks(songs: Song[]): SongPack[] {
    const packMap = new Map<string, Song[]>();
    for (const song of songs) {
      const packName = song.pack || 'Uncategorized';
      if (!packMap.has(packName)) packMap.set(packName, []);
      packMap.get(packName)!.push(song);
    }
    // Sort packs alphabetically, and songs within each pack alphabetically
    return Array.from(packMap.entries())
      .map(([name, packSongs]) => ({
        name,
        songs: packSongs.sort((a, b) => a.title.localeCompare(b.title))
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private handleKey(e: KeyboardEvent): void {
    const currentPack = this.packs[this.selectedPackIndex];
    const currentSong = currentPack?.songs[this.selectedSongIndex];

    switch (e.code) {
      case 'ArrowUp':
        e.preventDefault();
        if (this.activeColumn === 'packs' && this.packs.length > 0) {
          this.selectedPackIndex = this.selectedPackIndex <= 0
            ? this.packs.length - 1  // Wrap to end
            : this.selectedPackIndex - 1;
          this.selectedSongIndex = 0;
          this.selectedDifficultyIndex = 0;
          this.render();
        } else if (this.activeColumn === 'songs' && currentPack && currentPack.songs.length > 0) {
          this.selectedSongIndex = this.selectedSongIndex <= 0
            ? currentPack.songs.length - 1  // Wrap to end
            : this.selectedSongIndex - 1;
          this.selectedDifficultyIndex = 0;
          this.render();
        } else if (this.activeColumn === 'difficulties' && currentSong) {
          this.selectedDifficultyIndex = Math.max(0, this.selectedDifficultyIndex - 1);
          this.render();
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (this.activeColumn === 'packs' && this.packs.length > 0) {
          this.selectedPackIndex = this.selectedPackIndex >= this.packs.length - 1
            ? 0  // Wrap to start
            : this.selectedPackIndex + 1;
          this.selectedSongIndex = 0;
          this.selectedDifficultyIndex = 0;
          this.render();
        } else if (this.activeColumn === 'songs' && currentPack && currentPack.songs.length > 0) {
          this.selectedSongIndex = this.selectedSongIndex >= currentPack.songs.length - 1
            ? 0  // Wrap to start
            : this.selectedSongIndex + 1;
          this.selectedDifficultyIndex = 0;
          this.render();
        } else if (this.activeColumn === 'difficulties' && currentSong) {
          this.selectedDifficultyIndex = Math.min(currentSong.charts.length - 1, this.selectedDifficultyIndex + 1);
          this.render();
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (this.activeColumn === 'difficulties') {
          this.activeColumn = 'songs';
        } else if (this.activeColumn === 'songs') {
          this.activeColumn = 'packs';
        } else {
          this.cycleDifficultyFilter(-1);
        }
        this.render();
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (this.activeColumn === 'packs' && currentPack && currentPack.songs.length > 0) {
          this.activeColumn = 'songs';
        } else if (this.activeColumn === 'songs' && currentSong && currentSong.charts.length > 0) {
          this.activeColumn = 'difficulties';
        } else if (this.activeColumn === 'packs') {
          this.cycleDifficultyFilter(1);
        }
        this.render();
        break;

      case 'Enter':
        e.preventDefault();
        if (currentSong) {
          const chart = currentSong.charts[this.selectedDifficultyIndex];
          if (chart) {
            this.callbacks.onSongSelect(currentSong, chart, { cmod: this.cmod, audioOffset: this.audioOffset });
          }
        }
        break;

      case 'Tab':
        e.preventDefault();
        this.setGlowSpeed(3);
        break;

      case 'KeyD':
        e.preventDefault();
        if (currentSong && this.callbacks.onDemo) {
          const chart = currentSong.charts[this.selectedDifficultyIndex];
          if (chart) {
            this.callbacks.onDemo(currentSong, chart, { cmod: this.cmod, audioOffset: this.audioOffset });
          }
        }
        break;

      case 'Escape':
        e.preventDefault();
        if (this.activeColumn === 'difficulties') {
          this.activeColumn = 'songs';
          this.render();
        } else if (this.activeColumn === 'songs') {
          this.activeColumn = 'packs';
          this.render();
        }
        break;

      case 'Equal': // + key (adjust offset up by 5ms)
      case 'NumpadAdd':
        e.preventDefault();
        this.audioOffset += 5;
        this.saveAudioOffset();
        this.render();
        break;

      case 'Minus': // - key (adjust offset down by 5ms)
      case 'NumpadSubtract':
        e.preventDefault();
        this.audioOffset -= 5;
        this.saveAudioOffset();
        this.render();
        break;
    }
  }

  private render(): void {
    const currentPack = this.packs[this.selectedPackIndex];
    const currentSong = currentPack?.songs[this.selectedSongIndex];
    const currentChart = currentSong?.charts[this.selectedDifficultyIndex];

    this.container.innerHTML = `
      <div class="song-select-4col">
        <div class="header">
          <h1 class="title">SELECT SONG</h1>
          <div class="header-actions">
            <button id="multiplayer-btn" class="multiplayer-btn" ${this.callbacks.onMultiplayer ? '' : 'disabled'}>
              <span class="mp-icon">⚔</span> Multiplayer
            </button>
            <a href="https://stepmaniaonline.net/" target="_blank" rel="noopener" class="download-packs-link">
              Download Packs ↗
            </a>
          </div>
        </div>

        <div class="columns">
          <!-- Packs Column -->
          <div class="column packs-column ${this.activeColumn === 'packs' ? 'active' : ''}">
            <div class="column-list">
              <div class="wheel-border"></div>
              <div class="wheel-viewport" style="--item-height: 44px; --total-items: ${this.packs.length}; --selected-idx: ${this.selectedPackIndex}">
                <div class="wheel-container" style="top: calc(50% - var(--item-height) / 2); transform: translateY(calc((var(--total-items) * var(--item-height) + var(--selected-idx) * var(--item-height)) * -1))">
                  ${this.packs.length === 0 ? '<div class="empty">No songs</div>' : (() => {
                    // Render 3 copies: before separator, main, after separator
                    const renderPack = (pack: SongPack, realIndex: number, virtualOffset: number) => {
                      const offset = virtualOffset - this.selectedPackIndex;
                      const absOffset = Math.abs(offset);
                      const rotateX = offset * -3;
                      const translateZ = -absOffset * 5;
                      const opacity = Math.max(0.35, 1 - absOffset * 0.1);
                      const scale = Math.max(0.9, 1 - absOffset * 0.02);
                      return `
                        <div class="list-item wheel-item ${virtualOffset === this.selectedPackIndex ? 'selected' : ''}"
                             data-pack="${realIndex}"
                             style="transform: rotateX(${rotateX}deg) translateZ(${translateZ}px) scale(${scale}); opacity: ${opacity};">
                          <span class="item-icon">📁</span>
                          <span class="item-name">${escapeHtml(pack.name)}</span>
                          <span class="item-count">${pack.songs.length}</span>
                        </div>
                      `;
                    };
                    const n = this.packs.length;
                    // Previous cycle (negative offsets)
                    const prevCycle = this.packs.map((pack, i) => renderPack(pack, i, i - n)).join('');
                    // Main cycle
                    const mainCycle = this.packs.map((pack, i) => renderPack(pack, i, i)).join('');
                    // Next cycle (positive offsets beyond n)
                    const nextCycle = this.packs.map((pack, i) => renderPack(pack, i, i + n)).join('');
                    return prevCycle + mainCycle + nextCycle;
                  })()}
                </div>
              </div>
            </div>
          </div>

          <!-- Songs Column -->
          <div class="column songs-column ${this.activeColumn === 'songs' ? 'active' : ''}">
            <div class="column-list">
              <div class="wheel-border"></div>
              <div class="wheel-viewport" style="--item-height: 56px; --total-items: ${currentPack?.songs.length || 0}; --selected-idx: ${this.selectedSongIndex}">
                <div class="wheel-container" style="top: calc(50% - var(--item-height) / 2); transform: translateY(calc((var(--total-items) * var(--item-height) + var(--selected-idx) * var(--item-height)) * -1))">
                  ${!currentPack ? '<div class="empty">Select a pack</div>' : (() => {
                    const songs = currentPack.songs;
                    const renderSong = (song: Song, realIndex: number, virtualOffset: number) => {
                      const offset = virtualOffset - this.selectedSongIndex;
                      const absOffset = Math.abs(offset);
                      const rotateX = offset * -3;
                      const translateZ = -absOffset * 5;
                      const opacity = Math.max(0.35, 1 - absOffset * 0.1);
                      const scale = Math.max(0.9, 1 - absOffset * 0.02);
                      const grades = song.charts.map(c => getScore(song.id, c.difficulty)).filter(Boolean);
                      const bestGrade = grades.length > 0 ? grades.sort((a, b) => {
                        const order = ['AAAA', 'AAA', 'AA', 'A', 'B', 'C', 'D'];
                        return order.indexOf(a!.grade) - order.indexOf(b!.grade);
                      })[0] : null;
                      return `
                        <div class="list-item wheel-item ${virtualOffset === this.selectedSongIndex ? 'selected' : ''}"
                             data-song="${realIndex}"
                             style="transform: rotateX(${rotateX}deg) translateZ(${translateZ}px) scale(${scale}); opacity: ${opacity};">
                          <div class="song-row">
                            <span class="item-name">${escapeHtml(song.title)}</span>
                            ${bestGrade ? `<span class="best-grade grade-${bestGrade.grade.toLowerCase()}">${bestGrade.grade}</span>` : ''}
                          </div>
                          <div class="song-meta">
                            <span class="artist">${escapeHtml(song.artist)}</span>
                          </div>
                        </div>
                      `;
                    };
                    const n = songs.length;
                    const prevCycle = songs.map((song, i) => renderSong(song, i, i - n)).join('');
                    const mainCycle = songs.map((song, i) => renderSong(song, i, i)).join('');
                    const nextCycle = songs.map((song, i) => renderSong(song, i, i + n)).join('');
                    return prevCycle + mainCycle + nextCycle;
                  })()}
                </div>
              </div>
            </div>
          </div>

          <!-- Difficulties Column -->
          <div class="column difficulties-column ${this.activeColumn === 'difficulties' ? 'active' : ''}">
            <div class="column-list">
              <div class="wheel-border"></div>
              <div class="wheel-viewport" style="--item-height: 52px; --selected-idx: ${this.selectedDifficultyIndex}; --ghost-count: 8">
                <div class="wheel-container" style="top: calc(50% - var(--item-height) / 2); transform: translateY(calc((var(--ghost-count) + var(--selected-idx)) * var(--item-height) * -1))">
                  ${!currentSong ? '<div class="empty">Select a song</div>' : (() => {
                    const ghostsBefore = Array(8).fill(0).map((_, i) => {
                      const offset = -(8 - i) - this.selectedDifficultyIndex;
                      const rotateX = offset * -3;
                      return `<div class="wheel-ghost wheel-item" style="transform: rotateX(${rotateX}deg);"></div>`;
                    }).join('');

                    const items = currentSong.charts.map((chart, i) => {
                      const offset = i - this.selectedDifficultyIndex;
                      const absOffset = Math.abs(offset);
                      const rotateX = offset * -3;
                      const translateZ = -absOffset * 5;
                      const opacity = Math.max(0.35, 1 - absOffset * 0.1);
                      const scale = Math.max(0.9, 1 - absOffset * 0.02);
                      const chartScore = getScore(currentSong.id, chart.difficulty);
                      return `
                        <div class="list-item wheel-item diff-item ${i === this.selectedDifficultyIndex ? 'selected' : ''}"
                             data-diff-idx="${i}"
                             style="transform: rotateX(${rotateX}deg) translateZ(${translateZ}px) scale(${scale}); opacity: ${opacity};">
                          <div class="diff-row">
                            <span class="diff-name" data-diff="${chart.difficulty}">${chart.difficulty}</span>
                            <span class="diff-level">Lv.${chart.level}</span>
                          </div>
                          ${chartScore ? `
                            <div class="diff-score">
                              <span class="diff-grade grade-${chartScore.grade.toLowerCase()}">${chartScore.grade}</span>
                              <span class="diff-score-value">${chartScore.score.toLocaleString()}</span>
                            </div>
                          ` : '<div class="diff-no-score">No play</div>'}
                        </div>
                      `;
                    }).join('');

                    const ghostsAfter = Array(8).fill(0).map((_, i) => {
                      const offset = currentSong.charts.length + i - this.selectedDifficultyIndex;
                      const rotateX = offset * -3;
                      return `<div class="wheel-ghost wheel-item" style="transform: rotateX(${rotateX}deg);"></div>`;
                    }).join('');

                    return ghostsBefore + items + ghostsAfter;
                  })()}
                </div>
              </div>
            </div>
          </div>

          <!-- Stats Column -->
          <div class="column stats-column">
            ${currentChart ? this.renderChartDetails(currentSong!, currentChart) : '<div class="empty">Select a difficulty</div>'}
          </div>
        </div>

        <div class="footer">
          <div class="settings-row">
            ${this.renderCmodSelector()}
            ${this.renderOffsetSelector()}
          </div>
          <div class="nav-hint">
            <span>↑↓ Navigate</span>
            <span>←→ Columns</span>
            <span>ENTER Play</span>
            <span class="demo-hint">D Demo</span>
            <span class="glow-hint">TAB Turbo</span>
          </div>
        </div>
      </div>
      ${this.getStyles()}
    `;

    this.addClickHandlers();
    this.drawGrooveRadar();
    this.scrollSelectedIntoView();

    // Play song preview
    if (currentSong) {
      this.playPreview(currentSong);
    }
  }

  /**
   * No-op: 3D wheel handles positioning automatically via CSS transforms
   */
  private scrollSelectedIntoView(): void {
    // The 3D wheel rotates to show selected items - no scrolling needed
  }

  private drawGrooveRadar(): void {
    if (!this.pendingRadarData) return;

    const canvas = document.getElementById('groove-radar') as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const radar = this.pendingRadarData;
    const size = canvas.width;
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.32;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Radar dimensions - 5 axes for pentagon
    const dimensions = [
      { label: 'STREAM', value: radar.stream, angle: -Math.PI / 2 },
      { label: 'VOLTAGE', value: radar.voltage, angle: -Math.PI / 2 + (2 * Math.PI / 5) },
      { label: 'AIR', value: radar.air, angle: -Math.PI / 2 + (4 * Math.PI / 5) },
      { label: 'FREEZE', value: radar.freeze, angle: -Math.PI / 2 + (6 * Math.PI / 5) },
      { label: 'CHAOS', value: radar.chaos, angle: -Math.PI / 2 + (8 * Math.PI / 5) },
    ];

    // Draw background grid (concentric pentagons)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    for (let level = 0.25; level <= 1; level += 0.25) {
      ctx.beginPath();
      for (let i = 0; i <= dimensions.length; i++) {
        const dim = dimensions[i % dimensions.length]!;
        const x = centerX + Math.cos(dim.angle) * radius * level;
        const y = centerY + Math.sin(dim.angle) * radius * level;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Draw axis lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    for (const dim of dimensions) {
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + Math.cos(dim.angle) * radius,
        centerY + Math.sin(dim.angle) * radius
      );
      ctx.stroke();
    }

    // Draw filled radar shape with gradient
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 0, 170, 0.6)');

    ctx.beginPath();
    for (let i = 0; i <= dimensions.length; i++) {
      const dim = dimensions[i % dimensions.length]!;
      const value = dim.value / 100;
      const x = centerX + Math.cos(dim.angle) * radius * value;
      const y = centerY + Math.sin(dim.angle) * radius * value;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw radar outline
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= dimensions.length; i++) {
      const dim = dimensions[i % dimensions.length]!;
      const value = dim.value / 100;
      const x = centerX + Math.cos(dim.angle) * radius * value;
      const y = centerY + Math.sin(dim.angle) * radius * value;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.stroke();

    // Draw data points
    for (const dim of dimensions) {
      const value = dim.value / 100;
      const x = centerX + Math.cos(dim.angle) * radius * value;
      const y = centerY + Math.sin(dim.angle) * radius * value;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#00d4ff';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Draw labels
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const dim of dimensions) {
      const labelRadius = radius + 25;
      const x = centerX + Math.cos(dim.angle) * labelRadius;
      const y = centerY + Math.sin(dim.angle) * labelRadius;

      // Label background
      const metrics = ctx.measureText(dim.label);
      const padding = 4;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(
        x - metrics.width / 2 - padding,
        y - 7 - padding,
        metrics.width + padding * 2,
        14 + padding * 2
      );

      // Label text
      ctx.fillStyle = '#fff';
      ctx.fillText(dim.label, x, y);

      // Value below label
      ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = '#00d4ff';
      ctx.fillText(`${dim.value}`, x, y + 13);
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
    }
  }

  private renderChartDetails(song: Song, chart: Chart): string {
    const stats = calculateChartStats(chart.notes);
    const bestScore = getScore(song.id, chart.difficulty);

    // Store radar data for canvas drawing after render
    this.pendingRadarData = calculateGrooveRadar(chart.notes, stats.durationSec);

    const formatDuration = (sec: number) => {
      const min = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${min}:${s.toString().padStart(2, '0')}`;
    };

    return `
      <div class="chart-details">
        <div class="chart-header">
          <div class="title-row">
            <h2 class="song-title">${escapeHtml(song.title)}</h2>
            <span class="song-duration">${formatDuration(stats.durationSec)}</span>
            <button class="play-button">
              <span class="play-icon">▶</span>
              <span class="play-text">ENTER TO PLAY</span>
            </button>
          </div>
          <div class="song-artist">${escapeHtml(song.artist)}</div>
          <div class="chart-info-row">
            <span class="diff-badge" data-diff="${chart.difficulty}">${chart.difficulty} Lv.${chart.level}</span>
            <span class="song-bpm">${formatBpm(song)}</span>
          </div>
        </div>

        ${bestScore ? `
          <div class="best-score-section">
            <div class="section-title">BEST SCORE</div>
            <div class="best-score-row">
              <span class="best-grade-large grade-${bestScore.grade.toLowerCase()}">${bestScore.grade}</span>
              <div class="best-details">
                <div class="best-score-value">${bestScore.score.toLocaleString()}</div>
                <div class="best-meta">
                  <span>Combo: ${bestScore.maxCombo}</span>
                  <span>Acc: ${bestScore.accuracy.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>
        ` : `
          <div class="no-score">No score yet</div>
        `}

        <div class="radar-section">
          <div class="radar-container">
            <canvas id="groove-radar" class="radar-canvas" width="280" height="280"></canvas>
          </div>
        </div>

        <div class="stats-section">
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-value">${stats.totalNotes}</span>
              <span class="stat-label">Steps</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">${stats.taps}</span>
              <span class="stat-label">Taps</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">${stats.jumps}</span>
              <span class="stat-label">Jumps</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">${stats.hands}</span>
              <span class="stat-label">Hands</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">${stats.nps}</span>
              <span class="stat-label">Avg NPS</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">${stats.peakNps}</span>
              <span class="stat-label">Peak NPS</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderCmodSelector(): string {
    const displayValue = this.cmod === 0 ? 'BPM' : `C${this.cmod}`;
    return `
      <div class="cmod-selector">
        <span class="label">Speed:</span>
        <button class="cmod-btn" data-cmod-delta="-50">−</button>
        <div class="cmod-value">${displayValue}</div>
        <button class="cmod-btn" data-cmod-delta="50">+</button>
      </div>
    `;
  }

  private renderOffsetSelector(): string {
    return `
      <div class="offset-selector">
        <span class="label">Offset:</span>
        <button class="offset-btn" data-offset-delta="-5">−</button>
        <div class="offset-value">${this.audioOffset}ms</div>
        <button class="offset-btn" data-offset-delta="5">+</button>
      </div>
    `;
  }

  private addClickHandlers(): void {
    // Pack clicks
    this.container.querySelectorAll('[data-pack]').forEach(el => {
      el.addEventListener('click', () => {
        this.selectedPackIndex = parseInt((el as HTMLElement).dataset.pack!, 10);
        this.selectedSongIndex = 0;
        this.selectedDifficultyIndex = 0;
        this.activeColumn = 'songs';
        this.render();
      });
    });

    // Song clicks
    this.container.querySelectorAll('[data-song]').forEach(el => {
      el.addEventListener('click', () => {
        this.selectedSongIndex = parseInt((el as HTMLElement).dataset.song!, 10);
        this.selectedDifficultyIndex = 0;
        this.activeColumn = 'songs';
        this.render();
      });
    });

    // Difficulty clicks
    this.container.querySelectorAll('[data-diff-idx]').forEach(el => {
      el.addEventListener('click', () => {
        this.selectedDifficultyIndex = parseInt((el as HTMLElement).dataset.diffIdx!, 10);
        this.activeColumn = 'difficulties';
        this.render();
      });
    });

    // CMod button clicks
    this.container.querySelectorAll('[data-cmod-delta]').forEach(el => {
      el.addEventListener('click', () => {
        const delta = parseInt((el as HTMLElement).dataset.cmodDelta!, 10);
        this.cmod = Math.max(0, Math.min(2000, this.cmod + delta));
        this.saveCmod();
        this.render();
      });
    });

    // Offset button clicks
    this.container.querySelectorAll('[data-offset-delta]').forEach(el => {
      el.addEventListener('click', () => {
        const delta = parseInt((el as HTMLElement).dataset.offsetDelta!, 10);
        this.audioOffset += delta;
        this.saveAudioOffset();
        this.render();
      });
    });

    // Multiplayer button click
    const mpBtn = this.container.querySelector('#multiplayer-btn');
    if (mpBtn && this.callbacks.onMultiplayer) {
      mpBtn.addEventListener('click', () => {
        this.callbacks.onMultiplayer?.();
      });
    }
  }

  private getStyles(): string {
    return `<style>
      .song-select-4col {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        background: ${THEME.bg.primary};
        color: ${THEME.text.primary};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        padding: 1.5rem;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid ${THEME.bg.tertiary};
      }

      .title {
        font-size: 1.5rem;
        font-weight: 700;
        background: linear-gradient(135deg, ${THEME.accent.primary}, ${THEME.accent.secondary});
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin: 0;
      }

      .download-packs-link {
        color: ${THEME.text.secondary};
        text-decoration: none;
        font-size: 0.875rem;
        padding: 0.5rem 1rem;
        border: 1px solid ${THEME.bg.tertiary};
        border-radius: 6px;
        transition: all 0.2s ease;
      }

      .download-packs-link:hover {
        color: ${THEME.accent.primary};
        border-color: ${THEME.accent.primary};
        background: rgba(0, 212, 255, 0.1);
      }

      .header-actions {
        display: flex;
        gap: 0.75rem;
        align-items: center;
      }

      .multiplayer-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: linear-gradient(135deg, ${THEME.accent.secondary}, #ff4488);
        border: none;
        border-radius: 6px;
        color: white;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .multiplayer-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 15px rgba(255, 0, 170, 0.4);
      }

      .multiplayer-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        background: ${THEME.bg.tertiary};
      }

      .mp-icon {
        font-size: 1rem;
      }

      .difficulty-filter {
        display: flex;
        gap: 0.25rem;
      }

      .filter-option {
        padding: 0.35rem 0.6rem;
        background: ${THEME.bg.secondary};
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 600;
        color: ${THEME.text.secondary};
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .filter-option:hover { background: ${THEME.bg.tertiary}; }
      .filter-option.selected {
        background: rgba(255, 0, 170, 0.2);
        color: ${THEME.accent.secondary};
      }

      .columns {
        display: flex;
        gap: 1rem;
        flex: 1;
        min-height: 0;
      }

      .column {
        background: ${THEME.bg.secondary};
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* Remove background on wheel columns */
      .packs-column,
      .songs-column,
      .difficulties-column {
        background: transparent;
      }

      .packs-column { flex: 0 0 220px; }
      .songs-column { flex: 0 0 280px; }
      .difficulties-column { flex: 0 0 200px; }
      .stats-column { flex: 1; }

      .column-header {
        padding: 0.75rem 1rem;
        font-size: 0.7rem;
        font-weight: 700;
        color: ${THEME.text.muted};
        letter-spacing: 1px;
        border-bottom: 1px solid ${THEME.bg.tertiary};
      }

      .column-list {
        flex: 1;
        overflow: hidden;
        padding: 0.5rem;
        position: relative;
      }

      /* 3D Wheel Effect - Subtle curve on a huge wheel */
      .wheel-viewport {
        position: absolute;
        inset: 0;
        perspective: 1200px;
        perspective-origin: center center;
        overflow: hidden;
      }

      /* Curved wheel border - both arcs curve same direction "( item (" */
      .wheel-border {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 25;
        overflow: visible;
        /* Fade out at top and bottom */
        mask-image: linear-gradient(
          to bottom,
          transparent 0%,
          black 15%,
          black 85%,
          transparent 100%
        );
        -webkit-mask-image: linear-gradient(
          to bottom,
          transparent 0%,
          black 15%,
          black 85%,
          transparent 100%
        );
      }

      .wheel-border::before,
      .wheel-border::after {
        content: '';
        position: absolute;
        top: 50%;
        width: 8000px;
        height: 8000px;
        border: 2px solid transparent;
        border-radius: 50%;
        transform: translateY(-50%);
        transition: border-color 0.2s ease, filter 0.2s ease;
      }

      /* Left arc "(" */
      .wheel-border::before {
        left: 2px;
        border-left-color: rgba(100, 100, 120, 0.4);
      }

      /* Right arc "(" - positioned so left edge is visible inside container */
      .wheel-border::after {
        left: calc(100% - 25px);
        border-left-color: rgba(100, 100, 120, 0.4);
      }

      .column.active .wheel-border::before,
      .column.active .wheel-border::after {
        border-left-color: ${THEME.accent.primary};
        animation: arc-glow var(--glow-speed, 2s) ease-in-out infinite;
      }

      @keyframes arc-glow {
        0%, 100% {
          border-left-color: rgba(0, 212, 255, 0.7);
          filter: drop-shadow(0 0 3px rgba(0, 212, 255, 0.9));
        }
        50% {
          border-left-color: rgba(0, 255, 255, 1);
          filter: drop-shadow(0 0 6px rgba(0, 255, 255, 1)) drop-shadow(0 0 10px rgba(0, 212, 255, 0.8));
        }
      }

      .wheel-container {
        position: absolute;
        left: 0;
        right: 0;
        display: flex;
        flex-direction: column;
        padding: 0 2.25rem 0 0.75rem;
        transform-style: preserve-3d;
        transition: transform 0.25s cubic-bezier(0.23, 1, 0.32, 1);
      }

      .wheel-item {
        flex-shrink: 0;
        transform-style: preserve-3d;
        transform-origin: center center;
        transition: transform 0.25s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.2s ease;
      }

      .wheel-item.selected {
        opacity: 1 !important;
      }

      /* Wheel edge fade overlay */
      .wheel-viewport::before,
      .wheel-viewport::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 20%;
        pointer-events: none;
        z-index: 10;
      }

      .wheel-viewport::before {
        top: 0;
        background: linear-gradient(
          to bottom,
          ${THEME.bg.primary} 0%,
          transparent 100%
        );
      }

      .wheel-viewport::after {
        bottom: 0;
        background: linear-gradient(
          to top,
          ${THEME.bg.primary} 0%,
          transparent 100%
        );
      }

      .empty {
        color: ${THEME.text.muted};
        text-align: center;
        padding: 2rem;
        font-size: 0.85rem;
      }

      .list-item {
        padding: 0.6rem 0.75rem;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.1s ease;
        margin-bottom: 0.25rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      }

      /* Ghost items to simulate wheel continuity */
      .wheel-ghost {
        height: 52px;
        min-height: 52px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        padding: 0.6rem 0.75rem;
        margin-bottom: 0.25rem;
        flex-shrink: 0;
        box-sizing: border-box;
        border-radius: 6px;
      }

      .list-item:hover { background: ${THEME.bg.tertiary}; }
      .list-item.selected {
        background: transparent;
        position: relative;
      }

      .list-item.selected::before,
      .list-item.selected::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(
          90deg,
          transparent 0%,
          #d4af37 20%,
          #ffd700 50%,
          #d4af37 80%,
          transparent 100%
        );
        box-shadow: 0 0 8px rgba(255, 215, 0, 0.5);
      }

      .list-item.selected::before {
        top: -2px;
      }

      .list-item.selected::after {
        bottom: -2px;
      }

      .list-item.selected .item-name,
      .list-item.selected .diff-name {
        font-size: 1rem;
        font-weight: 600;
      }

      .list-item.selected .item-name {
        color: #fff;
      }

      .packs-column .list-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .list-item .item-icon { flex-shrink: 0; }
      .list-item .item-name {
        flex: 1;
        font-size: 0.85rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .list-item .item-count {
        flex-shrink: 0;
        font-size: 0.7rem;
        color: ${THEME.text.muted};
        background: ${THEME.bg.tertiary};
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
      }

      .song-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .song-meta {
        display: flex;
        gap: 0.75rem;
        margin-top: 0.25rem;
        font-size: 0.7rem;
        color: ${THEME.text.muted};
      }

      .best-grade {
        font-size: 0.65rem;
        font-weight: 700;
        padding: 0.1rem 0.3rem;
        border-radius: 3px;
      }

      .grade-aaaa { background: rgba(0, 255, 255, 0.25); color: #00ffff; text-shadow: 0 0 8px currentColor; }
      .grade-aaa { background: rgba(0, 220, 220, 0.2); color: #00dddd; }
      .grade-aa { background: rgba(255, 255, 0, 0.2); color: #ffff00; }
      .grade-a { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
      .grade-b { background: rgba(0, 212, 255, 0.2); color: #00d4ff; }
      .grade-c { background: rgba(255, 170, 0, 0.2); color: #ffaa00; }
      .grade-d, .grade-f { background: rgba(255, 68, 68, 0.2); color: #ff4444; }

      /* Stats Column */
      .song-details { padding: 1rem; }
      .song-title { font-size: 1.25rem; margin: 0 0 0.25rem 0; }
      .song-artist { color: ${THEME.text.secondary}; font-size: 0.9rem; }
      .song-bpm {
        color: ${THEME.accent.primary};
        font-size: 0.8rem;
        display: flex;
        align-items: center;
      }

      .difficulty-tabs {
        display: flex;
        gap: 0.5rem;
        margin-top: 1rem;
        flex-wrap: wrap;
      }

      .diff-tab {
        padding: 0.5rem 0.75rem;
        background: ${THEME.bg.tertiary};
        border-radius: 6px;
        cursor: pointer;
        text-align: center;
        border: 2px solid transparent;
        transition: all 0.15s ease;
      }

      .diff-tab:hover { background: ${THEME.bg.primary}; }
      .diff-tab.selected { border-color: ${THEME.accent.primary}; }

      .diff-name { font-size: 0.75rem; display: block; }
      .diff-level { font-size: 0.65rem; color: ${THEME.text.muted}; display: block; }
      .diff-grade { font-size: 0.6rem; margin-top: 0.25rem; display: block; color: ${THEME.accent.success}; }

      .diff-tab[data-diff="Beginner"] .diff-name,
      .diff-tab[data-diff="Easy"] .diff-name { color: #88ff88; }
      .diff-tab[data-diff="Medium"] .diff-name { color: #ffff44; }
      .diff-tab[data-diff="Hard"] .diff-name { color: #ff8844; }
      .diff-tab[data-diff="Challenge"] .diff-name { color: #ff4488; }

      /* Difficulty column items */
      .diff-item { display: flex; flex-direction: column; gap: 0.25rem; }
      .diff-row { display: flex; align-items: center; justify-content: space-between; }
      .diff-name[data-diff="Beginner"],
      .diff-name[data-diff="Easy"] { color: #88ff88; }
      .diff-name[data-diff="Medium"] { color: #ffff44; }
      .diff-name[data-diff="Hard"] { color: #ff8844; }
      .diff-name[data-diff="Challenge"] { color: #ff4488; }
      .diff-level { font-size: 0.7rem; color: ${THEME.text.muted}; }
      .diff-score { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; }
      .diff-grade { font-weight: 700; font-size: 0.7rem; padding: 0.1rem 0.3rem; border-radius: 3px; }
      .diff-score-value { color: ${THEME.text.secondary}; font-family: 'SF Mono', Monaco, monospace; font-size: 0.7rem; }
      .diff-no-score { font-size: 0.7rem; color: ${THEME.text.muted}; font-style: italic; }

      /* Play button */
      .play-button {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1.5rem;
        margin-left: auto;
        background: linear-gradient(135deg, #d4af37, #ffd700, #d4af37);
        background-size: 200% 200%;
        border: none;
        border-radius: 8px;
        color: #1a1a2e;
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: 1px;
        cursor: pointer;
        animation: play-button-glow var(--glow-speed, 2s) ease-in-out infinite, play-button-shimmer 3s ease-in-out infinite;
        transition: transform 0.15s ease;
      }

      .play-button:hover {
        transform: scale(1.05);
      }

      .play-icon {
        font-size: 1.2rem;
      }

      @keyframes play-button-glow {
        0%, 100% {
          box-shadow: 0 0 10px rgba(255, 215, 0, 0.5), 0 0 20px rgba(255, 215, 0, 0.3), 0 0 30px rgba(255, 215, 0, 0.2);
        }
        50% {
          box-shadow: 0 0 15px rgba(255, 215, 0, 0.8), 0 0 30px rgba(255, 215, 0, 0.5), 0 0 45px rgba(255, 215, 0, 0.3);
        }
      }

      @keyframes play-button-shimmer {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }

      /* Chart details in stats column */
      .chart-details { padding: 1rem; }
      .chart-header { margin-bottom: 1rem; }
      .title-row {
        display: flex;
        align-items: baseline;
        gap: 0.75rem;
      }
      .song-duration {
        font-size: 0.9rem;
        color: ${THEME.text.muted};
        font-family: 'SF Mono', Monaco, monospace;
      }
      .chart-info-row { display: flex; gap: 1rem; align-items: center; margin-top: 0.5rem; }
      .diff-badge {
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 600;
      }
      .diff-badge[data-diff="Beginner"],
      .diff-badge[data-diff="Easy"] { background: rgba(136, 255, 136, 0.15); color: #88ff88; }
      .diff-badge[data-diff="Medium"] { background: rgba(255, 255, 68, 0.15); color: #ffff44; }
      .diff-badge[data-diff="Hard"] { background: rgba(255, 136, 68, 0.15); color: #ff8844; }
      .diff-badge[data-diff="Challenge"] { background: rgba(255, 68, 136, 0.15); color: #ff4488; }

      .section-title {
        font-size: 0.65rem;
        color: ${THEME.text.muted};
        letter-spacing: 1px;
        margin: 1.25rem 0 0.5rem 0;
      }

      .best-score-section { margin-top: 1rem; }
      .best-score-row { display: flex; align-items: center; gap: 1rem; }
      .best-grade-large {
        font-size: 1.5rem;
        font-weight: 700;
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
      }
      .best-details { flex: 1; }
      .best-score-value { font-size: 1.1rem; font-weight: 600; }
      .best-meta { font-size: 0.75rem; color: ${THEME.text.secondary}; margin-top: 0.25rem; display: flex; gap: 1rem; }

      .no-score {
        margin-top: 1rem;
        padding: 1rem;
        background: ${THEME.bg.tertiary};
        border-radius: 6px;
        text-align: center;
        color: ${THEME.text.muted};
        font-size: 0.85rem;
      }

      .stats-section { margin-top: 1rem; }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
      }

      /* Groove Radar */
      .radar-section { margin-top: 1.25rem; }
      .radar-container {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 0.5rem;
      }
      .radar-canvas {
        max-width: 100%;
      }

      .stat-item {
        text-align: center;
        padding: 0.25rem;
      }

      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        display: block;
        color: ${THEME.text.primary};
        font-family: monospace;
      }
      .stat-label {
        font-size: 0.75rem;
        color: ${THEME.text.secondary};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid ${THEME.bg.tertiary};
      }

      .settings-row {
        display: flex;
        gap: 2rem;
        align-items: center;
      }

      .cmod-selector, .offset-selector {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .cmod-selector .label, .offset-selector .label {
        font-size: 0.75rem;
        color: ${THEME.text.secondary};
      }

      .offset-value {
        padding: 0.3rem 0.6rem;
        background: rgba(0, 212, 255, 0.15);
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: 600;
        color: ${THEME.accent.primary};
        font-family: 'SF Mono', Monaco, monospace;
        min-width: 60px;
        text-align: center;
      }

      .offset-btn {
        width: 28px;
        height: 28px;
        border: none;
        background: ${THEME.bg.tertiary};
        color: ${THEME.text.primary};
        border-radius: 4px;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .offset-btn:hover {
        background: ${THEME.accent.primary};
        color: ${THEME.bg.primary};
      }

      .offset-btn:active {
        transform: scale(0.95);
      }

      .cmod-btn {
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 4px;
        background: ${THEME.bg.secondary};
        color: ${THEME.text.secondary};
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .cmod-btn:hover {
        background: ${THEME.accent.primary};
        color: ${THEME.bg.primary};
      }

      .cmod-btn:active {
        transform: scale(0.95);
      }

      .cmod-value {
        min-width: 50px;
        padding: 0 0.5rem;
        text-align: center;
        font-family: monospace;
        font-size: 0.85rem;
        font-weight: 600;
        color: ${THEME.accent.primary};
      }

      .nav-hint {
        display: flex;
        gap: 1.5rem;
        font-size: 0.75rem;
        color: ${THEME.text.muted};
      }

      .demo-hint { color: ${THEME.accent.secondary}; font-weight: 600; }
      .glow-hint { color: ${THEME.accent.primary}; font-weight: 600; }
    </style>`;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
