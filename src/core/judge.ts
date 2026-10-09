import type { Note, JudgmentGrade, HoldGrade } from '../types';
import { TIMING_WINDOWS, HOLD_RELEASE_WINDOW_MS, ROLL_TAP_WINDOW_MS, MINE_WINDOW_MS } from '../types';

// ============================================================================
// Judge engine
//
// Event-driven: the controller feeds presses/releases with their own
// timestamps (already mapped to song time) in chronological order, and calls
// advance() up to "now" before each input and once per frame. Judgments never
// depend on frame rate.
// ============================================================================

export type JudgeEvent =
  | { kind: 'tap'; note: Note; grade: JudgmentGrade; offset: number; time: number }
  | { kind: 'hold'; note: Note; grade: HoldGrade; time: number }
  | { kind: 'mine'; note: Note; time: number };

export interface HoldRuntime {
  /** Head was hit and the tail is not resolved yet */
  active: boolean;
  /** 1 = fully alive, 0 = NG */
  life: number;
  result?: HoldGrade;
  /** Song time when the hold was released for good (NG) — renderer greys the body from there */
  droppedAt?: number;
}

export interface NoteRuntime {
  resolved: boolean;
  grade?: JudgmentGrade;
  /** Real ms, + = late */
  offset?: number;
  /** Song time of the press that judged the head */
  hitAt?: number;
  hold?: HoldRuntime;
  mineHit?: boolean;
}

export function gradeForOffset(offset: number): JudgmentGrade {
  const abs = Math.abs(offset);
  if (abs <= TIMING_WINDOWS.marvelous) return 'marvelous';
  if (abs <= TIMING_WINDOWS.perfect) return 'perfect';
  if (abs <= TIMING_WINDOWS.great) return 'great';
  if (abs <= TIMING_WINDOWS.good) return 'good';
  if (abs <= TIMING_WINDOWS.boo) return 'boo';
  return 'miss';
}

const isLong = (n: Note) => n.type === 'hold' || n.type === 'roll';

export class JudgeEngine {
  private readonly notes: Note[];
  readonly runtime: Map<number, NoteRuntime> = new Map();
  /** Note indices per lane, chronological */
  private lanes: number[][] = [[], [], [], []];
  /** First index (into lanes[lane]) that may still be unresolved */
  private cursor = [0, 0, 0, 0];
  private held = [false, false, false, false];
  private active: Note[] = [];
  private lastTime = -Infinity;
  /** Windows are real time (StepMania divides offsets by the music rate); in song time they scale with the rate */
  private readonly w: { boo: number; mine: number; hold: number; roll: number };

  /** `rate` = music rate (0.5–1.5). Event offsets are reported in real milliseconds. */
  constructor(
    notes: readonly Note[],
    private readonly rate = 1
  ) {
    this.notes = [...notes];
    this.w = { boo: TIMING_WINDOWS.boo * rate, mine: MINE_WINDOW_MS * rate, hold: HOLD_RELEASE_WINDOW_MS * rate, roll: ROLL_TAP_WINDOW_MS * rate };
    this.reindex();
  }

  /** Inject a note mid-song (multiplayer attacks). Must be in the future. */
  addNote(note: Note): void {
    this.notes.push(note);
    this.notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
    this.reindex();
  }

  private reindex(): void {
    this.lanes = [[], [], [], []];
    this.notes.forEach((n, i) => {
      this.lanes[n.lane]!.push(i);
      if (!this.runtime.has(n.id)) {
        this.runtime.set(n.id, isLong(n) ? { resolved: false, hold: { active: false, life: 1 } } : { resolved: false });
      }
    });
    this.cursor = this.lanes.map((idx) => {
      const first = idx.findIndex((i) => !this.runtime.get(this.notes[i]!.id)!.resolved);
      return first === -1 ? idx.length : first;
    });
  }

  getNotes(): readonly Note[] {
    return this.notes;
  }

  get(note: Note): NoteRuntime {
    return this.runtime.get(note.id)!;
  }

  isHeld(lane: number): boolean {
    return this.held[lane]!;
  }

  /** Every note is resolved (tails included) */
  isComplete(): boolean {
    return this.cursor.every((c, lane) => c >= this.lanes[lane]!.length) && this.active.length === 0;
  }

  press(lane: number, t: number): JudgeEvent[] {
    const events = this.advance(t);
    this.held[lane] = true;

    // A press during an active roll re-arms the roll and is consumed by it
    const roll = this.active.find((n) => n.lane === lane && n.type === 'roll' && t < n.endTime!);
    if (roll) {
      this.get(roll).hold!.life = 1;
      return events;
    }

    // Like StepMania, only the closest note is judged — mines included
    const idx = this.lanes[lane]!;
    let best: Note | null = null;
    let bestAbs = Infinity;
    let mine: Note | null = null;
    let mineAbs = Infinity;
    for (let k = this.cursor[lane]!; k < idx.length; k++) {
      const n = this.notes[idx[k]!]!;
      const diff = t - n.time;
      if (diff < -this.w.boo) break;
      const rt = this.get(n);
      if (n.type === 'mine') {
        if (!rt.resolved && Math.abs(diff) <= this.w.mine && Math.abs(diff) < mineAbs) {
          mineAbs = Math.abs(diff);
          mine = n;
        }
        continue;
      }
      if (rt.grade !== undefined || rt.resolved) continue;
      if (Math.abs(diff) < bestAbs) {
        bestAbs = Math.abs(diff);
        best = n;
      }
    }

    if (mine && mineAbs < bestAbs) {
      events.push(this.explode(mine, t));
    } else if (best && bestAbs <= this.w.boo) {
      const offset = (t - best.time) / this.rate;
      const grade = gradeForOffset(offset);
      const rt = this.get(best);
      rt.grade = grade;
      rt.offset = offset;
      rt.hitAt = t;
      if (isLong(best)) {
        rt.hold!.active = true;
        rt.hold!.life = 1;
        this.active.push(best);
      } else {
        rt.resolved = true;
      }
      events.push({ kind: 'tap', note: best, grade, offset, time: t });
    }

    this.advanceCursor(lane);
    return events;
  }

