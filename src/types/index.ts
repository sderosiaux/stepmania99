// ============================================================================
// Core Game Types
// ============================================================================

/** Arrow directions matching keyboard layout */
export type Direction = 'left' | 'down' | 'up' | 'right';

/** All possible directions as array for iteration */
export const DIRECTIONS: readonly Direction[] = ['left', 'down', 'up', 'right'] as const;

/** Map keyboard keys to directions */
export const KEY_TO_DIRECTION: Record<string, Direction> = {
  // Arrow keys
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowUp: 'up',
  ArrowRight: 'right',
  // SDKL keys (split keyboard layout)
  KeyS: 'left',
  KeyD: 'down',
  KeyK: 'up',
  KeyL: 'right',
};

/** Difficulty levels */
export type Difficulty = 'Beginner' | 'Easy' | 'Medium' | 'Hard' | 'Challenge';

/** Judgment grades from best to worst */
export type JudgmentGrade = 'marvelous' | 'perfect' | 'great' | 'good' | 'boo' | 'miss';

/** Letter grades for final score */
export type LetterGrade = 'AAAA' | 'AAA' | 'AA' | 'A' | 'B' | 'C' | 'D';

// ============================================================================
// Timing Windows (in milliseconds)
// ============================================================================

export const TIMING_WINDOWS: Record<Exclude<JudgmentGrade, 'miss'>, number> = {
  marvelous: 22.5,
  perfect: 45,
  great: 90,
  good: 135,
  boo: 180,
};

/** Score percentages for each judgment */
export const JUDGMENT_SCORES: Record<JudgmentGrade, number> = {
  marvelous: 100,
  perfect: 98,
  great: 65,
  good: 25,
  boo: 0,
  miss: 0,
};

/** Whether judgment maintains combo */
export const JUDGMENT_MAINTAINS_COMBO: Record<JudgmentGrade, boolean> = {
  marvelous: true,
  perfect: true,
  great: true,
  good: true,
  boo: false,
  miss: false,
};

/** Health change for each judgment (positive = gain, negative = lose) */
export const JUDGMENT_HEALTH: Record<JudgmentGrade, number> = {
  marvelous: 2.0,
  perfect: 1.5,
  great: 0.5,
  good: -2.5,
  boo: -6.0,
  miss: -10.0,
};

/** Grade thresholds (percentage required) */
export const GRADE_THRESHOLDS: { grade: LetterGrade; threshold: number }[] = [
  { grade: 'AAA', threshold: 100 },
  { grade: 'AA', threshold: 93 },
  { grade: 'A', threshold: 80 },
  { grade: 'B', threshold: 65 },
  { grade: 'C', threshold: 45 },
  { grade: 'D', threshold: 0 },
];

// ============================================================================
// Data Structures
// ============================================================================

/** Note type */
export type NoteType = 'tap' | 'hold';

/** A single note/arrow in the chart */
export interface Note {
  /** Unique ID for this note */
  id: number;
  /** Time in milliseconds from song start */
  time: number;
  /** Arrow direction */
  direction: Direction;
  /** Note type (tap or hold/freeze) */
  type: NoteType;
  /** Duration in ms (for hold notes only) */
  duration?: number;
  /** End time in ms (for hold notes: time + duration) */
  endTime?: number;
  /** Whether this note has been judged */
  judged: boolean;
  /** The judgment received (if judged) */
  judgment?: Judgment;
  /** Hold state (for freeze arrows) */
  holdState?: HoldState;
}

/** State of a hold/freeze note */
export interface HoldState {
  /** Is the hold currently being held */
  isHeld: boolean;
  /** Has the hold been started (head hit) */
  started: boolean;
  /** Has the hold been completed successfully */
  completed: boolean;
  /** Has the hold been dropped/failed */
  dropped: boolean;
  /** Progress through the hold (0-1) */
  progress: number;
}

/** Result of judging a note */
export interface Judgment {
  /** The note that was judged */
  noteId: number;
  /** Timing difference in ms (negative = early, positive = late) */
  timingDiff: number;
  /** The grade received */
  grade: JudgmentGrade;
  /** Time when judgment occurred */
  time: number;
}

/** A single difficulty chart */
export interface Chart {
  /** Difficulty name */
  difficulty: Difficulty;
  /** Numeric difficulty level (1-20) */
  level: number;
  /** All notes in this chart, sorted by time */
  notes: Note[];
}

