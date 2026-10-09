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

export const JUDGMENT_LABEL: Record<JudgmentGrade, string> = {
  marvelous: 'MARVELOUS',
  perfect: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  boo: 'BOO',
  miss: 'MISS',
};

export function applyThemeVars(root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--bg-void': THEME.bg.void,
    '--bg-deep': THEME.bg.deep,
    '--bg-horizon': THEME.bg.horizon,
    '--text-primary': THEME.text.primary,
    '--text-secondary': THEME.text.secondary,
    '--text-muted': THEME.text.muted,
    '--accent-cyan': THEME.accent.cyan,
    '--accent-magenta': THEME.accent.magenta,
    '--accent-violet': THEME.accent.violet,
    '--accent-gold': THEME.accent.gold,
    '--accent-danger': THEME.accent.danger,
    '--accent-success': THEME.accent.success,
  };
  for (const [g, c] of Object.entries(THEME.judgment)) vars[`--judge-${g}`] = c;
  THEME.lane.forEach((c, i) => (vars[`--lane-${i}`] = c));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
