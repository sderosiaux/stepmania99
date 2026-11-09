import type { Settings } from '../types';
import { CMOD_OPTIONS, RATE_OPTIONS, RECEPTOR_STYLES, RECEPTOR_STYLE_LABELS } from '../types';

// ============================================================================
// Player options: what each one does, its hotkeys, one step of its value.
// The song-select bar keeps what changes from one run to the next (speed, rate)
// and whatever stops a run from setting a record; everything set once lives in
// the options panel. Hotkeys work from song select whether the panel is open or not.
// ============================================================================

export type OptionKind = 'speed' | 'offset' | 'perspective' | 'assist' | 'rate' | 'hitms' | 'focus' | 'receptors' | 'nohands';
export type OptionId = OptionKind | 'calibrate';

export interface OptionDef {
  label: string;
  /** Hotkeys as printed on the keycaps */
  keys: string[];
  hint: string;
  value: (s: Settings) => string;
  /** The value keeps the run from setting a record */
  warn?: (s: Settings) => boolean;
  /** Not offered in a battle room: every player must play the same chart, at the same rate */
  solo?: boolean;
}

export const OPTIONS: Record<OptionId, OptionDef> = {
  speed: { label: 'Speed', keys: ['−', '='], hint: 'Constant scroll speed, whatever the BPM', value: (s) => `C${s.cmod}` },
  rate: {
    label: 'Rate',
    keys: [',', '.'],
    hint: 'Music speed for practice; pitch follows. Records only at 1.00×',
    value: (s) => `${s.rate.toFixed(2)}×`,
    warn: (s) => s.rate !== 1,
    solo: true,
  },
  offset: {
    label: 'Offset',
    keys: ['[', ']'],
    hint: 'Audio delay of your setup: + when you hear the music late',
    value: (s) => `${s.offsetMs > 0 ? '+' : ''}${s.offsetMs} ms`,
  },
  calibrate: { label: 'Calibrate', keys: ['C'], hint: 'Tap along to a metronome to measure the offset', value: () => 'Tap test', solo: true },
  assist: { label: 'Assist tick', keys: ['T'], hint: 'A clap on every note: the quickest way to check sync', value: (s) => (s.assistTick ? 'On' : 'Off') },
  hitms: { label: 'Hit ms', keys: ['H'], hint: 'How early or late each hit was, under every judgment', value: (s) => (s.showHitMs ? 'Every hit' : 'Off') },
  perspective: { label: 'View', keys: ['P'], hint: 'Flat lanes, or a highway tilted into the distance', value: (s) => (s.perspective === 'flat' ? 'Classic' : 'Highway') },
  receptors: { label: 'Receptors', keys: ['R'], hint: 'Look of the arrows notes are judged against', value: (s) => RECEPTOR_STYLE_LABELS[s.receptorStyle] },
  focus: { label: 'Effects', keys: ['V'], hint: 'Focus drops bloom, bursts and particles: only notes and receptors', value: (s) => (s.focus ? 'Focus' : 'Full') },
  nohands: {
    label: 'No hands',
    keys: ['N'],
    hint: '3 or 4 arrows at once become jumps; runs don’t set records',
    value: (s) => (s.noHands ? 'On' : 'Off'),
    warn: (s) => s.noHands,
    solo: true,
  },
};

/** Always on the song-select bar */
export const BAR_OPTIONS: OptionKind[] = ['speed', 'rate'];

export const PANEL_GROUPS: { title: string; ids: OptionId[] }[] = [
  { title: 'Timing', ids: ['offset', 'calibrate', 'assist', 'hitms'] },
  { title: 'Display', ids: ['perspective', 'receptors', 'focus'] },
  { title: 'Chart', ids: ['nohands'] },
];

/** The option a key drives, and which way */
export function optionForKey(e: Pick<KeyboardEvent, 'code' | 'shiftKey'>): { id: OptionId; dir: number } | null {
  switch (e.code) {
    case 'Minus':
      return { id: 'speed', dir: -1 };
    case 'Equal':
      return { id: 'speed', dir: 1 };
    case 'BracketLeft':
      return { id: 'offset', dir: -1 };
    case 'BracketRight':
      return { id: 'offset', dir: 1 };
    case 'Comma':
      return { id: 'rate', dir: -1 };
    case 'Period':
      return { id: 'rate', dir: 1 };
    case 'KeyP':
      return { id: 'perspective', dir: 1 };
    case 'KeyT':
      return { id: 'assist', dir: 1 };
    case 'KeyH':
      return { id: 'hitms', dir: 1 };
    case 'KeyV':
      return { id: 'focus', dir: 1 };
    case 'KeyR':
      return { id: 'receptors', dir: e.shiftKey ? -1 : 1 };
    case 'KeyN':
      return { id: 'nohands', dir: 1 };
    case 'KeyC':
      return { id: 'calibrate', dir: 1 };
    default:
      return null;
  }
}

/** One step of an option; toggles flip whatever the direction */
export function stepOption(settings: Settings, kind: OptionKind, dir: number): Settings {
  const s = { ...settings };
  const step = (opts: readonly number[], cur: number, fallback: number) => {
    const i = opts.indexOf(cur);
    return opts[Math.max(0, Math.min(opts.length - 1, (i < 0 ? fallback : i) + dir))]!;
  };
  switch (kind) {
    case 'speed':
      s.cmod = step(CMOD_OPTIONS, s.cmod, 8);
      break;
    case 'offset':
      s.offsetMs = Math.max(-300, Math.min(300, s.offsetMs + dir * 5));
      break;
    case 'rate':
      s.rate = step(RATE_OPTIONS, s.rate, RATE_OPTIONS.indexOf(1));
      break;
    case 'perspective':
      s.perspective = s.perspective === 'flat' ? 'tilted' : 'flat';
      break;
    case 'assist':
      s.assistTick = !s.assistTick;
      break;
    case 'hitms':
      s.showHitMs = !s.showHitMs;
      break;
    case 'nohands':
      s.noHands = !s.noHands;
      break;
    case 'focus':
      s.focus = !s.focus;
      break;
    case 'receptors': {
      const n = RECEPTOR_STYLES.length;
      s.receptorStyle = RECEPTOR_STYLES[(RECEPTOR_STYLES.indexOf(s.receptorStyle) + dir + n) % n]!;
      break;
    }
  }
  return s;
}