/** BPM change event */
export interface BpmChange {
  /** Beat number where BPM changes */
  beat: number;
  /** New BPM value */
  bpm: number;
}

/** Stop/freeze event (song pauses but notes continue) */
export interface Stop {
  /** Beat number where stop occurs */
  beat: number;
  /** Duration of stop in seconds */
  duration: number;
}

/** Complete song data */
export interface Song {
  /** Unique identifier */
  id: string;
  /** Song title */
  title: string;
  /** Artist name */
  artist: string;
  /** Beats per minute (initial BPM, or only BPM if no changes) */
  bpm: number;
  /** Audio offset in milliseconds */
  offset: number;
  /** Path to music file */
  musicFile: string;
  /** Preview start time in seconds */
  previewStart: number;
  /** Available charts */
  charts: Chart[];
  /** Song pack/folder name */
  pack?: string;
  /** BPM changes throughout the song (optional, for variable BPM songs) */
  bpmChanges?: BpmChange[];
  /** Stops/freezes in the song (optional) */
  stops?: Stop[];
  /** Base path for loading audio/assets (for .sm files) */
  basePath?: string;
  /** Banner image path */
  banner?: string;
  /** Background image path */
  background?: string;
}

/** Song pack/folder containing songs */
export interface SongPack {
  /** Pack name */
  name: string;
  /** Songs in this pack */
  songs: Song[];
}

// ============================================================================
// Input Types
// ============================================================================

/** A buffered input event */
export interface InputEvent {
  /** Direction pressed */
  direction: Direction;
  /** High-resolution timestamp (performance.now()) */
  timestamp: number;
  /** Whether key is being pressed (true) or released (false) */
  pressed: boolean;
}

// ============================================================================
// Game State Types
// ============================================================================

/** Current screen in the game */
export type GameScreen = 'loading' | 'song-select' | 'gameplay' | 'results' | 'settings';

/** State during gameplay */
export interface GameplayState {
  /** Current song */
  song: Song;
  /** Selected chart */
  chart: Chart;
  /** Active notes (not yet judged) */
  activeNotes: Note[];
  /** All judgments made */
  judgments: Judgment[];
  /** Current score (0-1000000) */
  score: number;
  /** Current combo */
  combo: number;
  /** Max combo achieved */
  maxCombo: number;
  /** Game start time (AudioContext.currentTime when started) */
  startTime: number;
  /** Is game paused */
  paused: boolean;
  /** Has song ended */
  ended: boolean;
}

/** Per-direction statistics */
export interface DirectionStats {
  /** Number of notes hit in this direction */
  count: number;
  /** Average timing offset (negative = early, positive = late) */
  avgTiming: number;
  /** All timing offsets for this direction */
  timings: number[];
}

/** Results after completing a song */
export interface ResultsData {
  /** The song played */
  song: Song;
  /** The chart played */
  chart: Chart;
  /** Final score */
  score: number;
  /** Final grade */
  grade: LetterGrade;
  /** Max combo */
  maxCombo: number;
  /** Judgment counts */
  judgmentCounts: Record<JudgmentGrade, number>;
  /** Total notes */
  totalNotes: number;
  /** Percentage (0-100) */
  percentage: number;
  /** Whether the player failed (lifebar depleted) */
  failed?: boolean;
  /** Whether the player achieved a full combo (no good/boo/miss) */
  isFullCombo: boolean;
  /** Per-direction timing stats */
  directionStats?: Record<Direction, DirectionStats>;
}

/** User settings */
export interface Settings {
  /** Audio offset in ms (positive = audio plays later) */
  audioOffset: number;
  /** Visual offset in ms (positive = arrows appear later) */
  visualOffset: number;
  /** Scroll speed multiplier (legacy, used if cmod is 0) */
  scrollSpeed: number;
  /** CMod speed - constant scroll speed in pixels/second (0 = use BPM-based) */
  cmod: number;
  /** Background dim (0-1) */
  backgroundDim: number;
}

/** Available CMod speeds */
export const CMOD_OPTIONS = [0, 300, 400, 500, 600, 700, 800, 900, 1000] as const;

/** Default settings */
export const DEFAULT_SETTINGS: Settings = {
  audioOffset: -180,
  visualOffset: 0,
  scrollSpeed: 1,
  cmod: 500, // Default to C500
  backgroundDim: 0.8,
};
