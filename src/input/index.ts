import type { Direction } from '../types';
import { KEY_TO_DIRECTION, DIRECTIONS } from '../types';

// ============================================================================
// Gameplay input
//
// Timestamps come from the event itself (KeyboardEvent.timeStamp,
// Gamepad.timestamp), not from when we get to process it, so a busy frame
// never shifts a judgment. Each physical key is tracked separately: a lane
// is released only when its last key goes up, and every key-down is a step.
// ============================================================================

export interface LaneInput {
  lane: number;
  /** performance.now() timeline */
  timestamp: number;
  pressed: boolean;
}

const LANE: Record<Direction, number> = { left: 0, down: 1, up: 2, right: 3 };

/** Standard-mapping d-pad, and the button order most USB dance pads report */
const PAD_STANDARD: Record<number, number> = { 14: 0, 13: 1, 12: 2, 15: 3 };
const PAD_RAW: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3 };

export class InputManager {
  private queue: LaneInput[] = [];
  private keysDown = new Map<string, number>();
  private padDown = new Map<string, number>();
  private enabled = false;

  private onKeyDown = (e: KeyboardEvent) => {
    const dir = KEY_TO_DIRECTION[e.code];
    if (!dir) return;
    e.preventDefault();
    if (!this.enabled || e.repeat || this.keysDown.has(e.code)) return;
    const lane = LANE[dir];
    this.keysDown.set(e.code, lane);
    this.queue.push({ lane, timestamp: e.timeStamp, pressed: true });
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const lane = this.keysDown.get(e.code);
    if (lane === undefined) return;
    e.preventDefault();
    this.keysDown.delete(e.code);
    if (!this.isLaneHeld(lane)) this.queue.push({ lane, timestamp: e.timeStamp, pressed: false });
  };

  private onBlur = () => this.releaseAll(performance.now());

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.queue = [];
    this.keysDown.clear();
    this.padDown.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  stop(): void {
    this.enabled = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.queue = [];
    this.keysDown.clear();
    this.padDown.clear();
  }

  /** Release every held lane (pause, focus loss) */
  releaseAll(timestamp: number): void {
    const lanes = new Set([...this.keysDown.values(), ...this.padDown.values()]);
    this.keysDown.clear();
    this.padDown.clear();
    for (const lane of lanes) this.queue.push({ lane, timestamp, pressed: false });
  }

  isLaneHeld(lane: number): boolean {
    for (const l of this.keysDown.values()) if (l === lane) return true;
    for (const l of this.padDown.values()) if (l === lane) return true;
    return false;
  }

  heldLanes(): boolean[] {
    return DIRECTIONS.map((_, i) => this.isLaneHeld(i));
  }

  /** Poll gamepads (call once per frame) */
  pollGamepads(): void {
    if (!this.enabled || !navigator.getGamepads) return;
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      const map = pad.mapping === 'standard' ? PAD_STANDARD : PAD_RAW;
      for (const [btn, lane] of Object.entries(map)) {
        const key = `${pad.index}:${btn}`;
        const pressed = pad.buttons[Number(btn)]?.pressed ?? false;
        const was = this.padDown.has(key);
        if (pressed && !was) {
          this.padDown.set(key, lane);
          this.queue.push({ lane, timestamp: pad.timestamp, pressed: true });
        } else if (!pressed && was) {
          this.padDown.delete(key);
          if (!this.isLaneHeld(lane)) this.queue.push({ lane, timestamp: pad.timestamp, pressed: false });
        }
      }
    }
  }

  /** Take queued inputs, chronological */
  drain(): LaneInput[] {
    const out = this.queue.sort((a, b) => a.timestamp - b.timestamp);
    this.queue = [];
    return out;
  }
}

export const input = new InputManager();
