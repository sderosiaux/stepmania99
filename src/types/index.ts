// ============================================================================
// Core Game Types
// ============================================================================

/** Arrow directions, in lane order */
export type Direction = 'left' | 'down' | 'up' | 'right';

export const DIRECTIONS: readonly Direction[] = ['left', 'down', 'up', 'right'] as const;

/** Physical key → lane. Several keys may map to one lane; held state is tracked per key. */
export const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowUp: 'up',
  ArrowRight: 'right',
  KeyD: 'left',
  KeyF: 'down',
  KeyJ: 'up',
  KeyK: 'right',
};

export type Difficulty = 'Beginner' | 'Easy' | 'Medium' | 'Hard' | 'Challenge';

/** Tap judgments, best to worst */
export type JudgmentGrade = 'marvelous' | 'perfect' | 'great' | 'good' | 'boo' | 'miss';
export const JUDGMENT_GRADES: readonly JudgmentGrade[] = ['marvelous', 'perfect', 'great', 'good', 'boo', 'miss'];

/** Freeze/roll outcome */
export type HoldGrade = 'ok' | 'ng';

/** E = failed (lifebar emptied) */
export type LetterGrade = 'AAAA' | 'AAA' | 'AA' | 'A' | 'B' | 'C' | 'D' | 'E';

// ============================================================================
// Timing rules (StepMania "J4" windows, DDR scoring semantics)
// ============================================================================

/** Half-width of each tap window in ms */
export const TIMING_WINDOWS: Record<Exclude<JudgmentGrade, 'miss'>, number> = {
  marvelous: 22.5,
  perfect: 45,
  great: 90,
  good: 135,
  boo: 180,
};

/** A released freeze survives this long before it is NG (StepMania TimingWindowSecondsHold) */
export const HOLD_RELEASE_WINDOW_MS = 250;
/** A roll must be re-tapped at least this often (StepMania TimingWindowSecondsRoll) */
export const ROLL_TAP_WINDOW_MS = 500;
/** A mine explodes if its lane is pressed within, or held across, this window */
export const MINE_WINDOW_MS = 90;

/** Score weight per tap judgment (out of 100) */
export const JUDGMENT_SCORES: Record<JudgmentGrade, number> = {
  marvelous: 100,
  perfect: 98,
  great: 65,
  good: 25,
  boo: 0,
  miss: 0,
};

/** DDR EX score weights */
export const EX_SCORES: Record<JudgmentGrade | HoldGrade, number> = {
  marvelous: 3,
  perfect: 2,
  great: 1,
  good: 0,
  boo: 0,
  miss: 0,
  ok: 3,
  ng: 0,
};

/** Great or better keeps the combo (StepMania default MinScoreToContinueCombo = W3) */
export const JUDGMENT_MAINTAINS_COMBO: Record<JudgmentGrade, boolean> = {
  marvelous: true,
  perfect: true,
  great: true,
  good: false,
  boo: false,
  miss: false,
};

/** Lifebar delta in percentage points */
export const LIFE_DELTA: Record<JudgmentGrade | HoldGrade | 'mine', number> = {
  marvelous: 1,
  perfect: 1,
  great: 0.5,
  good: 0,
  boo: -5,
  miss: -10,
  ok: 1,
  ng: -8,
  mine: -10,
};

export const GRADE_THRESHOLDS: { grade: LetterGrade; threshold: number }[] = [
  { grade: 'AA', threshold: 93 },
  { grade: 'A', threshold: 80 },
  { grade: 'B', threshold: 65 },
  { grade: 'C', threshold: 45 },
  { grade: 'D', threshold: 0 },
];

// ============================================================================
// Chart data (immutable once parsed)
// ============================================================================

export type NoteType = 'tap' | 'hold' | 'roll' | 'mine';

export interface Note {
  readonly id: number;
  /** Ms on the audio-file timeline (0 = first sample of the music file) */
  readonly time: number;
  readonly beat: number;
  readonly direction: Direction;
  readonly lane: number;
  readonly type: NoteType;
  /** Hold/roll tail, same timeline as `time` */
  readonly endTime?: number;
  readonly endBeat?: number;
  /** Rhythmic quantization of the row: 4, 8, 12, 16, 24, 32, 48, 64 or 192 */
  readonly quant: number;
  /** Multiplayer: injected by a rival's combo */
  readonly attackFrom?: string;
}

export interface Chart {
  difficulty: Difficulty;
  level: number;
  /** Sorted by time, then lane */
  notes: readonly Note[];
  /** Chart-specific timing (SSC charts may override song timing) */
  timing: TimingSource;
  /** Normalized groove radar (stream, voltage, air, freeze, chaos) 0..1 when the file provides one */
  radar?: number[];
}

