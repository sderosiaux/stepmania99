import type { Direction, Note, JudgmentGrade, GameplayState, NoteSkin } from '../types';
import { DIRECTIONS } from '../types';

// Re-export theme for external use
export { THEME, LAYOUT, DIRECTION_ROTATIONS } from './theme';
import { THEME, LAYOUT, DIRECTION_ROTATIONS } from './theme';

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

  /** Steps remaining tracking for bump animation */
  private lastStepsRemaining: number = 0;
  private stepsBumpTime: number = 0;
  private lastFrameTime: number = 0;

  /** Current note skin */
  private noteSkin: NoteSkin = 'arrows';

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

    // Calculate receptor Y position based on skin
    this.updateReceptorPosition();
  }

  /**
   * Update receptor position based on note skin
   */
  private updateReceptorPosition(): void {
    if (this.noteSkin === 'gems') {
      // Guitar Hero style: receptors at bottom
      this.receptorY = this.height * 0.88;
    } else {
      // DDR style: receptors near top
      this.receptorY = this.height * LAYOUT.receptorY;
    }
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
    const time = currentTime / 2000;

    // Calculate delta time for smooth lerping
    const deltaTime = this.lastFrameTime > 0 ? (currentTime - this.lastFrameTime) / 1000 : 0.016;
    this.lastFrameTime = currentTime;

    // Smoothly lerp towards target health
    const lerpSpeed = health < this.smoothedHealth ? 8 : 3;
    this.smoothedHealth += (health - this.smoothedHealth) * Math.min(1, deltaTime * lerpSpeed);

    // Calculate pulse based on health state
    const isCritical = this.smoothedHealth < 15;
    const isLow = this.smoothedHealth < 30;
    const pulseSpeed = isCritical ? 10 : (isLow ? 5 : 1);
    const pulse = Math.sin(currentTime / (200 / pulseSpeed)) * 0.5 + 0.5;

    // Get health-based colors
    const { colors, dimOpacity } = this.calculateHealthColors(this.smoothedHealth, pulse);
    const [color1, color2, color3] = colors;

    // Create moving gradient center points
    const cx1 = this.width * (0.3 + 0.25 * Math.sin(time * 0.7));
    const cy1 = this.height * (0.3 + 0.25 * Math.cos(time * 0.5));
    const cx2 = this.width * (0.7 + 0.25 * Math.cos(time * 0.6));
    const cy2 = this.height * (0.7 + 0.25 * Math.sin(time * 0.8));
    const cx3 = this.width * (0.5 + 0.3 * Math.sin(time * 0.4 + 1));
    const cy3 = this.height * (0.6 + 0.25 * Math.cos(time * 0.3 + 2));

    // Draw three gradient blobs
    this.drawGradientBlob(cx1, cy1, this.width * 0.8, color1, [0, 0.3, 0.6, 1], [1, 0.7, 0.3, 0]);
    this.drawGradientBlob(cx2, cy2, this.width * 0.7, color2, [0, 0.35, 0.7, 1], [1, 0.6, 0.2, 0]);
    this.drawGradientBlob(cx3, cy3, this.width * 0.6, color3, [0, 0.4, 1], [1, 0.5, 0]);

    // Dim overlay
    this.ctx.fillStyle = `rgba(10, 10, 15, ${dimOpacity})`;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Draw a single radial gradient blob
   */
  private drawGradientBlob(
    cx: number,
    cy: number,
    radius: number,
    color: { r: number; g: number; b: number; a: number },
    stops: number[],
    alphaMultipliers: number[]
  ): void {
    const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    for (let i = 0; i < stops.length; i++) {
      const alpha = color.a * alphaMultipliers[i]!;
      gradient.addColorStop(stops[i]!, alpha > 0 ? `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})` : 'transparent');
    }
    this.ctx.fillStyle = gradient;
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
      this.ctx.rotate(DIRECTION_ROTATIONS[dir]);

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
   * Calculate health-based background colors for gradient blobs
   */
  private calculateHealthColors(health: number, pulse: number): {
    colors: [{ r: number; g: number; b: number; a: number }, { r: number; g: number; b: number; a: number }, { r: number; g: number; b: number; a: number }];
    dimOpacity: number;
  } {
    const h = health;
    const isLowHealth = h < 30;
    const isHighHealth = h > 75;
    const isCriticalHealth = h < 15;

    let color1, color2, color3;

    if (isCriticalHealth) {
      const intensity = 0.5 + pulse * 0.35;
      color1 = { r: 255, g: 20, b: 20, a: intensity };
      color2 = { r: 200, g: 0, b: 50, a: intensity * 0.8 };
      color3 = { r: 255, g: 50, b: 30, a: intensity * 0.6 };
    } else if (isLowHealth) {
      const lowBlend = (30 - h) / 15;
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
        b: 20,
        a: intensity * 0.7
      };
      color3 = {
        r: Math.round(220 + lowBlend * 35),
        g: Math.round(80 - lowBlend * 50),
        b: Math.round(40 - lowBlend * 20),
        a: intensity * 0.5
      };
    } else if (isHighHealth) {
      const highBlend = (h - 75) / 25;
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
        g: 255,
        b: Math.round(180 + highBlend * 40),
        a: 0.3 + highBlend * 0.1
      };
    } else {
      const normalBlend = (h - 30) / 45;
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

    const dimOpacity = isCriticalHealth ? 0.25 : (isLowHealth ? 0.32 : (isHighHealth ? 0.35 : 0.4));

    return { colors: [color1, color2, color3], dimOpacity };
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
    // Reset steps tracking for bump animation
    this.lastStepsRemaining = 0;
    this.stepsBumpTime = 0;
  }

  /**
   * Set the current audio offset (for displaying suggested offset)
   */
  setAudioOffset(offset: number): void {
    this.currentAudioOffset = offset;
  }

  /**
   * Set the note skin style
   */
  setNoteSkin(skin: NoteSkin): void {
    this.noteSkin = skin;
    this.updateReceptorPosition();
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
   * @param stepsRemaining - Number of notes not yet judged
   * @param totalSteps - Total number of notes in the chart
   */
  drawTimingStats(stepsRemaining: number = 0, totalSteps: number = 0): void {
    const statsX = this.columnX.right + LAYOUT.arrowSize / 2 + 40;
    // Always position at top of screen (not relative to receptor)
    const startY = this.height * 0.12;
    const rowHeight = 36;
    const barWidth = 100;
    const barHeight = 8;

    // Calculate panel dimensions
    const panelPadding = 25;
    const panelX = statsX - panelPadding;
    const panelY = startY - 35;
    const panelWidth = barWidth + 110;
    // Height includes: per-direction rows + global stats section + steps remaining
    const panelHeight = DIRECTIONS.length * rowHeight + 220;

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

    // Draw steps remaining at bottom of panel with bump animation
    if (totalSteps > 0) {
      const stepsY = globalY + 85;
      const now = performance.now();

      // Detect decrease and trigger bump
      if (stepsRemaining < this.lastStepsRemaining && this.lastStepsRemaining > 0) {
        this.stepsBumpTime = now;
      }
      this.lastStepsRemaining = stepsRemaining;

      // Calculate bump scale (1.0 -> 1.4 -> 1.0 over 200ms)
      const bumpDuration = 200;
      const timeSinceBump = now - this.stepsBumpTime;
      let scale = 1.0;
      if (timeSinceBump < bumpDuration) {
        const progress = timeSinceBump / bumpDuration;
        // Ease out: quick pop then settle
        scale = 1.0 + 0.4 * Math.sin(progress * Math.PI);
      }

      // Draw steps count centered
      this.ctx.save();
      const centerX = panelX + panelWidth / 2;
      this.ctx.translate(centerX, stepsY);
      this.ctx.scale(scale, scale);

      // Color: green when 0, accent otherwise
      this.ctx.fillStyle = stepsRemaining === 0 ? THEME.accent.success : THEME.accent.primary;
      this.ctx.font = 'bold 32px -apple-system, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(`${stepsRemaining}`, 0, 0);

      // Small label below
      this.ctx.fillStyle = THEME.text.muted;
      this.ctx.font = '10px -apple-system, sans-serif';
      this.ctx.fillText('steps left', 0, 20);

      this.ctx.restore();
    }

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
    if (this.noteSkin === 'gems') {
      this.drawLanes3D();
    } else {
      this.drawLanesFlat();
    }
  }

  /**
   * Draw flat 2D lanes (DDR style)
   */
  private drawLanesFlat(): void {
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
   * Draw 3D perspective lanes (Guitar Hero style)
   */
  private drawLanes3D(): void {
    const laneWidth = LAYOUT.arrowSize;
    const centerX = this.width / 2;

    // Vanishing point settings
    const vanishingY = this.height * LAYOUT.vanishingY;
    const horizonScale = LAYOUT.horizonScale;

    // Calculate lane positions at receptor (bottom)
    const lanePositions: { left: number; right: number }[] = [];
    for (const dir of DIRECTIONS) {
      const x = this.columnX[dir];
      lanePositions.push({
        left: x - laneWidth / 2,
        right: x + laneWidth / 2,
      });
    }

    // Draw lane backgrounds as trapezoids
    for (let i = 0; i < DIRECTIONS.length; i++) {
      const lane = lanePositions[i]!;

      // Bottom positions (at receptor)
      const bottomLeft = lane.left;
      const bottomRight = lane.right;

      // Top positions (at vanishing point) - converge towards center
      const topLeft = centerX + (lane.left - centerX) * horizonScale;
      const topRight = centerX + (lane.right - centerX) * horizonScale;

      // Draw lane fill with gradient
      const gradient = this.ctx.createLinearGradient(0, vanishingY, 0, this.receptorY);
      gradient.addColorStop(0, 'rgba(18, 18, 26, 0.3)'); // Faded at top
      gradient.addColorStop(0.5, 'rgba(18, 18, 26, 0.7)');
      gradient.addColorStop(1, THEME.bg.secondary); // Full at bottom

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.moveTo(topLeft, vanishingY);
      this.ctx.lineTo(topRight, vanishingY);
      this.ctx.lineTo(bottomRight, this.receptorY);
      this.ctx.lineTo(bottomLeft, this.receptorY);
      this.ctx.closePath();
      this.ctx.fill();

      // Draw lane edge lines
      const lineGradient = this.ctx.createLinearGradient(0, vanishingY, 0, this.receptorY);
      lineGradient.addColorStop(0, 'rgba(40, 40, 60, 0.2)');
      lineGradient.addColorStop(1, THEME.bg.tertiary);

      this.ctx.strokeStyle = lineGradient;
      this.ctx.lineWidth = 1;

      // Left edge
      this.ctx.beginPath();
      this.ctx.moveTo(topLeft, vanishingY);
      this.ctx.lineTo(bottomLeft, this.receptorY);
      this.ctx.stroke();

      // Right edge
      this.ctx.beginPath();
      this.ctx.moveTo(topRight, vanishingY);
      this.ctx.lineTo(bottomRight, this.receptorY);
      this.ctx.stroke();
    }

    // Draw horizontal "fret" lines for depth
    const numFrets = 8;
    for (let i = 1; i < numFrets; i++) {
      const t = i / numFrets;
      // Non-linear spacing for perspective effect
      const perspectiveT = Math.pow(t, 1.5);
      const y = vanishingY + (this.receptorY - vanishingY) * perspectiveT;
      const scale = horizonScale + (1 - horizonScale) * perspectiveT;

      // Calculate the full lane width at this y position
      const firstLane = lanePositions[0]!;
      const lastLane = lanePositions[DIRECTIONS.length - 1]!;
      const leftX = centerX + (firstLane.left - centerX) * scale;
      const rightX = centerX + (lastLane.right - centerX) * scale;

      // Alpha fades with distance
      const alpha = 0.1 + 0.15 * perspectiveT;

      this.ctx.strokeStyle = `rgba(60, 60, 80, ${alpha})`;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(leftX, y);
      this.ctx.lineTo(rightX, y);
      this.ctx.stroke();
    }
  }

  /**
   * Draw receptors (target arrows at top, or inclined for gems mode)
   */
  drawReceptors(currentTime: number, heldDirections: Set<Direction>): void {
    const isGems = this.noteSkin === 'gems';

    if (isGems) {
      this.drawReceptors3D(currentTime, heldDirections);
    } else {
      this.drawReceptorsFlat(currentTime, heldDirections);
    }
  }

  /**
   * Draw flat receptors (DDR style)
   */
  private drawReceptorsFlat(currentTime: number, heldDirections: Set<Direction>): void {
    for (const dir of DIRECTIONS) {
      const x = this.columnX[dir];
      const y = this.receptorY;

      const glowTime = this.receptorGlow[dir];
      const isGlowing =
        heldDirections.has(dir) || currentTime - glowTime < LAYOUT.receptorGlowDuration;

      this.drawArrow(x, y, dir, isGlowing ? 1 : 0.4, true);

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
   * Draw 3D inclined receptors (Guitar Hero style)
   */
  private drawReceptors3D(currentTime: number, heldDirections: Set<Direction>): void {
    const laneWidth = LAYOUT.arrowSize;
    const scaleY = 0.75; // Vertical compression to simulate looking down at highway

    for (const dir of DIRECTIONS) {
      const x = this.columnX[dir];
      const y = this.receptorY;

      const glowTime = this.receptorGlow[dir];
      const isGlowing =
        heldDirections.has(dir) || currentTime - glowTime < LAYOUT.receptorGlowDuration;

      this.ctx.save();

      // Apply perspective transform centered on this receptor
      this.ctx.translate(x, y);
      this.ctx.scale(1, scaleY);
      this.ctx.translate(-x, -y);

      // Draw receptor with perspective
      this.drawArrow(x, y, dir, isGlowing ? 1 : 0.4, true);

      if (isGlowing) {
        this.ctx.globalAlpha = 0.3;
        this.ctx.shadowColor = THEME.arrows[dir];
        this.ctx.shadowBlur = 20;
        this.drawArrow(x, y, dir, 1, true);
      }

      this.ctx.restore();
    }

    // Draw a subtle "highway edge" line at receptor level
    const firstLaneX = this.columnX.left - laneWidth / 2;
    const lastLaneX = this.columnX.right + laneWidth / 2;

    this.ctx.strokeStyle = 'rgba(100, 100, 140, 0.5)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(firstLaneX, this.receptorY);
    this.ctx.lineTo(lastLaneX, this.receptorY);
    this.ctx.stroke();
  }

  /**
   * Trigger receptor glow
   */
  triggerReceptorGlow(direction: Direction, time: number): void {
    this.receptorGlow[direction] = time;
  }

  /**
   * Get beat subdivision color based on beat position
   */
  getBeatColor(beat: number | undefined): string {
    if (beat === undefined) return THEME.beatColors.other;

    // Get fractional part of beat
    const fraction = beat % 1;
    const epsilon = 0.001;

    // Check subdivisions from coarsest to finest
    // 1/4 notes (on the beat: 0, 1, 2, 3...)
    if (Math.abs(fraction) < epsilon || Math.abs(fraction - 1) < epsilon) {
      return THEME.beatColors[4];
    }

    // 1/8 notes (0.5)
    if (Math.abs(fraction - 0.5) < epsilon) {
      return THEME.beatColors[8];
    }

    // 1/12 notes (triplets: 0.333..., 0.666...)
    if (Math.abs(fraction - 1/3) < epsilon || Math.abs(fraction - 2/3) < epsilon) {
      return THEME.beatColors[12];
    }

    // 1/16 notes (0.25, 0.75)
    if (Math.abs(fraction - 0.25) < epsilon || Math.abs(fraction - 0.75) < epsilon) {
      return THEME.beatColors[16];
    }

    // 1/24 notes (0.0833, 0.1666, 0.4166, 0.5833, 0.9166...)
    const sixths = [1/6, 5/6];
    for (const s of sixths) {
      if (Math.abs(fraction - s) < epsilon) return THEME.beatColors[24];
    }
    // 1/24 also includes 1/8 offsets within triplets
    const twentyFourths = [1/12, 5/12, 7/12, 11/12];
    for (const t of twentyFourths) {
      if (Math.abs(fraction - t) < epsilon) return THEME.beatColors[24];
    }

    // 1/32 notes
    const thirtySeconds = [1/8, 3/8, 5/8, 7/8];
    for (const t of thirtySeconds) {
      if (Math.abs(fraction - t) < epsilon) return THEME.beatColors[32];
    }

    // 1/48 notes
    const fortyEighths = [1/16, 3/16, 5/16, 7/16, 9/16, 11/16, 13/16, 15/16];
    for (const f of fortyEighths) {
      if (Math.abs(fraction - f) < epsilon) return THEME.beatColors[48];
    }

    // 1/64 notes
    const sixtyFourths = [1/32, 3/32, 5/32, 7/32, 9/32, 11/32, 13/32, 15/32,
                          17/32, 19/32, 21/32, 23/32, 25/32, 27/32, 29/32, 31/32];
    for (const s of sixtyFourths) {
      if (Math.abs(fraction - s) < epsilon) return THEME.beatColors[64];
    }

    return THEME.beatColors.other;
  }

  /**
   * Draw a single arrow - simple, large, easy to see
   */
  drawArrow(
    x: number,
    y: number,
    direction: Direction,
    alpha: number = 1,
    isReceptor: boolean = false,
    colorOverride?: string
  ): void {
    const size = LAYOUT.arrowSize;
    const color = colorOverride ?? THEME.arrows[direction];

    this.ctx.save();
    this.ctx.translate(x, y);

    // Rotate based on direction (arrow points up by default)
    this.ctx.rotate(DIRECTION_ROTATIONS[direction]);

    this.ctx.globalAlpha = alpha;

    const s = size / 2;

    // Use gems skin or arrows skin
    if (this.noteSkin === 'gems') {
      this.drawGemShape(s, color, isReceptor, alpha);
    } else {
      this.drawArrowShape(s, color, isReceptor, alpha);
    }

    this.ctx.restore();
  }

  /**
   * Draw arrow shape (classic DDR style)
   */
  private drawArrowShape(s: number, color: string, isReceptor: boolean, alpha: number): void {
    const drawShape = () => {
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
      if (alpha > 0.5) {
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 15;
      }

      this.ctx.fillStyle = '#151518';
      drawShape();
      this.ctx.fill();

      this.ctx.shadowBlur = 0;

      this.ctx.strokeStyle = alpha > 0.5 ? color : '#3a3a45';
      this.ctx.lineWidth = 3;
      this.ctx.lineJoin = 'miter';
      this.ctx.stroke();
    } else {
      const gradient = this.ctx.createLinearGradient(0, -s, 0, s);
      gradient.addColorStop(0, this.lightenColor(color, 35));
      gradient.addColorStop(0.5, color);
      gradient.addColorStop(1, this.darkenColor(color, 20));

      this.ctx.fillStyle = gradient;
      drawShape();
      this.ctx.fill();

      this.ctx.strokeStyle = this.darkenColor(color, 40);
      this.ctx.lineWidth = 3;
      this.ctx.lineJoin = 'miter';
      drawShape();
      this.ctx.stroke();
    }
  }

  /**
   * Draw gem shape (Guitar Hero style - round with inner shine)
   */
  private drawGemShape(s: number, color: string, isReceptor: boolean, alpha: number): void {
    const radius = s * 0.85;

    if (isReceptor) {
      // Receptor: hollow circle with glow when active
      if (alpha > 0.5) {
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 15;
      }

      this.ctx.beginPath();
      this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = '#151518';
      this.ctx.fill();

      this.ctx.shadowBlur = 0;

      this.ctx.strokeStyle = alpha > 0.5 ? color : '#3a3a45';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    } else {
      // Note gem: filled circle with gradient and shine

      // Main radial gradient
      const gradient = this.ctx.createRadialGradient(
        -s * 0.2, -s * 0.2, 0,
        0, 0, radius
      );
      gradient.addColorStop(0, this.lightenColor(color, 50));
      gradient.addColorStop(0.4, this.lightenColor(color, 20));
      gradient.addColorStop(0.7, color);
      gradient.addColorStop(1, this.darkenColor(color, 30));

      this.ctx.beginPath();
      this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = gradient;
      this.ctx.fill();

      // Outer stroke
      this.ctx.strokeStyle = this.darkenColor(color, 40);
      this.ctx.lineWidth = 3;
      this.ctx.stroke();

      // Inner shine highlight
      this.ctx.beginPath();
      this.ctx.arc(-s * 0.25, -s * 0.25, radius * 0.35, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.4})`;
      this.ctx.fill();
    }
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

  /** Hold body color constant */
  private readonly HOLD_BODY_COLOR = '#ffcc00';

  /**
   * Get hold body gradient colors based on state
   */
  private getHoldBodyColors(isDropped: boolean, isActive: boolean): {
    start: string;
    mid: string;
    end: string;
    applyShadow: boolean;
  } {
    if (isDropped) {
      return { start: '#333344', mid: '#444455', end: '#333344', applyShadow: false };
    }
    const rgb = this.hexToRgb(this.HOLD_BODY_COLOR);
    if (isActive) {
      const bright = `rgba(${Math.min(255, rgb.r + 80)}, ${Math.min(255, rgb.g + 80)}, ${Math.min(255, rgb.b + 80)}, 1)`;
      return {
        start: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`,
        mid: bright,
        end: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`,
        applyShadow: true
      };
    }
    return {
      start: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`,
      mid: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`,
      end: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`,
      applyShadow: false
    };
  }

  /**
   * Draw all notes
   * @param cmod - CMod speed in pixels/second (0 = use BPM-based)
   * @param bpm - BPM for BPM-based scrolling (when cmod is 0)
   */
  drawNotes(notes: Note[], currentTime: number, cmod: number = 500, bpm: number = 120): void {
    const isGems = this.noteSkin === 'gems';

    // Calculate pixels per millisecond
    // CMod 500 = 500 pixels/second = 0.5 pixels/ms
    // When cmod is 0, derive speed from BPM (4 beats visible on screen)
    let pixelsPerMs: number;
    if (cmod === 0) {
      // BPM-based: aim for ~4 beats visible on screen
      const msPerBeat = 60000 / bpm;
      const beatsVisible = 4;
      const scrollDistance = isGems ? this.receptorY : (this.height - this.receptorY);
      pixelsPerMs = scrollDistance / (msPerBeat * beatsVisible);
    } else {
      pixelsPerMs = cmod / 1000;
    }

    // Calculate look-ahead time based on screen height
    const lookAheadMs = this.height / pixelsPerMs;

    // Guitar Hero perspective settings
    const vanishingPointY = isGems ? this.height * LAYOUT.vanishingY : 0;
    const perspectiveRange = isGems ? (this.receptorY - vanishingPointY) : 0;
    const horizonScale = LAYOUT.horizonScale;

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
      let y: number;
      let scale = 1;
      let noteX = this.columnX[note.direction];

      if (isGems) {
        // Guitar Hero style: notes come from vanishing point towards receptor
        y = this.receptorY - timeDiff * pixelsPerMs;

        // Perspective scaling based on Y position
        if (y < this.receptorY && perspectiveRange > 0) {
          const distanceFromReceptor = this.receptorY - y;
          const normalizedDistance = Math.min(1, distanceFromReceptor / perspectiveRange);

          // Scale from 1.0 (at receptor) to horizonScale (at vanishing point)
          const perspectiveScale = 1 - normalizedDistance * (1 - horizonScale);
          scale = perspectiveScale;

          // Lane convergence: move notes towards center matching the lane edges
          const centerX = this.width / 2;
          noteX = centerX + (noteX - centerX) * perspectiveScale;
        }
      } else {
        // DDR style: notes approach from below
        y = this.receptorY + timeDiff * pixelsPerMs;
      }

      // Skip if off screen
      if (y < -LAYOUT.arrowSize || y > this.height + LAYOUT.arrowSize) continue;

      // Fade out notes that are past the receptor
      let alpha: number;
      if (isGems) {
        alpha = timeDiff < 0 ? Math.max(0, 1 + timeDiff / 200) : 1;
        // Also fade in notes at vanishing point
        if (y < vanishingPointY + 50) {
          alpha *= Math.max(0, (y - vanishingPointY) / 50);
        }
      } else {
        alpha = timeDiff < 0 ? Math.max(0, 1 + timeDiff / 200) : 1;
      }

      // Get beat subdivision color
      const beatColor = this.getBeatColor(note.beat);

      this.drawArrowWithScale(noteX, y, note.direction, alpha, false, beatColor, scale);
    }
  }

  /**
   * Draw arrow/gem with custom scale (for perspective)
   */
  private drawArrowWithScale(
    x: number,
    y: number,
    direction: Direction,
    alpha: number = 1,
    isReceptor: boolean = false,
    colorOverride?: string,
    scale: number = 1
  ): void {
    const isGems = this.noteSkin === 'gems';

    if (scale === 1 && !isGems) {
      this.drawArrow(x, y, direction, alpha, isReceptor, colorOverride);
      return;
    }

    this.ctx.save();
    this.ctx.translate(x, y);

    if (isGems) {
      // Apply perspective: horizontal scale + vertical compression (looking down at highway)
      const scaleY = 0.75; // Match receptor compression
      this.ctx.scale(scale, scale * scaleY);
    } else {
      this.ctx.scale(scale, scale);
    }

    this.ctx.translate(-x, -y);
    this.drawArrow(x, y, direction, alpha, isReceptor, colorOverride);
    this.ctx.restore();
  }

  /**
   * Draw a hold/freeze note
   */
  private drawHoldNote(note: Note, currentTime: number, pixelsPerMs: number): void {
    const isGems = this.noteSkin === 'gems';

    if (isGems) {
      this.drawHoldNote3D(note, currentTime, pixelsPerMs);
    } else {
      this.drawHoldNoteFlat(note, currentTime, pixelsPerMs);
    }
  }

  /**
   * Draw hold note for DDR style (flat, notes come from bottom)
   */
  private drawHoldNoteFlat(note: Note, currentTime: number, pixelsPerMs: number): void {
    const x = this.columnX[note.direction];
    const holdState = note.holdState;

    const headTimeDiff = note.time - currentTime;
    const tailTimeDiff = (note.endTime ?? note.time) - currentTime;

    let headY = this.receptorY + headTimeDiff * pixelsPerMs;
    const tailY = this.receptorY + tailTimeDiff * pixelsPerMs;

    if (holdState?.started && !holdState?.dropped) {
      headY = this.receptorY;
    }

    const isActive = !!(holdState?.isHeld && holdState?.started && !holdState?.completed);
    const isDropped = !!holdState?.dropped;
    const bodyWidth = LAYOUT.arrowSize * 0.45;

    this.ctx.save();

    const bodyTop = Math.min(headY, tailY);
    const bodyBottom = Math.max(headY, tailY);
    const bodyHeight = bodyBottom - bodyTop;

    if (bodyHeight > 0) {
      const colors = this.getHoldBodyColors(isDropped, isActive);
      const bodyGradient = this.ctx.createLinearGradient(x - bodyWidth / 2, 0, x + bodyWidth / 2, 0);
      bodyGradient.addColorStop(0, colors.start);
      bodyGradient.addColorStop(0.5, colors.mid);
      bodyGradient.addColorStop(1, colors.end);

      if (colors.applyShadow) {
        this.ctx.shadowColor = this.HOLD_BODY_COLOR;
        this.ctx.shadowBlur = 15;
      }

      this.ctx.fillStyle = bodyGradient;
      this.roundRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight, 4);
      this.ctx.fill();

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

    if (!holdState?.completed) {
      const headAlpha = isDropped ? 0.4 : 1;
      const beatColor = this.getBeatColor(note.beat);
      this.drawArrow(x, headY, note.direction, headAlpha, false, beatColor);
    }

    if (tailY > 0 && tailY < this.height + LAYOUT.arrowSize) {
      const capHeight = LAYOUT.arrowSize * 0.3;
      const capGradient = this.ctx.createLinearGradient(0, tailY - capHeight, 0, tailY);

      if (isDropped) {
        capGradient.addColorStop(0, '#444455');
        capGradient.addColorStop(1, '#333344');
      } else {
        const rgb = this.hexToRgb(this.HOLD_BODY_COLOR);
        capGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`);
        capGradient.addColorStop(1, this.darkenColor(this.HOLD_BODY_COLOR, 30));
      }

      this.ctx.fillStyle = capGradient;
      this.roundRect(x - bodyWidth / 2, tailY - capHeight, bodyWidth, capHeight, 4);
      this.ctx.fill();

      this.ctx.strokeStyle = isDropped ? '#555566' : this.darkenColor(this.HOLD_BODY_COLOR, 20);
      this.ctx.lineWidth = 2;
      this.roundRect(x - bodyWidth / 2, tailY - capHeight, bodyWidth, capHeight, 4);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Draw hold note for Guitar Hero style (3D perspective, notes come from top)
   */
  private drawHoldNote3D(note: Note, currentTime: number, pixelsPerMs: number): void {
    const holdState = note.holdState;
    const centerX = this.width / 2;
    const baseX = this.columnX[note.direction];

    // Perspective settings
    const vanishingY = this.height * LAYOUT.vanishingY;
    const horizonScale = LAYOUT.horizonScale;
    const perspectiveRange = this.receptorY - vanishingY;

    // Calculate time differences
    const headTimeDiff = note.time - currentTime;
    const tailTimeDiff = (note.endTime ?? note.time) - currentTime;

    // Calculate Y positions (gems: notes come from above)
    let headY = this.receptorY - headTimeDiff * pixelsPerMs;
    let tailY = this.receptorY - tailTimeDiff * pixelsPerMs;

    // If hold started, keep head locked at receptor
    if (holdState?.started && !holdState?.dropped) {
      headY = this.receptorY;
    }

    // Clamp to visible range
    headY = Math.max(vanishingY, Math.min(this.receptorY, headY));
    tailY = Math.max(vanishingY, Math.min(this.height, tailY));

    // Calculate perspective scale and X position for head and tail
    const getScaleAndX = (y: number) => {
      if (y >= this.receptorY) return { scale: 1, x: baseX };
      const distanceFromReceptor = this.receptorY - y;
      const normalizedDistance = Math.min(1, distanceFromReceptor / perspectiveRange);
      const scale = 1 - normalizedDistance * (1 - horizonScale);
      const x = centerX + (baseX - centerX) * scale;
      return { scale, x };
    };

    const head = getScaleAndX(headY);
    const tail = getScaleAndX(tailY);

    const isActive = !!(holdState?.isHeld && holdState?.started && !holdState?.completed);
    const isDropped = !!holdState?.dropped;
    const bodyWidthBase = LAYOUT.arrowSize * 0.45;

    this.ctx.save();

    // Draw hold body as a trapezoid (perspective)
    const headWidth = bodyWidthBase * head.scale;
    const tailWidth = bodyWidthBase * tail.scale;

    if (Math.abs(headY - tailY) > 2) {
      // Draw trapezoid body
      this.ctx.beginPath();
      this.ctx.moveTo(tail.x - tailWidth / 2, tailY);
      this.ctx.lineTo(tail.x + tailWidth / 2, tailY);
      this.ctx.lineTo(head.x + headWidth / 2, headY);
      this.ctx.lineTo(head.x - headWidth / 2, headY);
      this.ctx.closePath();

      // Body gradient (use start/end for 2-stop gradient in 3D mode)
      const colors = this.getHoldBodyColors(isDropped, isActive);
      const bodyGradient = this.ctx.createLinearGradient(0, tailY, 0, headY);
      bodyGradient.addColorStop(0, colors.start);
      bodyGradient.addColorStop(1, colors.mid);

      if (colors.applyShadow) {
        this.ctx.shadowColor = this.HOLD_BODY_COLOR;
        this.ctx.shadowBlur = 15;
      }

      this.ctx.fillStyle = bodyGradient;
      this.ctx.fill();

      // Inner glow stripe
      if (!isDropped) {
        const innerHeadWidth = headWidth * 0.3;
        const innerTailWidth = tailWidth * 0.3;

        this.ctx.beginPath();
        this.ctx.moveTo(tail.x - innerTailWidth / 2, tailY);
        this.ctx.lineTo(tail.x + innerTailWidth / 2, tailY);
        this.ctx.lineTo(head.x + innerHeadWidth / 2, headY);
        this.ctx.lineTo(head.x - innerHeadWidth / 2, headY);
        this.ctx.closePath();

        const innerGradient = this.ctx.createLinearGradient(0, tailY, 0, headY);
        innerGradient.addColorStop(0, `rgba(255, 255, 255, ${isActive ? 0.2 : 0.1})`);
        innerGradient.addColorStop(1, `rgba(255, 255, 255, ${isActive ? 0.5 : 0.2})`);
        this.ctx.fillStyle = innerGradient;
        this.ctx.fill();
      }
      this.ctx.shadowBlur = 0;
    }

    // Draw head gem with perspective
    if (!holdState?.completed) {
      const headAlpha = isDropped ? 0.4 : 1;
      const beatColor = this.getBeatColor(note.beat);
      this.drawArrowWithScale(head.x, headY, note.direction, headAlpha, false, beatColor, head.scale);
    }

    // Draw tail cap with perspective (at the far end)
    if (tailY > vanishingY && tailY < this.receptorY) {
      const capHeight = LAYOUT.arrowSize * 0.2 * tail.scale;

      this.ctx.beginPath();
      this.ctx.ellipse(tail.x, tailY, tailWidth / 2, capHeight / 2, 0, 0, Math.PI * 2);

      if (isDropped) {
        this.ctx.fillStyle = '#444455';
      } else {
        this.ctx.fillStyle = this.darkenColor(this.HOLD_BODY_COLOR, 20);
      }
      this.ctx.fill();
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
      this.ctx.rotate(DIRECTION_ROTATIONS[effect.direction]);

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
    // Timing panel position - same for both modes (near top of screen)
    const centerY = this.height * 0.15;

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

    // Combo position - same for both modes (below judgment)
    const centerX = this.width / 2;
    const centerY = this.height * 0.25;

    this.ctx.translate(centerX, centerY);
    this.ctx.scale(scale, scale);
    this.ctx.translate(-centerX, -centerY);

    // Enhanced shiny effect for combo > 50
    const isShinyCombo = this.displayCombo > 50;

    // Glow effect for high combos
    if (this.displayCombo >= 20) {
      const glowIntensity = Math.min(1, (this.displayCombo - 20) / 50);
      const pulsePhase = (currentTime / 100) % (Math.PI * 2);
      const pulse = 0.5 + 0.5 * Math.sin(pulsePhase);

      if (isShinyCombo) {
        // Rainbow cycling glow for shiny combos
        const hue = (currentTime / 10) % 360;
        this.ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
        this.ctx.shadowBlur = 30 + pulse * 25;
      } else {
        this.ctx.shadowColor = this.getComboColor(this.displayCombo);
        this.ctx.shadowBlur = 20 + pulse * 15 * glowIntensity;
      }
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
    if (isShinyCombo) {
      // Rainbow shimmer gradient for shiny combos
      const shimmerOffset = (currentTime / 5) % 200;
      const gradient = this.ctx.createLinearGradient(
        centerX - 60 + shimmerOffset, centerY - 30,
        centerX + 60 + shimmerOffset, centerY + 30
      );
      const hue1 = (currentTime / 15) % 360;
      const hue2 = (hue1 + 60) % 360;
      const hue3 = (hue1 + 120) % 360;
      const hue4 = (hue1 + 180) % 360;
      gradient.addColorStop(0, `hsl(${hue1}, 100%, 70%)`);
      gradient.addColorStop(0.33, `hsl(${hue2}, 100%, 70%)`);
      gradient.addColorStop(0.66, `hsl(${hue3}, 100%, 70%)`);
      gradient.addColorStop(1, `hsl(${hue4}, 100%, 70%)`);
      this.ctx.fillStyle = gradient;
    } else if (this.displayCombo >= 50) {
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

    // Draw sparkles for shiny combos
    if (isShinyCombo) {
      this.drawComboSparkles(centerX, centerY, currentTime);
    }

    // "COMBO" label with tier color
    this.ctx.font = 'bold 14px -apple-system, sans-serif';
    if (isShinyCombo) {
      const hue = (currentTime / 15) % 360;
      this.ctx.fillStyle = `hsl(${hue}, 100%, 70%)`;
    } else {
      this.ctx.fillStyle = color;
    }
    this.ctx.globalAlpha = 0.9;
    this.ctx.fillText('COMBO', centerX, centerY + 38);

    // Milestone indicator
    this.drawMilestoneIndicator(centerX, centerY, timeSinceIncrease);

    this.ctx.restore();
  }

  /**
   * Draw milestone indicator when combo hits multiples of 50
   */
  private drawMilestoneIndicator(centerX: number, centerY: number, timeSinceIncrease: number): void {
    if (this.displayCombo % 50 !== 0 || timeSinceIncrease >= 500) return;

    const milestoneAlpha = 1 - timeSinceIncrease / 500;
    this.ctx.globalAlpha = milestoneAlpha;
    this.ctx.font = 'bold 20px -apple-system, sans-serif';
    this.ctx.fillStyle = '#ffdd00';
    this.ctx.fillText('★ MILESTONE ★', centerX, centerY - 50);
  }

  /**
   * Draw sparkle particles around combo text for shiny effect
   */
  private drawComboSparkles(centerX: number, centerY: number, currentTime: number): void {
    const sparkleCount = 8;
    const radius = 50;

    for (let i = 0; i < sparkleCount; i++) {
      const angle = (i / sparkleCount) * Math.PI * 2 + (currentTime / 500);
      const wobble = Math.sin(currentTime / 100 + i * 1.5) * 10;
      const x = centerX + Math.cos(angle) * (radius + wobble);
      const y = centerY + Math.sin(angle) * (radius + wobble) - 5;

      const sparklePhase = (currentTime / 150 + i * 0.5) % 1;
      const sparkleAlpha = Math.sin(sparklePhase * Math.PI) * 0.8;

      if (sparkleAlpha > 0.1) {
        const hue = (currentTime / 10 + i * 45) % 360;
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(currentTime / 200 + i);
        this.ctx.globalAlpha = sparkleAlpha;

        // Draw 4-pointed star
        this.ctx.beginPath();
        const starSize = 4 + Math.sin(currentTime / 80 + i) * 2;
        this.ctx.moveTo(0, -starSize);
        this.ctx.lineTo(starSize * 0.3, 0);
        this.ctx.lineTo(0, starSize);
        this.ctx.lineTo(-starSize * 0.3, 0);
        this.ctx.closePath();
        this.ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
        this.ctx.fill();

        this.ctx.beginPath();
        this.ctx.moveTo(-starSize, 0);
        this.ctx.lineTo(0, starSize * 0.3);
        this.ctx.lineTo(starSize, 0);
        this.ctx.lineTo(0, -starSize * 0.3);
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.restore();
      }
    }
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
      const stepsRemaining = state.activeNotes.filter(n => !n.judged).length;
      const totalSteps = state.chart.notes.length;
      this.drawTimingStats(stepsRemaining, totalSteps);
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

  /**
   * Draw multiplayer opponents panel on the right side
   */
  drawOpponents(opponents: Array<{ id: string; name: string; health: number; combo: number; isAlive: boolean }>): void {
    if (opponents.length === 0) return;

    // Position to the right of the lanes
    const totalLaneWidth = LAYOUT.arrowSize * 4 + LAYOUT.arrowGap * 3;
    const lanesEndX = (this.width + totalLaneWidth) / 2;
    const panelX = lanesEndX + 30;
    const panelY = 100;
    const cardWidth = 140;
    const cardHeight = 50;
    const cardGap = 8;

    this.ctx.save();

    // Panel title
    this.ctx.font = 'bold 14px -apple-system, sans-serif';
    this.ctx.fillStyle = THEME.text.secondary;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText('OPPONENTS', panelX, panelY - 25);

    // Draw each opponent card
    opponents.forEach((opponent, index) => {
      const y = panelY + index * (cardHeight + cardGap);

      // Card background
      this.ctx.fillStyle = opponent.isAlive
        ? 'rgba(20, 20, 30, 0.8)'
        : 'rgba(40, 10, 10, 0.6)';
      this.roundRect(panelX, y, cardWidth, cardHeight, 8);
      this.ctx.fill();

      // Border
      this.ctx.strokeStyle = opponent.isAlive
        ? 'rgba(100, 100, 120, 0.5)'
        : 'rgba(100, 50, 50, 0.5)';
      this.ctx.lineWidth = 1;
      this.roundRect(panelX, y, cardWidth, cardHeight, 8);
      this.ctx.stroke();

      // Name
      this.ctx.font = 'bold 12px -apple-system, sans-serif';
      this.ctx.fillStyle = opponent.isAlive ? THEME.text.primary : THEME.text.muted;
      this.ctx.textAlign = 'left';
      const displayName = opponent.name.length > 12 ? opponent.name.slice(0, 11) + '...' : opponent.name;
      this.ctx.fillText(displayName, panelX + 10, y + 12);

      if (opponent.isAlive) {
        // Mini health bar
        const healthBarX = panelX + 10;
        const healthBarY = y + 28;
        const healthBarWidth = cardWidth - 20;
        const healthBarHeight = 8;

        // Background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        this.roundRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight, 4);
        this.ctx.fill();

        // Health fill
        const healthPercent = Math.max(0, Math.min(100, opponent.health)) / 100;
        const healthColor = opponent.health > 60 ? '#cc2222' : opponent.health > 30 ? '#cc6600' : '#aa1111';
        this.ctx.fillStyle = healthColor;
        if (healthPercent > 0) {
          this.roundRect(healthBarX, healthBarY, healthBarWidth * healthPercent, healthBarHeight, 4);
          this.ctx.fill();
        }

        // Combo (on the right)
        if (opponent.combo > 0) {
          this.ctx.font = 'bold 11px -apple-system, sans-serif';
          this.ctx.fillStyle = opponent.combo >= 50 ? THEME.accent.warning : THEME.text.secondary;
          this.ctx.textAlign = 'right';
          this.ctx.fillText(`${opponent.combo}x`, panelX + cardWidth - 10, y + 12);
        }
      } else {
        // Eliminated text
        this.ctx.font = 'bold 10px -apple-system, sans-serif';
        this.ctx.fillStyle = THEME.accent.error;
        this.ctx.textAlign = 'left';
        this.ctx.fillText('ELIMINATED', panelX + 10, y + 32);
      }
    });

    this.ctx.restore();
  }

  /**
   * Draw attack arrow with special styling
   */
  drawAttackArrow(
    direction: Direction,
    y: number,
    currentTime: number,
    fromPlayerName: string
  ): void {
    const x = this.columnX[direction];
    const size = LAYOUT.arrowSize;

    this.ctx.save();

    // Pulsing red glow
    const pulse = 0.5 + 0.5 * Math.sin(currentTime / 100);
    this.ctx.shadowColor = '#ff0044';
    this.ctx.shadowBlur = 15 + pulse * 10;

    // Draw arrow shape
    this.ctx.translate(x, y);

    // Rotation based on direction
    const rotations: Record<Direction, number> = {
      left: Math.PI,
      down: Math.PI / 2,
      up: -Math.PI / 2,
      right: 0,
    };
    this.ctx.rotate(rotations[direction]);

    // Arrow body
    const arrowPath = new Path2D();
    const halfSize = size * 0.4;

    // Create arrow shape pointing right
    arrowPath.moveTo(halfSize, 0);
    arrowPath.lineTo(0, -halfSize);
    arrowPath.lineTo(0, -halfSize * 0.4);
    arrowPath.lineTo(-halfSize * 0.8, -halfSize * 0.4);
    arrowPath.lineTo(-halfSize * 0.8, halfSize * 0.4);
    arrowPath.lineTo(0, halfSize * 0.4);
    arrowPath.lineTo(0, halfSize);
    arrowPath.closePath();

    // Fill with red gradient
    const gradient = this.ctx.createLinearGradient(-halfSize, 0, halfSize, 0);
    gradient.addColorStop(0, '#ff2244');
    gradient.addColorStop(0.5, '#ff4466');
    gradient.addColorStop(1, '#ff2244');

    this.ctx.fillStyle = gradient;
    this.ctx.fill(arrowPath);

    // Border
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke(arrowPath);

    this.ctx.restore();

    // Draw attacker name above arrow
    this.ctx.save();
    this.ctx.font = 'bold 10px -apple-system, sans-serif';
    this.ctx.fillStyle = '#ff4466';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText(fromPlayerName, x, y - size / 2 - 5);
    this.ctx.restore();
  }

  /**
   * Draw multiplayer HUD (alive count, etc.)
   */
  drawMultiplayerHUD(aliveCount: number, totalPlayers: number): void {
    this.ctx.save();

    // Position at top center
    const x = this.width / 2;
    const y = 20;

    // Background pill
    const text = `${aliveCount}/${totalPlayers} ALIVE`;
    this.ctx.font = 'bold 14px -apple-system, sans-serif';
    const textWidth = this.ctx.measureText(text).width;
    const pillWidth = textWidth + 24;
    const pillHeight = 28;

    this.ctx.fillStyle = 'rgba(20, 20, 30, 0.9)';
    this.roundRect(x - pillWidth / 2, y, pillWidth, pillHeight, pillHeight / 2);
    this.ctx.fill();

    // Border
    this.ctx.strokeStyle = THEME.accent.primary;
    this.ctx.lineWidth = 1;
    this.roundRect(x - pillWidth / 2, y, pillWidth, pillHeight, pillHeight / 2);
    this.ctx.stroke();

    // Text
    this.ctx.fillStyle = THEME.text.primary;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, x, y + pillHeight / 2);

    this.ctx.restore();
  }
}
