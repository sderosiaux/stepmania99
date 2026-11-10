import type { JudgmentGrade, HoldGrade } from '../types';

// ============================================================================
// Design tokens shared by the WebGL playfield and the DOM HUD.
// CSS reads the same values through custom properties (see applyThemeVars).
// ============================================================================

export const THEME = {
  bg: {
    void: '#05040d',
    deep: '#0b0920',
    horizon: '#2a0e4a',
  },
  text: {
    primary: '#ffffff',
    secondary: '#b7b3d9',
    muted: '#6d6890',
  },
  accent: {
    cyan: '#22e7ff',
    magenta: '#ff2bd6',
    violet: '#8b5cff',
    gold: '#ffd23f',
    danger: '#ff3355',
    success: '#3dffa2',
  },
  /** Note color by rhythmic quantization (StepMania "note" convention) */
  quant: {
    4: '#ff2a55',
    8: '#2f7bff',
    12: '#c94cff',
    16: '#ffd400',
    24: '#ff7ad9',
    32: '#ff8c1a',
    48: '#22e7ff',
    64: '#3dffa2',
    192: '#9aa3c7',
  } as Record<number, string>,
  lane: ['#ff2bd6', '#22e7ff', '#3dffa2', '#ff8c1a'],
  judgment: {
    marvelous: '#e8fbff',
    perfect: '#ffd23f',
    great: '#3dffa2',
    good: '#2fa8ff',
    boo: '#b45cff',
    miss: '#ff3355',
  } as Record<JudgmentGrade, string>,
  hold: {
    body: '#3dffa2',
    roll: '#ffb21a',
    dead: '#3a3a52',
  },
  holdGrade: { ok: '#3dffa2', ng: '#ff3355' } as Record<HoldGrade, string>,
  mine: '#ff2244',
} as const;

type Widen<T> = T extends string ? string : { readonly [K in keyof T]: Widen<T[K]> };
export type Palette = Widen<typeof THEME>;

/**
 * Night: the colors of a run in a dark room. Each note color keeps its hue family, so the rhythm reads
 * as it always did, but they all sit at the same low luminance (about 0.15, where full yellow is 0.7
 * and full blue 0.07): no class of note is a flash next to the others. No white anywhere: marvelous
 * is a grey-blue, text a warm grey. Receptors share one neutral color, so the notes are what stands out.
 */
export const NIGHT: Palette = {
  ...THEME,
  bg: { void: '#000000', deep: '#050508', horizon: '#0a0910' },
  text: { primary: '#a39f98', secondary: '#6e6a72', muted: '#4a4752' },
  accent: { cyan: '#2f7f8a', magenta: '#8a3a78', violet: '#2c2647', gold: '#8a6a1a', danger: '#a03446', success: '#2f7f58' },
  quant: {
    4: '#b8323c',
    8: '#3f63c8',
    12: '#8a4bb8',
    16: '#8a6a1a',
    24: '#b05088',
    32: '#a8521c',
    48: '#24767f',
    64: '#2a7a4e',
    192: '#666a7c',
  },
  lane: ['#55536e', '#55536e', '#55536e', '#55536e'],
  judgment: { marvelous: '#73848d', perfect: '#9a8236', great: '#3f8f66', good: '#3f78a8', boo: '#7a4f9c', miss: '#a03446' },
  hold: { body: '#2b6f52', roll: '#8a6420', dead: '#2a2a38' },
  holdGrade: { ok: '#2f7f58', ng: '#a03446' },
  mine: '#8f2433',
};

/**
 * Night notes keep the full quantization color on the bevel; the face is that color mixed
 * NIGHT_NOTE_DARK of the way into a night blue. A near-black face (#070a16, mix 1) was tried first:
 * least light, but the arrows had no mass left and were too hard to follow in play. Also turned down:
 * a slate body with a colored core, a bare outline, a night-blue monochrome (24ths to 64ths merged).
 */
export const NIGHT_NOTE_BODY = '#141a33';
export const NIGHT_NOTE_DARK = 0.5;

export const JUDGMENT_LABEL: Record<JudgmentGrade, string> = {
  marvelous: 'MARVELOUS',
  perfect: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  boo: 'BOO',
  miss: 'MISS',
};

export function applyThemeVars(theme: Palette = THEME, root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--bg-void': theme.bg.void,
    '--bg-deep': theme.bg.deep,
    '--bg-horizon': theme.bg.horizon,
    '--text-primary': theme.text.primary,
    '--text-secondary': theme.text.secondary,
    '--text-muted': theme.text.muted,
    '--accent-cyan': theme.accent.cyan,
    '--accent-magenta': theme.accent.magenta,
    '--accent-violet': theme.accent.violet,
    '--accent-gold': theme.accent.gold,
    '--accent-danger': theme.accent.danger,
    '--accent-success': theme.accent.success,
  };
  for (const [g, c] of Object.entries(theme.judgment)) vars[`--judge-${g}`] = c;
  theme.lane.forEach((c, i) => (vars[`--lane-${i}`] = c));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
