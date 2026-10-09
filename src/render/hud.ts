import type { JudgmentGrade, HoldGrade, Song, Chart } from '../types';
import { TIMING_WINDOWS } from '../types';
import { JUDGMENT_LABEL, THEME } from './theme';
import { escapeHtml, assetUrl, fitCanvas } from '../ui/dom';

// ============================================================================
// DOM HUD over the WebGL stage: crisp text, animated with WAAPI (compositor
// only: transform/opacity). Updates touch the DOM only when a value changes.
// ============================================================================

export interface OpponentView {
  id: string;
  name: string;
  health: number;
  combo: number;
  score: number;
  isAlive: boolean;
  placement?: number;
}

export interface HudFrame {
  life: number;
  score: number;
  percentage: number;
  combo: number;
  progress: number;
  elapsedMs: number;
  totalMs: number;
  bpm: number;
  counts: Record<JudgmentGrade, number>;
  holds: Record<HoldGrade, number>;
  opponents: OpponentView[];
  /** Pacemaker: points ahead (+) or behind (−) the reference */
  pace: { label: string; delta: number } | null;
}

const ERROR_TICKS = 40;

export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private last: Record<string, string | number> = {};
  private errorCanvas: HTMLCanvasElement;
  private errorCtx: CanvasRenderingContext2D;
  private errorSize = { w: 240, h: 18 };
  private errorTicks: { offset: number; grade: JudgmentGrade; at: number }[] = [];
  private judgmentAnim: Animation | null = null;
  private comboAnim: Animation | null = null;
  /** Fading animations hold their end state (fill: forwards): cancel before showing again */
  private comboFade: Animation | null = null;
  private fastslowFade: Animation | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud hidden';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-life"><div class="hud-life-fill"></div><div class="hud-life-glint"></div><span class="hud-life-label">LIFE</span></div>
      </div>
      <aside class="hud-left">
        <div class="hud-song">
          <div class="hud-banner"></div>
          <div class="hud-song-meta">
            <div class="hud-title"></div>
            <div class="hud-artist"></div>
            <div class="hud-chart"><span class="hud-diff"></span><span class="hud-bpm"></span></div>
          </div>
        </div>
        <ul class="hud-counts">
          ${(['marvelous', 'perfect', 'great', 'good', 'boo', 'miss'] as JudgmentGrade[])
            .map((g) => `<li style="--c: var(--judge-${g})"><span>${JUDGMENT_LABEL[g]}</span><b data-count="${g}">0</b></li>`)
            .join('')}
          <li style="--c: var(--accent-success)"><span>OK</span><b data-count="ok">0</b></li>
        </ul>
      </aside>
      <aside class="hud-right">
        <div class="hud-score-label">SCORE</div>
        <div class="hud-score">0</div>
        <div class="hud-pct">0.00%</div>
        <div class="hud-pace"><span class="hud-pace-label"></span><b class="hud-pace-delta"></b></div>
        <div class="hud-opponents"></div>
      </aside>
      <div class="hud-center">
        <div class="hud-judgment"><span class="hud-judgment-text"></span><span class="hud-fastslow"></span></div>
        <div class="hud-combo"><span class="hud-combo-num"></span><span class="hud-combo-label">COMBO</span></div>
        <canvas class="hud-error" width="360" height="28"></canvas>
      </div>
      <div class="hud-progress"><div class="hud-progress-fill"></div><span class="hud-time"></span></div>
      <div class="hud-banner-msg"></div>
      <div class="hud-badge hidden"></div>
    `;
    parent.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.el = {
      lifeFill: q('.hud-life-fill'),
      life: q('.hud-life'),
      banner: q('.hud-banner'),
      title: q('.hud-title'),
      artist: q('.hud-artist'),
      diff: q('.hud-diff'),
      bpm: q('.hud-bpm'),
      score: q('.hud-score'),
      pct: q('.hud-pct'),
      opponents: q('.hud-opponents'),
      center: q('.hud-center'),
      judgment: q('.hud-judgment'),
      judgmentText: q('.hud-judgment-text'),
      fastslow: q('.hud-fastslow'),
      combo: q('.hud-combo'),
      comboNum: q('.hud-combo-num'),
      progressFill: q('.hud-progress-fill'),
      time: q('.hud-time'),
      message: q('.hud-banner-msg'),
      badge: q('.hud-badge'),
      pace: q('.hud-pace'),
      paceLabel: q('.hud-pace-label'),
      paceDelta: q('.hud-pace-delta'),
    };
    this.root.querySelectorAll<HTMLElement>('[data-count]').forEach((e) => (this.el[`count-${e.dataset.count}`] = e));
    this.errorCanvas = q('.hud-error') as unknown as HTMLCanvasElement;
    this.errorCtx = this.errorCanvas.getContext('2d')!;
  }

  /** `badge`: AUTOPLAY / PRACTICE / rate, empty for a normal run */
  show(song: Song, chart: Chart, badge: string): void {
    this.root.classList.remove('hidden');
    this.last = {};
    this.errorTicks = [];
    this.el.title!.textContent = song.title;
    this.el.artist!.textContent = song.artist;
    this.el.diff!.textContent = `${chart.difficulty.toUpperCase()} ${chart.level}`;
    this.el.diff!.dataset.diff = chart.difficulty;
    const banner = assetUrl(song.basePath, song.banner);
    this.el.banner!.style.backgroundImage = banner ? `url("${banner}")` : '';
    this.el.badge!.textContent = badge;
    this.el.badge!.classList.toggle('hidden', !badge);
    this.comboFade?.cancel();
    this.fastslowFade?.cancel();
    this.el.judgmentText!.textContent = '';
    this.el.fastslow!.textContent = '';
    this.el.combo!.style.opacity = '0';
    this.el.message!.innerHTML = '';
    requestAnimationFrame(() => {
      const { ctx, w, h } = fitCanvas(this.errorCanvas);
      this.errorCtx = ctx;
      this.errorSize = { w, h };
    });
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setFocus(on: boolean): void {
    this.root.classList.toggle('focus', on);
  }

  /** Align the center column with the playfield */
  layout(receptorY: number, laneSpan: [number, number], tilted: boolean): void {
    const c = this.el.center!;
    c.style.left = `${((laneSpan[0] + laneSpan[1]) / 2) * 100}%`;
    c.style.top = tilted ? '24%' : `${Math.min(0.62, receptorY + 0.3) * 100}%`;
    this.root.classList.toggle('tilted', tilted);
    this.root.style.setProperty('--lane-left', `${laneSpan[0] * 100}%`);
    this.root.style.setProperty('--lane-right', `${(1 - laneSpan[1]) * 100}%`);
  }

  private set(key: string, value: string | number, apply: (v: string | number) => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  update(f: HudFrame): void {
    const life = Math.round(f.life * 2) / 2;
    this.set('life', life, () => {
      this.el.lifeFill!.style.transform = `scaleX(${life / 100})`;
      this.el.life!.dataset.state = life >= 100 ? 'full' : life < 25 ? 'danger' : 'normal';
    });
    this.set('score', f.score, () => (this.el.score!.textContent = f.score.toLocaleString('en-US')));
    this.set('pct', f.percentage.toFixed(2), (v) => (this.el.pct!.textContent = `${v}%`));
    this.set('bpm', Math.round(f.bpm), (v) => (this.el.bpm!.textContent = `${v} BPM`));
    this.set('progress', Math.round(f.progress * 400), () => (this.el.progressFill!.style.transform = `scaleX(${Math.max(0, Math.min(1, f.progress))})`));
    const fmt = (ms: number) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    this.set('time', `${fmt(f.elapsedMs)} / ${fmt(f.totalMs)}`, (v) => (this.el.time!.textContent = String(v)));
    for (const [g, n] of Object.entries(f.counts)) this.set(`c-${g}`, n, (v) => (this.el[`count-${g}`]!.textContent = String(v)));
    this.set('c-ok', f.holds.ok, (v) => (this.el['count-ok']!.textContent = String(v)));

    const oppKey = f.opponents.map((o) => `${o.id}:${Math.round(o.health)}:${o.combo}:${o.isAlive}`).join('|');
    this.set('opp', oppKey, () => {
      this.el.opponents!.innerHTML = f.opponents
        .sort((a, b) => Number(b.isAlive) - Number(a.isAlive) || b.score - a.score)
        .map(
          (o) => `<div class="hud-opp ${o.isAlive ? '' : 'out'}">
            <span class="hud-opp-name">${escapeHtml(o.name)}</span>
            <span class="hud-opp-combo">${o.isAlive ? `${o.combo}x` : `#${o.placement ?? '-'}`}</span>
            <div class="hud-opp-life"><i style="transform:scaleX(${Math.max(0, o.health) / 100})"></i></div>
          </div>`
        )
        .join('');
    });

    const pace = f.pace ? `${f.pace.label}|${Math.round(f.pace.delta / 10) * 10}` : '';
    this.set('pace', pace, () => {
      this.el.pace!.classList.toggle('hidden', !f.pace);
      if (!f.pace) return;
      const d = Math.round(f.pace.delta / 10) * 10;
      this.el.paceLabel!.textContent = `vs ${f.pace.label}`;
      this.el.paceDelta!.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString('en-US')}`;
      this.el.pace!.dataset.side = d >= 0 ? 'ahead' : 'behind';
    });

    this.drawErrorBar();
  }

  judgment(grade: JudgmentGrade, offset: number, combo: number, showMs = false): void {
    const t = this.el.judgmentText!;
    t.textContent = JUDGMENT_LABEL[grade];
    t.dataset.grade = grade;
    const fs = this.el.fastslow!;
    this.fastslowFade?.cancel();
    this.fastslowFade = null;
    if (grade !== 'miss' && (grade !== 'marvelous' || showMs)) {
      const ms = Math.round(Math.abs(offset));
      fs.textContent = showMs ? `${offset < 0 ? '−' : '+'}${ms} ms` : offset < 0 ? `FAST ${ms}` : `SLOW ${ms}`;
      fs.dataset.side = ms === 0 ? 'center' : offset < 0 ? 'fast' : 'slow';
    } else {
      fs.textContent = '';
    }
    this.judgmentAnim?.cancel();
    this.judgmentAnim = this.el.judgment!.animate(
      [
        { transform: 'scale(1.35)', opacity: 1, filter: 'brightness(2)' },
        { transform: 'scale(1)', opacity: 1, filter: 'brightness(1)', offset: 0.12 },
        { transform: 'scale(1)', opacity: 1, offset: 0.75 },
        { transform: 'scale(0.96)', opacity: 0 },
      ],
      { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
    );
    if (grade !== 'miss') {
      this.errorTicks.push({ offset, grade, at: performance.now() });
      if (this.errorTicks.length > ERROR_TICKS) this.errorTicks.shift();
    }
    this.combo(combo);
  }

  combo(combo: number): void {
    const c = this.el.combo!;
    if (combo < 4) {
      c.style.opacity = '0';
      this.el.comboNum!.textContent = '';
      return;
    }
    this.comboFade?.cancel();
    this.comboFade = null;
    c.style.opacity = '1';
    this.el.comboNum!.textContent = String(combo);
    c.dataset.tier = combo >= 500 ? '3' : combo >= 200 ? '2' : combo >= 100 ? '1' : '0';
    this.comboAnim?.cancel();
    this.comboAnim = this.el.comboNum!.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 140, easing: 'ease-out' });
  }

  comboBreak(): void {
    this.comboFade?.cancel();
    this.comboFade = this.el.combo!.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(30px)', opacity: 0 }], { duration: 350, easing: 'ease-in', fill: 'forwards' });
  }

  holdResult(grade: HoldGrade): void {
    if (grade === 'ng') {
      this.el.fastslow!.textContent = 'N.G.';
      this.el.fastslow!.dataset.side = 'ng';
      this.fastslowFade?.cancel();
      this.fastslowFade = this.el.fastslow!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: 'forwards' });
    }
  }

  /** Big centered message: READY / GO / FULL COMBO / FAILED / CLEARED */
  message(text: string, variant: string, durationMs = 1100): void {
    const m = this.el.message!;
    const node = document.createElement('div');
    node.className = `hud-msg hud-msg-${variant}`;
    node.textContent = text;
    node.dataset.text = text;
    m.appendChild(node);
    node
      .animate(
        [
          { transform: 'scale(2.2) skewX(-8deg)', opacity: 0, letterSpacing: '0.6em' },
          { transform: 'scale(1) skewX(-8deg)', opacity: 1, letterSpacing: '0.08em', offset: 0.15 },
          { transform: 'scale(1.04) skewX(-8deg)', opacity: 1, offset: 0.8 },
          { transform: 'scale(1.1) skewX(-8deg)', opacity: 0 },
        ],
        { duration: durationMs, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'forwards' }
      )
      .finished.then(() => node.remove())
      .catch(() => node.remove());
  }

  showPause(visible: boolean, multiplayer: boolean): void {
    let p = this.root.querySelector('.hud-pause') as HTMLElement | null;
    if (!visible) {
      p?.remove();
      return;
    }
    if (p) return;
    p = document.createElement('div');
    p.className = 'hud-pause';
    p.innerHTML = `<div class="hud-pause-card">
      <h2>PAUSED</h2>
      <p><kbd>Enter</kbd> resume after a 3-2-1${multiplayer ? '' : ', right where you stopped'}</p>
      <p><kbd>Esc</kbd> quit to song select</p>
    </div>`;
    this.root.appendChild(p);
  }

  private drawErrorBar(): void {
    const ctx = this.errorCtx;
    const { w, h } = this.errorSize;
    const range = TIMING_WINDOWS.good;
    const x = (ms: number) => w / 2 + (ms / range) * (w / 2 - 4);
    ctx.clearRect(0, 0, w, h);
    const bands: [number, string][] = [
      [TIMING_WINDOWS.good, THEME.judgment.good],
      [TIMING_WINDOWS.great, THEME.judgment.great],
      [TIMING_WINDOWS.perfect, THEME.judgment.perfect],
      [TIMING_WINDOWS.marvelous, THEME.judgment.marvelous],
    ];
    for (const [win, color] of bands) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.fillRect(x(-win), h / 2 - 3, x(win) - x(-win), 6);
    }
    const now = performance.now();
    for (const t of this.errorTicks) {
      const age = (now - t.at) / 4000;
      if (age > 1) continue;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = THEME.judgment[t.grade];
      ctx.fillRect(x(Math.max(-range, Math.min(range, t.offset))) - 1, 2, 2, h - 4);
    }
    // running mean
    const recent = this.errorTicks.slice(-15);
    if (recent.length > 3) {
      const mean = recent.reduce((a, t) => a + t.offset, 0) / recent.length;
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      const mx = x(mean);
      ctx.beginPath();
      ctx.moveTo(mx - 5, 0);
      ctx.lineTo(mx + 5, 0);
      ctx.lineTo(mx, 6);
      ctx.fill();
    }
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w / 2 - 0.5, 0, 1, h);
    ctx.globalAlpha = 1;
  }
}