  release(lane: number, t: number): JudgeEvent[] {
    const events = this.advance(t);
    this.held[lane] = false;
    return events;
  }

  /** Move the clock to `t`: misses, hold life, hold/roll completion, mines crossed while held. */
  advance(t: number): JudgeEvent[] {
    if (t <= this.lastTime) return [];
    const from = this.lastTime;
    this.lastTime = t;
    const events: JudgeEvent[] = [];

    // Long notes first: their life must be evaluated with the held state of [from, t)
    for (const n of [...this.active]) {
      const rt = this.get(n);
      const h = rt.hold!;
      const end = n.endTime!;
      const segEnd = Math.min(t, end);
      const segStart = Math.max(from, rt.hitAt ?? n.time);
      const span = Math.max(0, segEnd - segStart);
      const window = n.type === 'roll' ? this.w.roll : this.w.hold;
      const drains = n.type === 'roll' || !this.held[n.lane];

      if (n.type === 'hold' && this.held[n.lane]) h.life = 1;
      if (drains && span > 0) {
        const dieAt = segStart + h.life * window;
        h.life -= span / window;
        if (h.life <= 0) {
          h.life = 0;
          this.finishHold(n, 'ng', dieAt, events);
          h.droppedAt = dieAt;
          continue;
        }
      }
      if (t >= end) this.finishHold(n, 'ok', end, events);
    }

    for (let lane = 0; lane < 4; lane++) {
      const idx = this.lanes[lane]!;
      for (let k = this.cursor[lane]!; k < idx.length; k++) {
        const n = this.notes[idx[k]!]!;
        const rt = this.get(n);
        if (n.time > t) break;
        if (n.type === 'mine') {
          if (rt.resolved) continue;
          if (this.held[lane] && n.time > from) events.push(this.explode(n, n.time));
          else if (t - n.time > this.w.mine) rt.resolved = true; // avoided
          continue;
        }
        if (rt.grade !== undefined) continue;
        // Still inside its window: keep scanning, a mine behind it may be crossed while held
        if (t - n.time <= this.w.boo) continue;
        const missAt = n.time + this.w.boo;
        rt.grade = 'miss';
        rt.offset = TIMING_WINDOWS.boo;
        events.push({ kind: 'tap', note: n, grade: 'miss', offset: rt.offset, time: missAt });
        if (isLong(n)) {
          rt.hold!.droppedAt = n.time;
          this.finishHold(n, 'ng', missAt, events);
        } else {
          rt.resolved = true;
        }
      }
      this.advanceCursor(lane);
    }

    return events.sort((a, b) => a.time - b.time);
  }

  private finishHold(n: Note, grade: HoldGrade, time: number, events: JudgeEvent[]): void {
    const rt = this.get(n);
    rt.hold!.active = false;
    rt.hold!.result = grade;
    rt.resolved = true;
    this.active = this.active.filter((a) => a !== n);
    events.push({ kind: 'hold', note: n, grade, time });
  }

  private explode(n: Note, time: number): JudgeEvent {
    const rt = this.get(n);
    rt.resolved = true;
    rt.mineHit = true;
    return { kind: 'mine', note: n, time };
  }

  private advanceCursor(lane: number): void {
    const idx = this.lanes[lane]!;
    let c = this.cursor[lane]!;
    while (c < idx.length && this.get(this.notes[idx[c]!]!).resolved) c++;
    this.cursor[lane] = c;
  }
}

// ============================================================================
// Autoplay: synthesizes the inputs a perfect player would make
// ============================================================================

export interface SyntheticInput {
  lane: number;
  time: number;
  pressed: boolean;
}

export function autoplayInputs(notes: readonly Note[]): SyntheticInput[] {
  const out: SyntheticInput[] = [];
  const byLane: Note[][] = [[], [], [], []];
  for (const n of notes) if (n.type !== 'mine') byLane[n.lane]!.push(n);

  byLane.forEach((laneNotes, lane) => {
    laneNotes.forEach((n, i) => {
      const next = laneNotes[i + 1];
      out.push({ lane, time: n.time, pressed: true });
      if (n.type === 'roll') {
        for (let t = n.time + 120; t < n.endTime!; t += 120) {
          out.push({ lane, time: t - 1, pressed: false }, { lane, time: t, pressed: true });
        }
      }
      const holdUntil = isLong(n) ? n.endTime! + 20 : n.time + 40;
      const releaseAt = next ? Math.min(holdUntil, (n.time + next.time) / 2, isLong(n) ? Infinity : next.time - 1) : holdUntil;
      out.push({ lane, time: Math.max(releaseAt, isLong(n) ? n.endTime! : n.time + 1), pressed: false });
    });
  });

  return out.sort((a, b) => a.time - b.time || Number(a.pressed) - Number(b.pressed));
}
