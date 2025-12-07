import type { Direction, Note, JudgmentGrade, GameplayState } from '../types';
import { DIRECTIONS } from '../types';

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
  // Arrow colors by direction (classic DDR style)
  arrows: {
    left: '#c850c0',    // Magenta/Pink
    down: '#4fc3f7',    // Light Blue
    up: '#66bb6a',      // Green
    right: '#ff7043',   // Orange/Red
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
} as const;

// ============================================================================
// Renderer Class
// ============================================================================

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  /** Canvas dimensions */
  private width: number = 0;
  private height: number = 0;

  /** Device pixel ratio for crisp rendering */
  private dpr: number = 1;

  /** X position for each direction's column */
  private columnX: Record<Direction, number> = {
    left: 0,
    down: 0,
    up: 0,
    right: 0,
  };

  /** Y position of receptors */
  private receptorY: number = 0;

  /** Receptor glow state (timestamp when last pressed) */
  private receptorGlow: Record<Direction, number> = {
    left: 0,
    down: 0,
    up: 0,
    right: 0,
  };

  /** Last judgment to display */
  private lastJudgment: { grade: JudgmentGrade; time: number; timingDiff: number } | null = null;

  /** Current combo for display */
  private displayCombo: number = 0;


  /** Time when combo last increased */
  private comboIncreaseTime: number = 0;

  /** Hit effects queue */
  private hitEffects: { direction: Direction; grade: JudgmentGrade; time: number }[] = [];

  /** Health orb bubble animation */
  private healthBubbles: { x: number; y: number; size: number; speed: number; opacity: number }[] = [];

  /** Background flash effects on key press */
  private backgroundFlashes: { x: number; y: number; color: string; time: number }[] = [];

  /** Per-direction timing offsets for stats display */
  private directionTimings: Record<Direction, number[]> = {
    left: [],
    down: [],
    up: [],
    right: [],
  };

  /** All timing offsets (global) for average calculation */
  private allTimings: number[] = [];

  /** Current audio offset (for suggestion display) */
  private currentAudioOffset: number = 0;

  /** Smoothed health for gradual background transitions */
  private smoothedHealth: number = 50;
  private lastFrameTime: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Handle canvas resize
   */
  resize(): void {
    this.dpr = window.devicePixelRatio || 1;

    // Get the display size
    const rect = this.canvas.parentElement?.getBoundingClientRect() ?? {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    this.width = rect.width;
    this.height = rect.height;

    // Set canvas size accounting for DPR
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    // Scale context for DPR
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Calculate column positions (centered)
    const totalWidth = LAYOUT.arrowSize * 4 + LAYOUT.arrowGap * 3;
    const startX = (this.width - totalWidth) / 2;

    DIRECTIONS.forEach((dir, i) => {
      this.columnX[dir] = startX + i * (LAYOUT.arrowSize + LAYOUT.arrowGap) + LAYOUT.arrowSize / 2;
    });

    // Calculate receptor Y position
    this.receptorY = this.height * LAYOUT.receptorY;
  }

  /**
   * Clear the canvas with animated gradient background
   */
  clear(currentTime?: number, health: number = 50): void {
    // Base dark background
    this.ctx.fillStyle = THEME.bg.primary;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Animated gradient background (without flashes - those are drawn separately)
    this.drawAnimatedBackground(currentTime, health);
  }

  /**
   * Draw animated gradient background with dim overlay (health-reactive with smooth transitions)
   */
  private drawAnimatedBackground(currentTime: number = Date.now(), health: number = 50): void {
    const time = currentTime / 2000; // Animation speed

    // Calculate delta time for smooth lerping
    const deltaTime = this.lastFrameTime > 0 ? (currentTime - this.lastFrameTime) / 1000 : 0.016;
    this.lastFrameTime = currentTime;

    // Smoothly lerp towards target health (faster when dropping, slower when rising)
    const lerpSpeed = health < this.smoothedHealth ? 8 : 3; // Drop fast, recover slow
    this.smoothedHealth += (health - this.smoothedHealth) * Math.min(1, deltaTime * lerpSpeed);

    // Use smoothed health for all calculations
    const h = this.smoothedHealth;
    const isLowHealth = h < 30;
    const isHighHealth = h > 75;
    const isCriticalHealth = h < 15;

    // Pulse speed increases when health is low
    const pulseSpeed = isCriticalHealth ? 10 : (isLowHealth ? 5 : 1);
    const pulse = Math.sin(currentTime / (200 / pulseSpeed)) * 0.5 + 0.5;

    // Create moving gradient points
    const cx1 = this.width * (0.3 + 0.25 * Math.sin(time * 0.7));
    const cy1 = this.height * (0.3 + 0.25 * Math.cos(time * 0.5));
    const cx2 = this.width * (0.7 + 0.25 * Math.cos(time * 0.6));
    const cy2 = this.height * (0.7 + 0.25 * Math.sin(time * 0.8));

    // Define color stops for different health ranges
    let color1, color2, color3;

    if (isCriticalHealth) {
      // Critical: intense pulsing red
      const intensity = 0.5 + pulse * 0.35;
      color1 = { r: 255, g: 20, b: 20, a: intensity };
      color2 = { r: 200, g: 0, b: 50, a: intensity * 0.8 };
      color3 = { r: 255, g: 50, b: 30, a: intensity * 0.6 };
    } else if (isLowHealth) {
      // Low: red/orange warning - blend based on how low
      const lowBlend = (30 - h) / 15; // 0 at 30, 1 at 15
      const intensity = 0.35 + pulse * 0.15 + lowBlend * 0.1;
      color1 = {
        r: Math.round(180 + lowBlend * 75),
        g: Math.round(80 - lowBlend * 60),
        b: Math.round(50 - lowBlend * 30),
        a: intensity
      };
      color2 = {
        r: Math.round(200 + lowBlend * 55),
        g: Math.round(100 - lowBlend * 80),
        b: Math.round(20),
        a: intensity * 0.7
      };
      color3 = {
        r: Math.round(220 + lowBlend * 35),
        g: Math.round(80 - lowBlend * 50),
        b: Math.round(40 - lowBlend * 20),
        a: intensity * 0.5
      };
    } else if (isHighHealth) {
      // High: vibrant green/cyan - more intense
      const highBlend = (h - 75) / 25; // 0 at 75, 1 at 100
      color1 = {
        r: 0,
        g: Math.round(200 + highBlend * 55),
        b: Math.round(150 + highBlend * 50),
        a: 0.4 + highBlend * 0.15
      };
      color2 = {
        r: 0,
        g: Math.round(180 + highBlend * 40),
        b: Math.round(200 + highBlend * 30),
        a: 0.35 + highBlend * 0.1
      };
      color3 = {
        r: Math.round(50 + highBlend * 30),
        g: Math.round(255),
        b: Math.round(180 + highBlend * 40),
        a: 0.3 + highBlend * 0.1
      };
    } else {
      // Normal (30-75): purple/blue/teal - blend between low-warning and high-good
      const normalBlend = (h - 30) / 45; // 0 at 30, 1 at 75
      color1 = {
        r: Math.round(180 - normalBlend * 30),
        g: Math.round(80 * normalBlend),
        b: Math.round(100 + normalBlend * 80),
        a: 0.35
      };
      color2 = {
        r: Math.round(100 - normalBlend * 100),
        g: Math.round(100 + normalBlend * 50),
        b: Math.round(180 + normalBlend * 40),
        a: 0.3
      };
      color3 = {
        r: Math.round(50 - normalBlend * 50),
        g: Math.round(150 + normalBlend * 50),
        b: Math.round(180 + normalBlend * 20),
        a: 0.25
      };
    }

    // First gradient blob - larger and more intense
    const gradient1 = this.ctx.createRadialGradient(
      cx1, cy1, 0,
      cx1, cy1, this.width * 0.8
    );
    gradient1.addColorStop(0, `rgba(${color1.r}, ${color1.g}, ${color1.b}, ${color1.a})`);
    gradient1.addColorStop(0.3, `rgba(${color1.r}, ${color1.g}, ${color1.b}, ${color1.a * 0.7})`);
    gradient1.addColorStop(0.6, `rgba(${color1.r}, ${color1.g}, ${color1.b}, ${color1.a * 0.3})`);
    gradient1.addColorStop(1, 'transparent');

    this.ctx.fillStyle = gradient1;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Second gradient blob
    const gradient2 = this.ctx.createRadialGradient(
      cx2, cy2, 0,
      cx2, cy2, this.width * 0.7
    );
    gradient2.addColorStop(0, `rgba(${color2.r}, ${color2.g}, ${color2.b}, ${color2.a})`);
    gradient2.addColorStop(0.35, `rgba(${color2.r}, ${color2.g}, ${color2.b}, ${color2.a * 0.6})`);
    gradient2.addColorStop(0.7, `rgba(${color2.r}, ${color2.g}, ${color2.b}, ${color2.a * 0.2})`);
    gradient2.addColorStop(1, 'transparent');

    this.ctx.fillStyle = gradient2;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Third gradient blob - moves differently
    const cx3 = this.width * (0.5 + 0.3 * Math.sin(time * 0.4 + 1));
    const cy3 = this.height * (0.6 + 0.25 * Math.cos(time * 0.3 + 2));

    const gradient3 = this.ctx.createRadialGradient(
      cx3, cy3, 0,
      cx3, cy3, this.width * 0.6
    );
    gradient3.addColorStop(0, `rgba(${color3.r}, ${color3.g}, ${color3.b}, ${color3.a})`);
    gradient3.addColorStop(0.4, `rgba(${color3.r}, ${color3.g}, ${color3.b}, ${color3.a * 0.5})`);
    gradient3.addColorStop(1, 'transparent');

    this.ctx.fillStyle = gradient3;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Dim overlay - less dim for more intense colors
    const dimOpacity = isCriticalHealth ? 0.25 : (isLowHealth ? 0.32 : (isHighHealth ? 0.35 : 0.4));
    this.ctx.fillStyle = `rgba(10, 10, 15, ${dimOpacity})`;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Trigger a background flash effect on key press
   */
  triggerBackgroundFlash(direction: Direction, time: number): void {
    const x = this.columnX[direction];
    const color = THEME.arrows[direction];
    this.backgroundFlashes.push({ x, y: this.receptorY, color, time });
    // Keep only recent flashes
    this.backgroundFlashes = this.backgroundFlashes.filter(f => time - f.time < 600);
  }

  /**
   * Draw receptor flash effects on key press (interior highlight)
   */
  drawLaneFlashes(currentTime: number): void {
    const flashDuration = 120; // Shorter duration

    for (const flash of this.backgroundFlashes) {
      const elapsed = currentTime - flash.time;
      if (elapsed > flashDuration) continue;

      const progress = elapsed / flashDuration;
      // Reduced opacity - start at 0.5 and fade out quickly
      const alpha = 0.5 * (1 - progress * progress);

      // Get direction from x position
      let dir: Direction = 'left';
      for (const d of DIRECTIONS) {
        if (Math.abs(this.columnX[d] - flash.x) < 5) {
          dir = d;
          break;
        }
      }

      // Draw filled arrow interior
      this.ctx.save();
      this.ctx.translate(flash.x, this.receptorY);

      const rotations: Record<Direction, number> = {
        up: 0,
        down: Math.PI,
        left: -Math.PI / 2,
        right: Math.PI / 2,
      };
      this.ctx.rotate(rotations[dir]);

      const s = LAYOUT.arrowSize / 2 * 0.85; // Slightly smaller

      // Arrow shape path
      this.ctx.beginPath();
      this.ctx.moveTo(0, -s * 0.95);
      this.ctx.lineTo(s * 0.95, s * 0.1);
      this.ctx.lineTo(s * 0.35, s * 0.1);
      this.ctx.lineTo(s * 0.35, s * 0.95);
      this.ctx.lineTo(-s * 0.35, s * 0.95);
      this.ctx.lineTo(-s * 0.35, s * 0.1);
      this.ctx.lineTo(-s * 0.95, s * 0.1);
      this.ctx.closePath();

      // Fill with the arrow's color (subtle highlight, not white)
      const baseColor = this.hexToRgb(flash.color);
      // Only lighten slightly instead of going near-white
      const r = Math.min(255, baseColor.r + 40);
      const g = Math.min(255, baseColor.g + 40);
      const b = Math.min(255, baseColor.b + 40);
      this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      this.ctx.fill();

      this.ctx.restore();
    }
  }

  /**
   * Convert hex to RGB object
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }

  /**
   * Record a timing offset for a direction
   */
  recordTiming(direction: Direction, timingDiff: number): void {
    this.directionTimings[direction].push(timingDiff);
    // Keep only last 50 timings per direction
    if (this.directionTimings[direction].length > 50) {
      this.directionTimings[direction].shift();
    }

    // Also track global timings
    this.allTimings.push(timingDiff);
    // Keep only last 100 timings globally
    if (this.allTimings.length > 100) {
      this.allTimings.shift();
    }
  }

  /**
   * Reset timing stats and background state (for new game)
   */
  resetTimings(): void {
    this.directionTimings = {
      left: [],
      down: [],
      up: [],
      right: [],
    };
    this.allTimings = [];
    // Reset smoothed health to starting value
    this.smoothedHealth = 50;
    this.lastFrameTime = 0;
  }

  /**
   * Set the current audio offset (for displaying suggested offset)
   */
  setAudioOffset(offset: number): void {
    this.currentAudioOffset = offset;
  }

  /**
   * Get direction timing stats for results
   */
  getDirectionStats(): Record<Direction, { count: number; avgTiming: number; timings: number[] }> {
    const stats: Record<Direction, { count: number; avgTiming: number; timings: number[] }> = {
      left: { count: 0, avgTiming: 0, timings: [] },
      down: { count: 0, avgTiming: 0, timings: [] },
      up: { count: 0, avgTiming: 0, timings: [] },
      right: { count: 0, avgTiming: 0, timings: [] },
    };

    for (const dir of DIRECTIONS) {
      const timings = this.directionTimings[dir];
      stats[dir].count = timings.length;
      stats[dir].timings = [...timings];
      if (timings.length > 0) {
        stats[dir].avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
      }
    }

    return stats;
  }

  /**
   * Draw per-direction timing stats with visual slider bars
   */
  drawTimingStats(): void {
    const statsX = this.columnX.right + LAYOUT.arrowSize / 2 + 40;
    const startY = this.receptorY - 20;
    const rowHeight = 36;
    const barWidth = 100;
    const barHeight = 8;

    // Calculate panel dimensions
    const panelPadding = 25;
    const panelX = statsX - panelPadding;
    const panelY = startY - 35;
    const panelWidth = barWidth + 110;
    // Height includes: per-direction rows + global stats section
    const panelHeight = DIRECTIONS.length * rowHeight + 160;

    this.ctx.save();

    // Draw panel background
    this.ctx.fillStyle = 'rgba(18, 18, 26, 0.85)';
    this.roundRect(panelX, panelY, panelWidth, panelHeight, 10);
    this.ctx.fill();

    // Panel border
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 1;
    this.roundRect(panelX, panelY, panelWidth, panelHeight, 10);
    this.ctx.stroke();

    // Title
    this.ctx.font = '12px -apple-system, sans-serif';
    this.ctx.fillStyle = THEME.text.muted;
    this.ctx.textAlign = 'left';
    this.ctx.fillText('TIMING', statsX, startY - 5);

    for (let i = 0; i < DIRECTIONS.length; i++) {
      const dir = DIRECTIONS[i]!;
      const timings = this.directionTimings[dir];
      const y = startY + i * rowHeight + 18;

      // Direction indicator with color
      this.ctx.fillStyle = THEME.arrows[dir];
      this.ctx.font = '20px -apple-system, sans-serif';
      this.ctx.textAlign = 'center';
      const arrow = dir === 'left' ? '←' : dir === 'down' ? '↓' : dir === 'up' ? '↑' : '→';
      this.ctx.fillText(arrow, statsX + 10, y + 6);

      const barX = statsX + 35;

      // Draw bar background
      this.ctx.fillStyle = THEME.bg.tertiary;
      this.ctx.fillRect(barX, y - barHeight / 2, barWidth, barHeight);

      // Draw center line (perfect timing)
      this.ctx.fillStyle = THEME.text.muted;
      this.ctx.fillRect(barX + barWidth / 2 - 0.5, y - barHeight / 2 - 2, 1, barHeight + 4);

      // Draw "EARLY" and "LATE" labels (small)
      this.ctx.font = '9px -apple-system, sans-serif';
      this.ctx.fillStyle = THEME.text.muted;
      this.ctx.textAlign = 'left';
      this.ctx.fillText('E', barX - 10, y + 2);
      this.ctx.textAlign = 'right';
      this.ctx.fillText('L', barX + barWidth + 10, y + 2);

      if (timings.length > 0) {
        // Calculate average
        const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
        const avgMs = Math.round(avg);

        // Map timing to position (-100ms to +100ms range)
        const maxOffset = 100;
        const clampedAvg = Math.max(-maxOffset, Math.min(maxOffset, avg));
        const normalizedPos = (clampedAvg + maxOffset) / (maxOffset * 2); // 0 to 1
        const indicatorX = barX + normalizedPos * barWidth;

        // Color based on early/late
        let color: string;
        if (avgMs < -10) {
          color = '#4fc3f7'; // Early - blue
        } else if (avgMs > 10) {
          color = '#ff7043'; // Late - orange
        } else {
          color = '#66bb6a'; // Good - green
        }

        // Draw indicator triangle
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(indicatorX, y - barHeight / 2 - 1);
        this.ctx.lineTo(indicatorX - 4, y - barHeight / 2 - 6);
        this.ctx.lineTo(indicatorX + 4, y - barHeight / 2 - 6);
        this.ctx.closePath();
        this.ctx.fill();

        // Draw indicator line
        this.ctx.fillRect(indicatorX - 1, y - barHeight / 2, 2, barHeight);

        // Draw ms value
        this.ctx.font = '11px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = color;
        const sign = avgMs >= 0 ? '+' : '';
        this.ctx.fillText(`${sign}${avgMs}`, indicatorX, y + barHeight / 2 + 12);
      } else {
        // No data yet
        this.ctx.font = '11px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = THEME.text.muted;
        this.ctx.fillText('--', barX + barWidth / 2, y + barHeight / 2 + 12);
      }
    }

    // Draw global average and offset suggestion below the per-direction stats
    const globalY = startY + DIRECTIONS.length * rowHeight + 40;
    this.drawGlobalTimingStats(statsX, globalY, barWidth);

    this.ctx.restore();
  }

  /**
   * Draw global timing average and offset suggestion
   */
  private drawGlobalTimingStats(x: number, y: number, barWidth: number): void {
    if (this.allTimings.length === 0) {
      // No data yet
      this.ctx.font = '12px -apple-system, sans-serif';
      this.ctx.fillStyle = THEME.text.muted;
      this.ctx.textAlign = 'left';
      this.ctx.fillText('Waiting for data...', x, y);
      return;
    }

    // Calculate global average
    const globalAvg = this.allTimings.reduce((a, b) => a + b, 0) / this.allTimings.length;
    const globalAvgMs = Math.round(globalAvg);

    // Calculate last 10 average for recent trend
    const last10 = this.allTimings.slice(-10);
    const last10Avg = last10.reduce((a, b) => a + b, 0) / last10.length;
    const last10Ms = Math.round(last10Avg);

    // Color based on timing
    const getColor = (ms: number) => {
      if (ms < -10) return '#4fc3f7'; // Early - blue
      if (ms > 10) return '#ff7043'; // Late - orange
      return '#66bb6a'; // Good - green
    };

    const globalColor = getColor(globalAvgMs);
    const last10Color = getColor(last10Ms);

    // Draw separator line
    this.ctx.fillStyle = THEME.bg.tertiary;
    this.ctx.fillRect(x, y - 12, barWidth + 40, 1);

    // Global average label and value (show count)
    this.ctx.font = '12px -apple-system, sans-serif';
    this.ctx.fillStyle = THEME.text.muted;
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`AVG (${this.allTimings.length})`, x, y + 6);

    this.ctx.font = 'bold 16px monospace';
    this.ctx.fillStyle = globalColor;
    const globalSign = globalAvgMs >= 0 ? '+' : '';
    this.ctx.fillText(`${globalSign}${globalAvgMs}ms`, x + 65, y + 6);

    // Early/Late indicator
    if (Math.abs(globalAvgMs) > 5) {
      const label = globalAvgMs < 0 ? '(early)' : '(late)';
      this.ctx.font = '11px -apple-system, sans-serif';
      this.ctx.fillStyle = globalColor;
      this.ctx.fillText(label, x + 120, y + 6);
    }

    // Last 10 average
    this.ctx.font = '12px -apple-system, sans-serif';
    this.ctx.fillStyle = THEME.text.muted;
    this.ctx.fillText('Last 10', x, y + 26);

    this.ctx.font = 'bold 14px monospace';
    this.ctx.fillStyle = last10Color;
    const last10Sign = last10Ms >= 0 ? '+' : '';
    this.ctx.fillText(`${last10Sign}${last10Ms}ms`, x + 55, y + 26);

    // Offset suggestion (only if enough data and significant deviation)
    // If late (+ms): decrease offset (more negative) so notes appear later relative to audio
    // If early (-ms): increase offset (less negative) so notes appear earlier relative to audio
    if (this.allTimings.length >= 5 && Math.abs(globalAvgMs) > 5) {
      const suggestedOffset = Math.round(this.currentAudioOffset - globalAvg);

      this.ctx.font = '12px -apple-system, sans-serif';
      this.ctx.fillStyle = THEME.text.muted;
      this.ctx.fillText('Try offset', x, y + 50);

      // Current → Suggested
      this.ctx.font = 'bold 13px monospace';
      this.ctx.fillStyle = THEME.accent.warning;
      this.ctx.fillText(`${this.currentAudioOffset} → ${suggestedOffset}`, x + 68, y + 50);
    }
  }

  /**
   * Draw the lane backgrounds
   */
  drawLanes(): void {
    const laneWidth = LAYOUT.arrowSize;

    this.ctx.fillStyle = THEME.bg.secondary;

    for (const dir of DIRECTIONS) {
      const x = this.columnX[dir] - laneWidth / 2;
      this.ctx.fillRect(x, 0, laneWidth, this.height);
    }

    // Draw subtle lane separators
    this.ctx.strokeStyle = THEME.bg.tertiary;
    this.ctx.lineWidth = 1;
    for (const dir of DIRECTIONS) {
      const x = this.columnX[dir] - laneWidth / 2;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.height);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(x + laneWidth, 0);
      this.ctx.lineTo(x + laneWidth, this.height);
      this.ctx.stroke();
    }
  }

  /**
   * Draw receptors (target arrows at top)
   */
  drawReceptors(currentTime: number, heldDirections: Set<Direction>): void {
    for (const dir of DIRECTIONS) {
      const x = this.columnX[dir];
      const y = this.receptorY;

      // Check if glowing (recently pressed or held)
      const glowTime = this.receptorGlow[dir];
      const isGlowing =
        heldDirections.has(dir) || currentTime - glowTime < LAYOUT.receptorGlowDuration;

      // Draw receptor
      this.drawArrow(x, y, dir, isGlowing ? 1 : 0.4, true);

      // Draw glow effect
      if (isGlowing) {
        this.ctx.save();
        this.ctx.globalAlpha = 0.3;
        this.ctx.shadowColor = THEME.arrows[dir];
        this.ctx.shadowBlur = 20;
        this.drawArrow(x, y, dir, 1, true);
        this.ctx.restore();
      }
    }
  }

  /**
   * Trigger receptor glow
   */
  triggerReceptorGlow(direction: Direction, time: number): void {
    this.receptorGlow[direction] = time;
  }

  /**
   * Draw a single arrow - simple, large, easy to see
   */
  drawArrow(
    x: number,
    y: number,
    direction: Direction,
    alpha: number = 1,
    isReceptor: boolean = false
  ): void {
    const size = LAYOUT.arrowSize;
    const color = THEME.arrows[direction];

    this.ctx.save();
    this.ctx.translate(x, y);

    // Rotate based on direction (arrow points up by default)
    const rotations: Record<Direction, number> = {
      up: 0,
      down: Math.PI,
      left: -Math.PI / 2,
      right: Math.PI / 2,
    };
    this.ctx.rotate(rotations[direction]);

    this.ctx.globalAlpha = alpha;

    const s = size / 2;

    // Simple large arrow shape - maximum coverage
    const drawArrowShape = () => {
      this.ctx.beginPath();
      // Top point
      this.ctx.moveTo(0, -s * 0.95);
      // Right side of arrow head
      this.ctx.lineTo(s * 0.95, s * 0.1);
      // Inner corner right
      this.ctx.lineTo(s * 0.35, s * 0.1);
      // Right side of stem
      this.ctx.lineTo(s * 0.35, s * 0.95);
      // Bottom of stem
      this.ctx.lineTo(-s * 0.35, s * 0.95);
      // Left side of stem
      this.ctx.lineTo(-s * 0.35, s * 0.1);
      // Inner corner left
      this.ctx.lineTo(-s * 0.95, s * 0.1);
      this.ctx.closePath();
    };

    if (isReceptor) {
      // Receptor: dark with colored outline when active
      if (alpha > 0.5) {
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 15;
      }

      this.ctx.fillStyle = '#151518';
      drawArrowShape();
      this.ctx.fill();

      this.ctx.shadowBlur = 0;

      this.ctx.strokeStyle = alpha > 0.5 ? color : '#3a3a45';
      this.ctx.lineWidth = 3;
      this.ctx.lineJoin = 'miter';
      this.ctx.stroke();

    } else {
      // Note arrow

      // Dark outline
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 4;
      this.ctx.lineJoin = 'miter';
      drawArrowShape();
      this.ctx.stroke();

      // Main gradient fill
      const gradient = this.ctx.createLinearGradient(0, -s, 0, s);
      gradient.addColorStop(0, this.lightenColor(color, 35));
      gradient.addColorStop(0.5, color);
      gradient.addColorStop(1, this.darkenColor(color, 20));

      this.ctx.fillStyle = gradient;
      drawArrowShape();
      this.ctx.fill();

      // White inner outline
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.lineWidth = 2;
      this.ctx.save();
      this.ctx.scale(0.85, 0.85);
      drawArrowShape();
      this.ctx.restore();
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Lighten a hex color
   */
  private lightenColor(hex: string, percent: number): string {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (num >> 16) + Math.round(255 * percent / 100));
    const g = Math.min(255, ((num >> 8) & 0x00FF) + Math.round(255 * percent / 100));
    const b = Math.min(255, (num & 0x0000FF) + Math.round(255 * percent / 100));
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Darken a hex color
   */
  private darkenColor(hex: string, percent: number): string {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (num >> 16) - Math.round(255 * percent / 100));
    const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(255 * percent / 100));
    const b = Math.max(0, (num & 0x0000FF) - Math.round(255 * percent / 100));
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Draw all notes
   * @param cmod - CMod speed in pixels/second (0 = use BPM-based)
   * @param bpm - BPM for BPM-based scrolling (when cmod is 0)
   */
  drawNotes(notes: Note[], currentTime: number, cmod: number = 500, bpm: number = 120): void {
    // Calculate pixels per millisecond
    // CMod 500 = 500 pixels/second = 0.5 pixels/ms
    // When cmod is 0, derive speed from BPM (4 beats visible on screen)
    let pixelsPerMs: number;
    if (cmod === 0) {
      // BPM-based: aim for ~4 beats visible on screen
      const msPerBeat = 60000 / bpm;
      const beatsVisible = 4;
      pixelsPerMs = (this.height - this.receptorY) / (msPerBeat * beatsVisible);
    } else {
      pixelsPerMs = cmod / 1000;
    }

    // Calculate look-ahead time based on screen height
    const lookAheadMs = this.height / pixelsPerMs;

    // Draw hold notes first (so tap notes render on top)
    for (const note of notes) {
      if (note.type !== 'hold') continue;
      if (note.holdState?.completed || note.holdState?.dropped) continue;

      const timeDiff = note.time - currentTime;
      const endTimeDiff = (note.endTime ?? note.time) - currentTime;

      // Skip if entirely off screen
      if (timeDiff > lookAheadMs) continue;
      if (endTimeDiff < -500) continue;

      this.drawHoldNote(note, currentTime, pixelsPerMs);
    }

    // Draw tap notes
    for (const note of notes) {
      if (note.type === 'hold') continue;
      if (note.judged) continue;

      const timeDiff = note.time - currentTime;

      // Skip notes that are too far ahead or behind
      if (timeDiff > lookAheadMs) continue;
      if (timeDiff < -500) continue; // Allow some time for miss animation

      // Calculate Y position
      // Positive timeDiff = note is below receptor (approaching from bottom)
      const y = this.receptorY + timeDiff * pixelsPerMs;

      // Skip if off screen
      if (y < -LAYOUT.arrowSize || y > this.height + LAYOUT.arrowSize) continue;

      const x = this.columnX[note.direction];

      // Fade out notes that are past the receptor
      const alpha = timeDiff < 0 ? Math.max(0, 1 + timeDiff / 200) : 1;

      this.drawArrow(x, y, note.direction, alpha);
    }
  }

  /**
   * Draw a hold/freeze note
   */
  private drawHoldNote(note: Note, currentTime: number, pixelsPerMs: number): void {
    const x = this.columnX[note.direction];
    const color = THEME.arrows[note.direction];
    const holdState = note.holdState;

    // Calculate positions
    const headTimeDiff = note.time - currentTime;
    const tailTimeDiff = (note.endTime ?? note.time) - currentTime;

    let headY = this.receptorY + headTimeDiff * pixelsPerMs;
    const tailY = this.receptorY + tailTimeDiff * pixelsPerMs;

    // If hold started, keep head locked at receptor (don't let it scroll past)
    if (holdState?.started && !holdState?.dropped) {
      headY = this.receptorY;
    }

    // Determine hold state for coloring
    const isActive = holdState?.isHeld && holdState?.started && !holdState?.completed;
    const isDropped = holdState?.dropped;
    const bodyWidth = LAYOUT.arrowSize * 0.45;

    this.ctx.save();

    // Draw hold body (from head to tail)
    const bodyTop = Math.min(headY, tailY);
    const bodyBottom = Math.max(headY, tailY);
    const bodyHeight = bodyBottom - bodyTop;

    if (bodyHeight > 0) {
      // Body gradient
      const bodyGradient = this.ctx.createLinearGradient(x - bodyWidth / 2, 0, x + bodyWidth / 2, 0);

      if (isDropped) {
        // Dropped: gray/dark
        bodyGradient.addColorStop(0, '#333344');
        bodyGradient.addColorStop(0.5, '#444455');
        bodyGradient.addColorStop(1, '#333344');
      } else if (isActive) {
        // Active: bright glowing
        const rgb = this.hexToRgb(color);
        bodyGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`);
        bodyGradient.addColorStop(0.5, `rgba(${Math.min(255, rgb.r + 80)}, ${Math.min(255, rgb.g + 80)}, ${Math.min(255, rgb.b + 80)}, 1)`);
        bodyGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`);

        // Glow effect
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 15;
      } else {
        // Idle: normal color
        const rgb = this.hexToRgb(color);
        bodyGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`);
        bodyGradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`);
        bodyGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`);
      }

      // Draw body rectangle
      this.ctx.fillStyle = bodyGradient;
      this.roundRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight, 4);
      this.ctx.fill();

      // Inner glow stripe
      if (!isDropped) {
        const innerWidth = bodyWidth * 0.3;
        const innerGradient = this.ctx.createLinearGradient(x - innerWidth / 2, 0, x + innerWidth / 2, 0);
        innerGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
        innerGradient.addColorStop(0.5, `rgba(255, 255, 255, ${isActive ? 0.5 : 0.2})`);
        innerGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        this.ctx.fillStyle = innerGradient;
        this.ctx.fillRect(x - innerWidth / 2, bodyTop + 4, innerWidth, bodyHeight - 8);
      }

      this.ctx.shadowBlur = 0;
    }

    // Draw head - always visible while holding, fades when dropped
    if (!holdState?.completed) {
      const headAlpha = isDropped ? 0.4 : 1;
      this.drawArrow(x, headY, note.direction, headAlpha);
    }

    // Draw tail cap
    if (tailY > 0 && tailY < this.height + LAYOUT.arrowSize) {
      const capHeight = LAYOUT.arrowSize * 0.3;
      const capGradient = this.ctx.createLinearGradient(0, tailY - capHeight, 0, tailY);

      if (isDropped) {
        capGradient.addColorStop(0, '#444455');
        capGradient.addColorStop(1, '#333344');
      } else {
        const rgb = this.hexToRgb(color);
        capGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`);
        capGradient.addColorStop(1, this.darkenColor(color, 30));
      }

      this.ctx.fillStyle = capGradient;
      this.roundRect(x - bodyWidth / 2, tailY - capHeight, bodyWidth, capHeight, 4);
      this.ctx.fill();

      // Cap border
      this.ctx.strokeStyle = isDropped ? '#555566' : this.darkenColor(color, 20);
      this.ctx.lineWidth = 2;
      this.roundRect(x - bodyWidth / 2, tailY - capHeight, bodyWidth, capHeight, 4);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Update and draw judgment display
   */
  setJudgment(grade: JudgmentGrade, time: number, timingDiff: number = 0): void {
    this.lastJudgment = { grade, time, timingDiff };
  }

  /**
   * Add a hit effect at a direction
   */
  addHitEffect(direction: Direction, grade: JudgmentGrade, time: number): void {
    this.hitEffects.push({ direction, grade, time });
    // Keep only recent effects
    this.hitEffects = this.hitEffects.filter(e => time - e.time < 500);
  }

  /**
   * Draw hit effects (expanding arrow flash at receptors)
   */
  drawHitEffects(currentTime: number): void {
    const effectDuration = 150; // Quick effect

    for (const effect of this.hitEffects) {
      const elapsed = currentTime - effect.time;
      if (elapsed > effectDuration) continue;

      const x = this.columnX[effect.direction];
      const y = this.receptorY;
      const progress = elapsed / effectDuration;

      // Skip drawing for misses
      if (effect.grade === 'miss') continue;

      this.ctx.save();
      this.ctx.translate(x, y);

      // Rotate based on direction
      const rotations: Record<Direction, number> = {
        up: 0,
        down: Math.PI,
        left: -Math.PI / 2,
        right: Math.PI / 2,
      };
      this.ctx.rotate(rotations[effect.direction]);

      // Get color based on judgment
      const color = THEME.judgment[effect.grade];

      // Expanding arrow effect
      const baseSize = LAYOUT.arrowSize / 2;
      const scale = 1 + progress * 0.5; // Expand to 1.5x
      const alpha = 1 - progress; // Fade out

      this.ctx.globalAlpha = alpha * 0.9;
      this.ctx.scale(scale, scale);

      // Draw arrow shape (outline only)
      const s = baseSize;
      this.ctx.beginPath();
      this.ctx.moveTo(0, -s * 0.95);
      this.ctx.lineTo(s * 0.95, s * 0.1);
      this.ctx.lineTo(s * 0.35, s * 0.1);
      this.ctx.lineTo(s * 0.35, s * 0.95);
      this.ctx.lineTo(-s * 0.35, s * 0.95);
      this.ctx.lineTo(-s * 0.35, s * 0.1);
      this.ctx.lineTo(-s * 0.95, s * 0.1);
      this.ctx.closePath();

      // Glow effect
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = 20 * alpha;

      // Stroke only (no fill) with judgment color
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 4;
      this.ctx.lineJoin = 'miter';
      this.ctx.stroke();

      this.ctx.restore();
    }

    // Clean up old effects
    this.hitEffects = this.hitEffects.filter(e => currentTime - e.time < effectDuration);
  }

  /**
   * Draw judgment text with timing offset indicator
   */
  drawJudgment(currentTime: number): void {
    if (!this.lastJudgment) return;

    const elapsed = currentTime - this.lastJudgment.time;
    const duration = 500; // Display for 500ms

    if (elapsed > duration) {
      this.lastJudgment = null;
      return;
    }

    const alpha = 1 - elapsed / duration;
    const scale = 1 + elapsed / duration * 0.2;
    const centerX = this.width / 2;
    const centerY = this.height * 0.38;

    const text = this.lastJudgment.grade.toUpperCase();
    const color = THEME.judgment[this.lastJudgment.grade];

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.font = `bold ${32 * scale}px -apple-system, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    // Draw text shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillText(text, centerX + 2, centerY + 2);

    // Draw judgment text
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, centerX, centerY);

    // Draw timing offset indicator (skip for misses)
    if (this.lastJudgment.grade !== 'miss') {
      const timingDiff = this.lastJudgment.timingDiff;
      const maxOffset = 150; // Max timing window in ms

      // Timing bar background
      const barWidth = 120;
      const barHeight = 4;
      const barY = centerY + 28;

      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      this.roundRect(centerX - barWidth / 2, barY, barWidth, barHeight, 2);
      this.ctx.fill();

      // Center line (perfect timing)
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, barY - 2);
      this.ctx.lineTo(centerX, barY + barHeight + 2);
      this.ctx.stroke();

      // Timing indicator position
      const indicatorX = centerX + (timingDiff / maxOffset) * (barWidth / 2);
      const clampedX = Math.max(centerX - barWidth / 2 + 3, Math.min(centerX + barWidth / 2 - 3, indicatorX));

      // Timing indicator
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(clampedX, barY + barHeight / 2, 5, 0, Math.PI * 2);
      this.ctx.fill();

      // Early/Late text
      if (Math.abs(timingDiff) > 15) {
        this.ctx.font = 'bold 11px -apple-system, sans-serif';
        const offsetText = timingDiff < 0 ? 'EARLY' : 'LATE';
        const offsetColor = timingDiff < 0 ? '#88ccff' : '#ffaa66';
        this.ctx.fillStyle = offsetColor;
        this.ctx.fillText(offsetText, centerX, barY + 18);
      }
    }

    this.ctx.restore();
  }

  /**
   * Update combo display
   */
  setCombo(combo: number, currentTime: number): void {
    if (combo > this.displayCombo && this.displayCombo > 0) {
      this.comboIncreaseTime = currentTime;
    }
    this.displayCombo = combo;
  }

  /**
   * Draw combo counter with effects
   */
  drawCombo(currentTime: number): void {
    if (this.displayCombo < 4) return; // Only show combo at 4+

    this.ctx.save();

    // Calculate animation based on combo increase
    const timeSinceIncrease = currentTime - this.comboIncreaseTime;
    const animProgress = Math.min(1, timeSinceIncrease / 200);

    // Scale effect on combo increase
    let scale = 1;
    if (timeSinceIncrease < 200) {
      scale = 1 + 0.3 * (1 - animProgress);
    }

    // Position
    const centerX = this.width / 2;
    const centerY = this.height * 0.48;

    this.ctx.translate(centerX, centerY);
    this.ctx.scale(scale, scale);
    this.ctx.translate(-centerX, -centerY);

    // Glow effect for high combos
    if (this.displayCombo >= 20) {
      const glowIntensity = Math.min(1, (this.displayCombo - 20) / 50);
      const pulsePhase = (currentTime / 100) % (Math.PI * 2);
      const pulse = 0.5 + 0.5 * Math.sin(pulsePhase);

      this.ctx.shadowColor = this.getComboColor(this.displayCombo);
      this.ctx.shadowBlur = 20 + pulse * 15 * glowIntensity;
    }

    const text = `${this.displayCombo}`;

    // Font size based on combo
    const baseSize = this.displayCombo >= 100 ? 56 : this.displayCombo >= 50 ? 52 : 48;
    this.ctx.font = `bold ${baseSize}px -apple-system, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    // Multi-layer text effect
    // Outer shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.fillText(text, centerX + 3, centerY + 3);

    // Color based on combo tier
    const color = this.getComboColor(this.displayCombo);

    // Main text with gradient for high combos
    if (this.displayCombo >= 50) {
      const gradient = this.ctx.createLinearGradient(
        centerX - 50, centerY - 30,
        centerX + 50, centerY + 30
      );
      gradient.addColorStop(0, this.lightenColor(color, 20));
      gradient.addColorStop(0.5, color);
      gradient.addColorStop(1, this.lightenColor(color, 20));
      this.ctx.fillStyle = gradient;
    } else {
      this.ctx.fillStyle = color;
    }

    this.ctx.fillText(text, centerX, centerY);

    // Inner highlight
    this.ctx.globalAlpha = 0.4;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText(text, centerX, centerY - 2);

    this.ctx.globalAlpha = 1;
    this.ctx.shadowBlur = 0;

    // "COMBO" label with tier color
    this.ctx.font = 'bold 14px -apple-system, sans-serif';
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = 0.9;
    this.ctx.fillText('COMBO', centerX, centerY + 38);

    // Milestone indicator
    if (this.displayCombo % 50 === 0 && timeSinceIncrease < 500) {
      const milestoneAlpha = 1 - timeSinceIncrease / 500;
      this.ctx.globalAlpha = milestoneAlpha;
      this.ctx.font = 'bold 20px -apple-system, sans-serif';
      this.ctx.fillStyle = '#ffdd00';
      this.ctx.fillText('★ MILESTONE ★', centerX, centerY - 50);
    }

    this.ctx.restore();
  }

  /**
   * Get color based on combo tier
   */
  private getComboColor(combo: number): string {
    if (combo >= 100) return '#ff00ff'; // Magenta - legendary
    if (combo >= 50) return '#ffdd00';  // Gold - amazing
    if (combo >= 30) return '#00ffff';  // Cyan - great
    if (combo >= 20) return '#00ff88';  // Green - good
    if (combo >= 10) return '#88aaff';  // Blue - building
    return '#aaaaaa';                   // Gray - starting
  }

  /**
   * Draw score
   */
  drawScore(score: number): void {
    this.ctx.save();
    this.ctx.font = 'bold 24px -apple-system, sans-serif';
    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = THEME.text.primary;

    const text = score.toString().padStart(7, '0');
    this.ctx.fillText(text, this.width - 20, 20);

    this.ctx.restore();
  }

  /**
   * Draw song title and artist (top left)
   */
  drawSongInfo(title: string, artist: string): void {
    this.ctx.save();

    const x = 20;
    const y = 25;

    // Song title - large white text
    this.ctx.font = 'bold 28px -apple-system, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = THEME.text.primary;
    this.ctx.fillText(title, x, y);

    // Artist - smaller, slightly muted
    this.ctx.font = '18px -apple-system, sans-serif';
    this.ctx.fillStyle = THEME.text.secondary;
    this.ctx.fillText(artist, x, y + 34);

    this.ctx.restore();
  }

  /**
   * Draw progress bar (centered, matching lane width)
   */
  drawProgress(current: number, total: number): void {
    if (total <= 0) return;

    const progress = Math.min(1, Math.max(0, current / total));
    const barHeight = 6;
    const barWidth = LAYOUT.arrowSize * 4 + LAYOUT.arrowGap * 3;
    const x = (this.width - barWidth) / 2;
    const y = 12;
    const radius = 3;

    this.ctx.save();

    // Dark background with rounded corners
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.roundRect(x, y, barWidth, barHeight, radius);
    this.ctx.fill();

    // Progress fill
    if (progress > 0) {
      const fillWidth = barWidth * progress;

      // Gradient from cyan to magenta
      const gradient = this.ctx.createLinearGradient(x, y, x + barWidth, y);
      gradient.addColorStop(0, '#00d4ff');
      gradient.addColorStop(0.5, '#8844ff');
      gradient.addColorStop(1, '#ff00aa');

      this.ctx.fillStyle = gradient;
      this.roundRect(x, y, fillWidth, barHeight, radius);
      this.ctx.fill();

      // Bright edge at progress point
      if (fillWidth > 4) {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.fillRect(x + fillWidth - 2, y + 1, 2, barHeight - 2);
      }
    }

    // Subtle border
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    this.ctx.lineWidth = 1;
    this.roundRect(x, y, barWidth, barHeight, radius);
    this.ctx.stroke();

    this.ctx.restore();
  }

  /**
   * Draw difficulty indicator
   */
  drawDifficulty(difficulty: string, level: number): void {
    const totalWidth = LAYOUT.arrowSize * 4 + LAYOUT.arrowGap * 3;
    const x = (this.width - totalWidth) / 2;
    const y = this.height - 55;

    this.ctx.save();

    // Difficulty name with color based on difficulty
    const diffColors: Record<string, string> = {
      'Beginner': '#88ff88',
      'Easy': '#88ff88',
      'Medium': '#ffff44',
      'Hard': '#ff8844',
      'Challenge': '#ff4488',
    };

    // Draw difficulty and level together
    this.ctx.font = 'bold 14px -apple-system, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = diffColors[difficulty] ?? THEME.text.primary;

    const text = `${difficulty} Lv.${level}`;
    this.ctx.fillText(text, x, y);

    this.ctx.restore();
  }

  /**
   * Draw pause overlay
   */
  drawPauseOverlay(): void {
    // Darken background
    this.ctx.fillStyle = THEME.bg.overlay;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Draw pause text
    this.ctx.save();
    this.ctx.font = 'bold 48px -apple-system, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = THEME.text.primary;
    this.ctx.fillText('PAUSED', this.width / 2, this.height / 2 - 30);

    this.ctx.font = '18px -apple-system, sans-serif';
    this.ctx.fillStyle = THEME.text.secondary;
    this.ctx.fillText('ENTER - Resume', this.width / 2, this.height / 2 + 25);
    this.ctx.fillText('ESCAPE - Quit to menu', this.width / 2, this.height / 2 + 55);

    this.ctx.restore();
  }

  /**
   * Draw countdown
   */
  drawCountdown(count: number): void {
    this.ctx.save();
    this.ctx.font = 'bold 120px -apple-system, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = THEME.accent.primary;
    this.ctx.fillText(count.toString(), this.width / 2, this.height / 2);
    this.ctx.restore();
  }

  /**
   * Full render frame for gameplay
   */
  renderGameplay(state: GameplayState, currentTime: number, heldDirections: Set<Direction>, cmod: number = 500, health: number = 50, autoplay: boolean = false): void {
    this.clear(currentTime, health);
    this.drawLanes();
    this.drawReceptors(currentTime, heldDirections);
    this.drawLaneFlashes(currentTime); // Draw flashes ON TOP of receptors for visibility
    this.drawHitEffects(currentTime);
    this.drawNotes(state.activeNotes, currentTime, cmod, state.song.bpm);
    this.drawJudgment(currentTime);
    this.setCombo(state.combo, currentTime);
    this.drawCombo(currentTime);
    this.drawScore(state.score);
    this.drawSongInfo(state.song.title, state.song.artist);
    this.drawHealthBar(health);
    this.drawProgress(currentTime, state.chart.notes[state.chart.notes.length - 1]?.endTime ?? state.chart.notes[state.chart.notes.length - 1]?.time ?? 0);

    // Draw timing stats (only in normal play, not autoplay)
    if (!autoplay) {
      this.drawTimingStats();
    }

    if (autoplay) {
      this.drawAutoplayIndicator();
    }

    if (state.paused) {
      this.drawPauseOverlay();
    }
  }

  /**
   * Draw autoplay/demo mode indicator
   */
  private drawAutoplayIndicator(): void {
    this.ctx.save();

    const x = this.width / 2;
    const y = 50;

    // Pulsing effect
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 300);

    // Background pill
    const text = 'DEMO';
    this.ctx.font = 'bold 14px -apple-system, sans-serif';
    const textWidth = this.ctx.measureText(text).width;
    const padding = 12;

    this.ctx.fillStyle = `rgba(255, 0, 100, ${0.2 * pulse})`;
    this.roundRect(x - textWidth / 2 - padding, y - 12, textWidth + padding * 2, 24, 12);
    this.ctx.fill();

    // Border
    this.ctx.strokeStyle = `rgba(255, 0, 100, ${0.6 * pulse})`;
    this.ctx.lineWidth = 2;
    this.roundRect(x - textWidth / 2 - padding, y - 12, textWidth + padding * 2, 24, 12);
    this.ctx.stroke();

    // Text
    this.ctx.globalAlpha = pulse;
    this.ctx.fillStyle = '#ff0066';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, x, y);

    this.ctx.restore();
  }

  /**
   * Draw CMod indicator (positioned near the game area)
   */
  drawCmodIndicator(cmod: number, bpm: number = 120): void {
    const totalLaneWidth = LAYOUT.arrowSize * 4 + LAYOUT.arrowGap * 3;
    const lanesEndX = (this.width + totalLaneWidth) / 2;

    this.ctx.save();
    this.ctx.font = 'bold 14px -apple-system, sans-serif';
    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = THEME.text.secondary;
    // Show "BPM" when cmod is 0, otherwise show "C{speed}"
    const label = cmod === 0 ? `${bpm} BPM` : `C${cmod}`;
    this.ctx.fillText(label, lanesEndX, this.height - 55);
    this.ctx.restore();
  }

  /**
   * Draw Diablo 3 style health bar (vertical, with fluid animation)
   */
  drawHealthBar(health: number): void {
    // Position to the left of the lanes
    const totalLaneWidth = LAYOUT.arrowSize * 4 + LAYOUT.arrowGap * 3;
    const lanesX = (this.width - totalLaneWidth) / 2;
    const barWidth = 16;
    const barHeight = this.height * 0.45;
    const x = lanesX - barWidth - 25;
    const y = (this.height - barHeight) / 2;
    const radius = 8;

    this.ctx.save();

    // Outer glow for low health - pulsing red
    if (health < 30) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 150);
      this.ctx.shadowColor = '#ff2200';
      this.ctx.shadowBlur = 15 + pulse * 10;
    }

    // Draw bar background (dark glass)
    const bgGradient = this.ctx.createLinearGradient(x, y, x + barWidth, y);
    bgGradient.addColorStop(0, '#0a0a12');
    bgGradient.addColorStop(0.5, '#151520');
    bgGradient.addColorStop(1, '#0a0a12');

    this.roundRect(x, y, barWidth, barHeight, radius);
    this.ctx.fillStyle = bgGradient;
    this.ctx.fill();

    this.ctx.shadowBlur = 0;

    // Draw liquid health fill
    if (health > 0) {
      // Clipping path for bar
      this.ctx.save();
      this.roundRect(x + 2, y + 2, barWidth - 4, barHeight - 4, radius - 2);
      this.ctx.clip();

      // Calculate fill level (from bottom)
      const fillHeight = (health / 100) * (barHeight - 4);
      const fillTop = y + barHeight - 2 - fillHeight;

      // Animated wave effect on top of liquid
      const waveTime = Date.now() / 400;
      const waveHeight = 2 + (health < 30 ? Math.sin(Date.now() / 100) * 1.5 : 0);

      // Health color based on level
      let liquidColor: string;
      let liquidHighlight: string;
      let liquidDark: string;
      if (health > 60) {
        liquidColor = '#cc2222';
        liquidHighlight = '#ff4444';
        liquidDark = '#881111';
      } else if (health > 30) {
        liquidColor = '#cc6600';
        liquidHighlight = '#ff8800';
        liquidDark = '#884400';
      } else {
        liquidColor = '#aa1111';
        liquidHighlight = '#dd2222';
        liquidDark = '#660808';
      }

      // Liquid gradient (horizontal for depth effect)
      const liquidGradient = this.ctx.createLinearGradient(x, y, x + barWidth, y);
      liquidGradient.addColorStop(0, liquidDark);
      liquidGradient.addColorStop(0.3, liquidColor);
      liquidGradient.addColorStop(0.5, liquidHighlight);
      liquidGradient.addColorStop(0.7, liquidColor);
      liquidGradient.addColorStop(1, liquidDark);

      // Draw liquid with wave on top
      this.ctx.beginPath();
      this.ctx.moveTo(x, y + barHeight);

      // Wave effect on top surface
      for (let wx = 0; wx <= barWidth; wx += 2) {
        const waveY = fillTop + Math.sin(waveTime + wx * 0.3) * waveHeight;
        this.ctx.lineTo(x + wx, waveY);
      }

      this.ctx.lineTo(x + barWidth, y + barHeight);
      this.ctx.closePath();
      this.ctx.fillStyle = liquidGradient;
      this.ctx.fill();

      // Bubbles animation
      this.updateHealthBubbles(x + barWidth / 2, y + barHeight - fillHeight / 2, barWidth / 2, fillTop);
      this.drawHealthBubbles(liquidHighlight);

      // Vertical highlight streak (glass effect)
      const streakGradient = this.ctx.createLinearGradient(x + 3, y, x + 6, y);
      streakGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      streakGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
      streakGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

      this.ctx.fillStyle = streakGradient;
      this.ctx.fillRect(x + 3, fillTop + 5, 4, fillHeight - 10);

      this.ctx.restore();
    }

    // Glass rim (outer border)
    const rimGradient = this.ctx.createLinearGradient(x, y, x + barWidth, y + barHeight);
    rimGradient.addColorStop(0, '#555566');
    rimGradient.addColorStop(0.3, '#333340');
    rimGradient.addColorStop(0.7, '#222230');
    rimGradient.addColorStop(1, '#444455');

    this.ctx.strokeStyle = rimGradient;
    this.ctx.lineWidth = 3;
    this.roundRect(x, y, barWidth, barHeight, radius);
    this.ctx.stroke();

    // Inner highlight
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.lineWidth = 1;
    this.roundRect(x + 2, y + 2, barWidth - 4, barHeight - 4, radius - 2);
    this.ctx.stroke();

    // Health percentage text below bar
    this.ctx.font = 'bold 12px -apple-system, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';

    if (health < 30) {
      this.ctx.shadowColor = '#ff4444';
      this.ctx.shadowBlur = 8;
    }

    const textColor = health > 60 ? '#ff6666' : health > 30 ? '#ffaa44' : '#ff4444';
    this.ctx.fillStyle = textColor;
    this.ctx.fillText(`${Math.round(health)}%`, x + barWidth / 2, y + barHeight + 8);

    this.ctx.restore();
  }

  /**
   * Update health bar bubbles
   */
  private updateHealthBubbles(centerX: number, centerY: number, halfWidth: number, fillTop: number): void {
    // Add new bubbles occasionally
    if (Math.random() < 0.08 && this.healthBubbles.length < 5) {
      const xOffset = (Math.random() - 0.5) * halfWidth * 1.5;
      this.healthBubbles.push({
        x: centerX + xOffset,
        y: centerY + halfWidth * 2,
        size: 1.5 + Math.random() * 2.5,
        speed: 0.4 + Math.random() * 0.8,
        opacity: 0.3 + Math.random() * 0.4,
      });
    }

    // Update existing bubbles
    for (let i = this.healthBubbles.length - 1; i >= 0; i--) {
      const bubble = this.healthBubbles[i]!;
      bubble.y -= bubble.speed;
      bubble.x += Math.sin(Date.now() / 300 + i) * 0.2;

      // Remove bubbles that reach the top
      if (bubble.y < fillTop - 3) {
        this.healthBubbles.splice(i, 1);
      }
    }
  }

  /**
   * Draw health bar bubbles
   */
  private drawHealthBubbles(color: string): void {
    for (const bubble of this.healthBubbles) {
      this.ctx.globalAlpha = bubble.opacity;
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(bubble.x, bubble.y, bubble.size, 0, Math.PI * 2);
      this.ctx.fill();

      // Bubble highlight
      this.ctx.globalAlpha = bubble.opacity * 0.5;
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(bubble.x - bubble.size * 0.3, bubble.y - bubble.size * 0.3, bubble.size * 0.3, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1;
  }

  /**
   * Helper to draw rounded rectangle
   */
  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + w - r, y);
    this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    this.ctx.lineTo(x + w, y + h - r);
    this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.ctx.lineTo(x + r, y + h);
    this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    this.ctx.lineTo(x, y + r);
    this.ctx.quadraticCurveTo(x, y, x + r, y);
    this.ctx.closePath();
  }

  /**
   * Get canvas dimensions
   */
  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