export interface BpmChange {
  beat: number;
  bpm: number;
}

/** Freeze after the notes on `beat` */
export interface Stop {
  beat: number;
  /** Seconds */
  duration: number;
}

/** Raw timing tags, as authored in the simfile */
export interface TimingSource {
  /** Ms on the audio timeline where beat 0 lands (= -#OFFSET * 1000) */
  beat0Ms: number;
  bpms: BpmChange[];
  stops: Stop[];
  /** Freeze before the notes on `beat` */
  delays: Stop[];
}

export interface Song {
  id: string;
  title: string;
  subtitle?: string;
  artist: string;
  /** Display BPM (first BPM) */
  bpm: number;
  musicFile: string;
  /** Seconds */
  previewStart: number;
  previewLength: number;
  charts: Chart[];
  pack?: string;
  timing: TimingSource;
  basePath?: string;
  banner?: string;
  background?: string;
  /** Square cover art (.ssc #JACKET) */
  jacket?: string;
  /** True when the simfile has no audio (`#MUSIC:virtual;`) — runs on a silent clock */
  silent?: boolean;
}

export interface SongPack {
  name: string;
  songs: Song[];
}

// ============================================================================
// Input
// ============================================================================

export interface InputEvent {
  direction: Direction;
  /** performance.now() timeline (KeyboardEvent.timeStamp / Gamepad.timestamp) */
  timestamp: number;
  pressed: boolean;
}

// ============================================================================
// Screens / results
// ============================================================================

export type GameScreen = 'loading' | 'song-select' | 'gameplay' | 'results' | 'calibration';

export interface DirectionStats {
  count: number;
  avgTiming: number;
  timings: number[];
}

export interface HitSample {
  /** Real ms, + = late */
  offset: number;
  quant: number;
  /** Part of a jump/hand (2+ notes on the row) */
  jump: boolean;
  lane: number;
}

export interface ErrorMark {
  /** Song time (ms) */
  time: number;
  kind: 'miss' | 'boo' | 'good' | 'ng' | 'mine';
}

export interface ResultsData {
  song: Song;
  chart: Chart;
  /** 0..1,000,000 */
  score: number;
  exScore: number;
  maxExScore: number;
  grade: LetterGrade;
  maxCombo: number;
  judgmentCounts: Record<JudgmentGrade, number>;
  holdCounts: Record<HoldGrade, number>;
  minesHit: number;
  totalNotes: number;
  /** 0..100 */
  percentage: number;
  failed: boolean;
  /** No good/boo/miss, no NG, no mine hit */
  isFullCombo: boolean;
  /** Signed offsets (ms, + = late) of every non-miss tap */
  offsets: number[];
  /** Every non-miss tap with its context, for the precision breakdown */
  hits: HitSample[];
  /** Miss / boo / good / N.G. / mine, with their song time — the error heatmap */
  errors: ErrorMark[];
  /** Points lost (0..1,000,000 scale) at each 1% of the chart judged — the pacemaker reference */
  lossCurve: number[];
  /** Music rate the run was played at (≠ 1 is practice: not saved as a record) */
  rate: number;
  /** Life after each judgment, with its song time */
  lifeHistory: { time: number; life: number }[];
  directionStats: Record<Direction, DirectionStats>;
  autoplay: boolean;
}

// ============================================================================
// Settings
// ============================================================================

export type Perspective = 'flat' | 'tilted';

export interface Settings {
  /** Global offset in ms: + means you hear the music later than the game assumes */
  offsetMs: number;
  /** Constant scroll speed, StepMania C-mod units (arrow pixels per second at 480p) */
  cmod: number;
  perspective: Perspective;
  /** Clap on every note, scheduled on the audio clock — also the quickest way to check sync */
  assistTick: boolean;
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  /** Music rate for practice (pitch follows) */
  rate: number;
  /** Show the ms offset under every judgment, Marvelous included */
  showHitMs: boolean;
  /** No bloom, bursts, particles or glows: only notes and receptors */
  focus: boolean;
}

export const RATE_OPTIONS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.2, 1.3, 1.5] as const;

/** C-mod in steps of 25 between 300 and 1200 */
export const CMOD_OPTIONS = Array.from({ length: 37 }, (_, i) => 300 + i * 25);

export const DEFAULT_SETTINGS: Settings = {
  offsetMs: 0,
  cmod: 500,
  perspective: 'flat',
  assistTick: false,
  musicVolume: 0.9,
  sfxVolume: 0.8,
  voiceVolume: 0.9,
  rate: 1,
  showHitMs: false,
  focus: false,
};
