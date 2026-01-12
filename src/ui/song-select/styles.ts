/**
 * Song Select Screen Styles
 *
 * All CSS styles for the song selection UI.
 */

import { THEME } from '../../render';

export function getSongSelectStyles(): string {
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

    /* Spectator mode - subtle overlay effect */
    .song-select-4col.spectator-mode .columns {
      pointer-events: none;
      opacity: 0.9;
    }

    /* Multiplayer bar */
    .multiplayer-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: linear-gradient(135deg, rgba(255, 0, 170, 0.12), rgba(0, 212, 255, 0.12));
      border: 1px solid rgba(255, 0, 170, 0.4);
      border-radius: 8px;
      padding: 0.6rem 1rem;
      margin-bottom: 1rem;
      gap: 1rem;
    }

    .mp-info {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      flex: 1;
    }

    .mp-room-code {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .mp-label {
      font-size: 0.65rem;
      color: ${THEME.text.muted};
      letter-spacing: 0.1em;
    }

    .mp-code {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 1rem;
      font-weight: 700;
      color: ${THEME.accent.primary};
      letter-spacing: 0.15em;
      background: rgba(0, 212, 255, 0.1);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    .mp-player-list {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .mp-player {
      font-size: 0.8rem;
      padding: 0.25rem 0.6rem;
      background: ${THEME.bg.tertiary};
      border-radius: 4px;
      color: ${THEME.text.secondary};
      transition: all 0.2s;
    }

    .mp-player.ready {
      background: rgba(0, 255, 136, 0.15);
      color: #00ff88;
      border: 1px solid rgba(0, 255, 136, 0.3);
    }

    .mp-player.empty {
      color: ${THEME.text.muted};
      font-style: italic;
      border: 1px dashed ${THEME.bg.tertiary};
      background: transparent;
    }

    .mp-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .mp-ready-status {
      font-size: 0.8rem;
      color: ${THEME.text.secondary};
      padding: 0 0.5rem;
    }

    .mp-ready-status.all-ready {
      color: #00ff88;
      font-weight: 600;
    }

    .mp-ready-btn {
      padding: 0.5rem 1rem;
      border: 1px solid ${THEME.text.secondary};
      background: transparent;
      color: ${THEME.text.secondary};
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .mp-ready-btn:hover {
      border-color: #00ff88;
      color: #00ff88;
    }

    .mp-ready-btn.ready {
      background: rgba(0, 255, 136, 0.15);
      border-color: #00ff88;
      color: #00ff88;
    }

    .mp-start-btn {
      padding: 0.5rem 1.25rem;
      background: linear-gradient(135deg, ${THEME.accent.secondary}, #ff4488);
      border: none;
      border-radius: 6px;
      color: white;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }

    .mp-start-btn:hover:not(.disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 15px rgba(255, 0, 170, 0.4);
    }

    .mp-start-btn.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .mp-share-btn, .mp-leave-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 1rem;
    }

    .mp-share-btn {
      background: ${THEME.bg.tertiary};
      color: ${THEME.text.secondary};
    }

    .mp-share-btn:hover {
      background: ${THEME.accent.primary};
      color: ${THEME.bg.primary};
    }

    .mp-leave-btn {
      background: transparent;
      color: ${THEME.text.muted};
    }

    .mp-leave-btn:hover {
      background: rgba(255, 68, 68, 0.15);
      color: #ff4444;
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
      animation-delay: var(--arc-animation-delay, 0ms);
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
      position: relative;
    }

    /* Curved separator line using pseudo-element that follows 3D transform */
    .list-item::after,
    .wheel-ghost::after {
      content: '';
      position: absolute;
      left: 5%;
      right: 5%;
      bottom: -2px;
      height: 1px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.15) 15%,
        rgba(255, 255, 255, 0.25) 50%,
        rgba(255, 255, 255, 0.15) 85%,
        transparent 100%
      );
      border-radius: 50%;
      transform: scaleY(0.5);
    }

    /* Ghost items to simulate wheel continuity */
    .wheel-ghost {
      height: 52px;
      min-height: 52px;
      padding: 0.6rem 0.75rem;
      margin-bottom: 0.25rem;
      flex-shrink: 0;
      box-sizing: border-box;
      border-radius: 6px;
      position: relative;
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
      animation: play-button-glow var(--glow-speed, 2s) ease-in-out infinite var(--arc-animation-delay, 0ms), play-button-shimmer 3s ease-in-out infinite var(--shimmer-animation-delay, 0ms);
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

    .cmod-selector, .offset-selector, .skin-selector {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .cmod-selector .label, .offset-selector .label, .skin-selector .label {
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

    .skin-value {
      padding: 0.3rem 0.6rem;
      background: rgba(255, 0, 170, 0.15);
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 600;
      color: ${THEME.accent.secondary};
      min-width: 80px;
      text-align: center;
    }

    .skin-btn {
      width: 28px;
      height: 28px;
      border: none;
      background: ${THEME.bg.tertiary};
      color: ${THEME.text.primary};
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .skin-btn:hover {
      background: ${THEME.accent.secondary};
      color: ${THEME.bg.primary};
    }

    .skin-btn:active {
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

    /* Multiplayer Modal */
    .mp-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .mp-modal {
      background: ${THEME.bg.secondary};
      border-radius: 16px;
      padding: 2rem;
      min-width: 400px;
      max-width: 90vw;
      position: relative;
      border: 1px solid ${THEME.bg.tertiary};
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      animation: slideUp 0.3s ease;
    }

    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .mp-modal h2 {
      margin: 0 0 1.5rem 0;
      font-size: 1.5rem;
      background: linear-gradient(135deg, ${THEME.accent.primary}, ${THEME.accent.secondary});
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-align: center;
    }

    .mp-section {
      margin-bottom: 1rem;
    }

    .mp-section h3 {
      font-size: 0.9rem;
      color: ${THEME.text.secondary};
      margin: 0 0 0.75rem 0;
      font-weight: 500;
    }

    .mp-input-row {
      display: flex;
      gap: 0.5rem;
    }

    .mp-input-row input {
      flex: 1;
      padding: 0.75rem 1rem;
      background: ${THEME.bg.tertiary};
      border: 1px solid transparent;
      border-radius: 8px;
      color: ${THEME.text.primary};
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
    }

    .mp-input-row input:focus {
      border-color: ${THEME.accent.primary};
    }

    .mp-input-row input::placeholder {
      color: ${THEME.text.muted};
    }

    .mp-btn {
      padding: 0.75rem 1.25rem;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .mp-btn-primary {
      background: linear-gradient(135deg, ${THEME.accent.primary}, ${THEME.accent.secondary});
      color: white;
    }

    .mp-btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3);
    }

    .mp-btn-secondary {
      background: ${THEME.bg.tertiary};
      color: ${THEME.text.primary};
    }

    .mp-btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .mp-divider {
      display: flex;
      align-items: center;
      gap: 1rem;
      color: ${THEME.text.muted};
      margin: 1.25rem 0;
      font-size: 0.8rem;
    }

    .mp-divider::before,
    .mp-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: ${THEME.bg.tertiary};
    }

    .mp-error {
      background: rgba(255, 68, 68, 0.15);
      color: #ff6666;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-top: 1rem;
      text-align: center;
    }

    .mp-error.hidden {
      display: none;
    }

    .mp-close {
      position: absolute;
      top: 1rem;
      right: 1rem;
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      color: ${THEME.text.muted};
      font-size: 1.25rem;
      cursor: pointer;
      border-radius: 50%;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .mp-close:hover {
      background: ${THEME.bg.tertiary};
      color: ${THEME.text.primary};
    }
  </style>`;
}
