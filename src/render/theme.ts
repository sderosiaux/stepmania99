/**
 * Theme and Design System
 *
 * Centralized color palette, layout constants, and direction mappings.
 */

import type { Direction } from '../types';

// ============================================================================
// Theme / Design System
// ============================================================================

export const THEME = {
  // Background colors
  bg: {
    primary: '#0a0a0f',
    secondary: '#12121a',
    tertiary: '#1a1a25',
    overlay: 'rgba(0, 0, 0, 0.5)',
  },
  // Text colors
  text: {
    primary: '#ffffff',
    secondary: '#a0a0b0',
    muted: '#606070',
  },
  // Arrow colors by direction (classic DDR style) - used for receptors
  arrows: {
    left: '#c850c0',    // Magenta/Pink
    down: '#4fc3f7',    // Light Blue
    up: '#66bb6a',      // Green
    right: '#ff7043',   // Orange/Red
  },
  // Beat subdivision colors (ultra-brilliant neon)
  beatColors: {
    4: '#ff0040',   // 1/4 notes (quarter notes) - Neon Red
    8: '#0066ff',   // 1/8 notes (eighth notes) - Strong Blue
    12: '#ff00ff',  // 1/12 notes (triplets) - Neon Magenta
    16: '#ffff00',  // 1/16 notes (sixteenth notes) - Neon Yellow
    24: '#ff0080',  // 1/24 notes - Neon Hot Pink
    32: '#ff8000',  // 1/32 notes - Neon Orange
    48: '#00ffff',  // 1/48 notes - Neon Cyan
    64: '#00ff80',  // 1/64 notes - Neon Green
    other: '#b0bec5', // Other subdivisions - Light Gray
  },
  // Judgment colors
  judgment: {
    marvelous: '#00ffff',
    perfect: '#ffff00',
    great: '#00ff00',
    good: '#0088ff',
    boo: '#ff00ff',
    miss: '#ff0000',
  },
  // UI accents
  accent: {
    primary: '#00d4ff',
    secondary: '#ff00aa',
    success: '#00ff88',
    warning: '#ffaa00',
    error: '#ff4444',
  },
} as const;

// ============================================================================
// Layout Constants
// ============================================================================

export const LAYOUT = {
  /** Distance from top where receptors sit (as fraction of canvas height) */
  receptorY: 0.12,
  /** Arrow size in pixels */
  arrowSize: 80,
  /** Gap between arrow columns */
  arrowGap: 4,
  /** Scroll speed: pixels per millisecond */
  scrollSpeed: 0.5,
  /** How far ahead to render notes (in ms) */
  lookAhead: 2500,
  /** Receptor glow duration on press (ms) */
  receptorGlowDuration: 100,
  /** Guitar Hero perspective: vanishing point Y position (as fraction of height) */
  vanishingY: 0.35,
  /** Guitar Hero perspective: scale at vanishing point (0-1) */
  horizonScale: 0.15,
} as const;

/** Direction to rotation angle mapping (arrow points up by default) */
export const DIRECTION_ROTATIONS: Record<Direction, number> = {
  up: 0,
  down: Math.PI,
  left: -Math.PI / 2,
  right: Math.PI / 2,
};
