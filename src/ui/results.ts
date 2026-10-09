import type { ResultsData, JudgmentGrade, LetterGrade } from '../types';
import { DIRECTIONS, TIMING_WINDOWS } from '../types';
import { audio, type SfxId } from '../audio';
import { JUDGMENT_LABEL, THEME } from '../render/theme';
import { escapeHtml, fitCanvas } from './dom';
import { breakdown, coach } from './precision';
import { chartStats } from './chart-stats';

// ============================================================================
// Results: staged reveal (judgments → score → grade slam → badges), then the
// timing breakdown that tells the player what to fix — including an offset
// suggestion when their hits are consistently early or late.
// ============================================================================

export interface ResultsCallbacks {
  onContinue: () => void;
  onRetry: () => void;
  onApplyOffset: (deltaMs: number) => void;
}

const GRADE_VO: Record<LetterGrade, SfxId | null> = {
  AAAA: 'vo-grade-aaaa',
  AAA: 'vo-grade-aaa',
  AA: 'vo-grade-aa',
  A: 'vo-grade-a',
  B: 'vo-grade-b',
  C: 'vo-grade-c',
  D: 'vo-grade-d',
  E: null,
};

/** Minimum hits before an offset suggestion is trustworthy */
const MIN_SAMPLES_FOR_SUGGESTION = 40;
const SUGGESTION_THRESHOLD_MS = 8;

export function offsetStats(offsets: number[]): { mean: number; sd: number; median: number } {
  if (offsets.length === 0) return { mean: 0, sd: 0, median: 0 };
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const sd = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length);
  const sorted = [...offsets].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return { mean, sd, median };
}

export class ResultsScreen {
  private readonly root: HTMLElement;
  private timers: number[] = [];
  private visible = false;
  private suggestion = 0;

  constructor(
    parent: HTMLElement,
    private readonly cb: ResultsCallbacks
  ) {
    this.root = document.createElement('div');
    this.root.className = 'results hidden';
    parent.appendChild(this.root);
  }

  show(r: ResultsData, newRecord: boolean, multiplayer: boolean): void {
    this.visible = true;
    this.clearTimers();
    const stats = offsetStats(r.offsets);
    this.suggestion = !r.autoplay && r.offsets.length >= MIN_SAMPLES_FOR_SUGGESTION && Math.abs(stats.median) >= SUGGESTION_THRESHOLD_MS ? Math.round(stats.median) : 0;
    const grades: JudgmentGrade[] = ['marvelous', 'perfect', 'great', 'good', 'boo', 'miss'];
    const fcLabel = r.isFullCombo
      ? r.judgmentCounts.great > 0
        ? 'FULL COMBO'
        : r.judgmentCounts.perfect > 0
          ? 'PERFECT FULL COMBO'
          : 'MARVELOUS FULL COMBO'
      : '';

    this.root.innerHTML = `
      <div class="results-inner">
        <header class="res-head">
          <div class="res-song">
            <div class="res-title">${escapeHtml(r.song.title)}</div>
            <div class="res-artist">${escapeHtml(r.song.artist)}</div>
          </div>
          <div class="res-chart" data-diff="${r.chart.difficulty}">${r.chart.difficulty.toUpperCase()} <b>${r.chart.level}</b></div>
          ${r.autoplay ? '<div class="res-auto">AUTOPLAY · not saved</div>' : r.rate !== 1 ? `<div class="res-auto">RATE ${r.rate}× · not saved</div>` : ''}
        </header>
        <section class="res-main">
          <div class="res-grade-wrap">
            <div class="res-grade" data-grade="${r.grade}" data-text="${r.grade}">${r.grade}</div>
            <div class="res-fc">${fcLabel}</div>
            <div class="res-record ${newRecord ? '' : 'hidden'}">NEW RECORD</div>
          </div>
          <div class="res-numbers">
            <div class="res-score-label">SCORE</div>
            <div class="res-score">0</div>
            <div class="res-pct">${r.percentage.toFixed(2)}%</div>
            <div class="res-sub"><span>EX <b>${r.exScore}</b> / ${r.maxExScore}</span><span>MAX COMBO <b>${r.maxCombo}</b></span></div>
            <ul class="res-judgments">
              ${grades
                .map((g) => `<li style="--c: var(--judge-${g})"><span>${JUDGMENT_LABEL[g]}</span><b>${r.judgmentCounts[g]}</b></li>`)
                .join('')}
              <li style="--c: var(--accent-success)"><span>OK</span><b>${r.holdCounts.ok}</b></li>
              <li style="--c: var(--accent-danger)"><span>N.G.</span><b>${r.holdCounts.ng}</b></li>
              ${r.minesHit ? `<li style="--c: var(--accent-danger)"><span>MINES HIT</span><b>${r.minesHit}</b></li>` : ''}
            </ul>
          </div>
        </section>
        <section class="res-timing glass">
          <div class="res-timing-head">
            <h3>Timing</h3>
            <span>mean <b>${stats.mean >= 0 ? '+' : ''}${stats.mean.toFixed(1)} ms</b></span>
            <span>σ <b>${stats.sd.toFixed(1)} ms</b></span>
            <span class="res-early-late">${stats.mean < -2 ? 'You tend to hit <b>early</b>' : stats.mean > 2 ? 'You tend to hit <b>late</b>' : 'Centered'}</span>
          </div>
          <div class="res-timing-body">
          <div class="res-timing-left">
          <canvas class="res-hist"></canvas>
          <div class="res-dirs">${DIRECTIONS.map((d, i) => {
            const s = r.directionStats[d];
            const pos = Math.max(-1, Math.min(1, s.avgTiming / TIMING_WINDOWS.great));
            return `<div class="res-dir"><span class="res-dir-arrow" style="color:${THEME.lane[i]}">${['←', '↓', '↑', '→'][i]}</span>
              <div class="res-dir-bar"><i style="left:${50 + pos * 50}%"></i></div><b>${s.count ? `${s.avgTiming >= 0 ? '+' : ''}${s.avgTiming.toFixed(0)}` : '–'}</b></div>`;
          }).join('')}</div>
          </div>
          <div class="res-precision">
            <table>
              <thead><tr><th></th><th>hits</th><th>mean</th><th>σ</th><th>marv</th></tr></thead>
              <tbody>${breakdown(r.hits)
                .map((g) => `<tr><th>${g.label}</th><td>${g.n}</td><td>${g.mean >= 0 ? '+' : ''}${g.mean.toFixed(0)}</td><td>${g.sd.toFixed(1)}</td><td>${Math.round(g.marvelous * 100)}%</td></tr>`)
                .join('')}</tbody>
            </table>
            <ul class="res-coach">${coach(r.hits).map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
          </div>
          </div>
          ${this.suggestion
            ? `<div class="res-suggest">Your hits sit <b>${Math.abs(this.suggestion)} ms ${this.suggestion > 0 ? 'late' : 'early'}</b> <button class="btn" data-act="offset"><kbd>O</kbd> Shift offset ${this.suggestion > 0 ? '+' : ''}${this.suggestion} ms</button></div>`
            : ''}
          <div class="res-map-head"><span>Run map</span><i style="--c:var(--judge-miss)">miss / N.G.</i><i style="--c:var(--judge-boo)">boo</i><i style="--c:var(--judge-good)">good</i><i style="--c:var(--accent-success)">life</i></div>
          <canvas class="res-life"></canvas>
        </section>
        <footer class="res-actions">
          ${multiplayer ? '' : '<button class="btn" data-act="retry"><kbd>R</kbd> Retry</button>'}
          <button class="btn btn-primary" data-act="continue"><kbd>Enter</kbd> Continue</button>
        </footer>
      </div>`;
    this.root.classList.remove('hidden');
    this.root.classList.toggle('failed', r.failed);

    this.root.querySelector('[data-act="continue"]')!.addEventListener('click', () => this.leave('continue'));
    this.root.querySelector('[data-act="retry"]')?.addEventListener('click', () => this.leave('retry'));
    this.root.querySelector('[data-act="offset"]')?.addEventListener('click', () => this.applyOffset());
    window.addEventListener('keydown', this.onKey);

    this.drawHistogram(r.offsets);
    this.drawLife(r);
    this.stage(r, newRecord);
  }

  hide(): void {
    this.visible = false;
    this.clearTimers();
    window.removeEventListener('keydown', this.onKey);
    this.root.classList.add('hidden');
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.visible || e.repeat) return;
    if (e.code === 'Enter' || e.code === 'Escape') this.leave('continue');
    else if (e.code === 'KeyR' && this.root.querySelector('[data-act="retry"]')) this.leave('retry');
    else if (e.code === 'KeyO') this.applyOffset();
    else return;
    e.preventDefault();
  };

  private applyOffset(): void {
    if (!this.suggestion) return;
    this.cb.onApplyOffset(this.suggestion);
    const s = this.root.querySelector('.res-suggest');
    if (s) s.innerHTML = `Offset shifted by <b>${this.suggestion > 0 ? '+' : ''}${this.suggestion} ms</b>. Retry to feel the difference.`;
    audio.play1('ui-select');
    this.suggestion = 0;
  }

  private leave(to: 'continue' | 'retry'): void {
    audio.play1(to === 'retry' ? 'ui-start' : 'ui-back');
    this.hide();
    if (to === 'retry') this.cb.onRetry();
    else this.cb.onContinue();
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private at(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(() => this.visible && fn(), ms));
  }

  /** Staged reveal, mirrored by sound */
  private stage(r: ResultsData, newRecord: boolean): void {
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    audio.play1('whoosh');
    this.root.querySelectorAll<HTMLElement>('.res-judgments li').forEach((li, i) => {
      li.style.opacity = '0';
      this.at(250 + i * 90, () => {
        li.animate([{ transform: 'translateX(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'forwards' });
        audio.play1('score-tick', { gain: 0.5, rate: 1 + i * 0.06 });
      });
    });

    const scoreEl = q('.res-score');
    const countStart = 700;
    const countMs = 900;
    this.at(countStart, () => {
      const t0 = performance.now();
      let lastTick = 0;
      const step = () => {
        if (!this.visible) return;
        const k = Math.min(1, (performance.now() - t0) / countMs);
        const eased = 1 - Math.pow(1 - k, 3);
        scoreEl.textContent = Math.round(r.score * eased).toLocaleString('en-US');
        if (performance.now() - lastTick > 55 && k < 1) {
          lastTick = performance.now();
          audio.play1('score-tick', { gain: 0.35, rate: 0.9 + eased * 0.8 });
        }
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    const grade = q('.res-grade');
    grade.style.opacity = '0';
    this.at(countStart + countMs + 150, () => {
      grade.animate(
        [
          { transform: 'scale(3.2) rotate(-8deg)', opacity: 0, filter: 'blur(12px) brightness(3)' },
          { transform: 'scale(0.92) rotate(0deg)', opacity: 1, filter: 'blur(0) brightness(1.6)', offset: 0.55 },
          { transform: 'scale(1)', opacity: 1, filter: 'blur(0) brightness(1)' },
        ],
        { duration: 520, easing: 'cubic-bezier(.3,1.4,.4,1)', fill: 'forwards' }
      );
      audio.play1('grade-slam');
      this.root.animate([{ transform: 'translate(6px,-4px)' }, { transform: 'translate(-5px,3px)' }, { transform: 'none' }], { duration: 220, delay: 280 });
      const vo = r.failed ? 'vo-failed' : GRADE_VO[r.grade];
      if (vo) this.at(450, () => audio.play1(vo));
    });

    const fc = q('.res-fc');
    fc.style.opacity = '0';
    if (r.isFullCombo) {
      this.at(countStart + countMs + 1000, () => {
        fc.animate([{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'forwards' });
        audio.play1('milestone');
      });
    }
    if (newRecord) {
      const rec = q('.res-record');
      rec.style.opacity = '0';
      this.at(countStart + countMs + (r.isFullCombo ? 2400 : 1500), () => {
        rec.animate([{ transform: 'translateY(16px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, fill: 'forwards' });
        audio.play1('vo-new-record');
      });
    }
  }

  private drawHistogram(offsets: number[]): void {
    const { ctx, w, h } = fitCanvas(this.root.querySelector('.res-hist') as HTMLCanvasElement);
    const range = TIMING_WINDOWS.good;
    const binMs = 3;
    const bins = new Array<number>(Math.ceil((range * 2) / binMs)).fill(0);
    for (const o of offsets) {
      const i = Math.floor((Math.max(-range, Math.min(range - 0.001, o)) + range) / binMs);
      bins[i]!++;
    }
    const max = Math.max(1, ...bins);
    const x = (ms: number) => ((ms + range) / (range * 2)) * w;
    const bands: [number, string][] = [
      [TIMING_WINDOWS.good, THEME.judgment.good],
      [TIMING_WINDOWS.great, THEME.judgment.great],
      [TIMING_WINDOWS.perfect, THEME.judgment.perfect],
      [TIMING_WINDOWS.marvelous, THEME.judgment.marvelous],
    ];
    for (const [win, color] of bands) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.07;
      ctx.fillRect(x(-win), 0, x(win) - x(-win), h);
    }
    ctx.globalAlpha = 1;
    bins.forEach((c, i) => {
      const ms = i * binMs - range + binMs / 2;
      const abs = Math.abs(ms);
      const color = abs <= TIMING_WINDOWS.marvelous ? THEME.judgment.marvelous : abs <= TIMING_WINDOWS.perfect ? THEME.judgment.perfect : abs <= TIMING_WINDOWS.great ? THEME.judgment.great : THEME.judgment.good;
      const bh = (c / max) * (h - 18);
      ctx.fillStyle = color;
      ctx.fillRect(x(i * binMs - range) + 1, h - 14 - bh, (w / bins.length) - 2, bh);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(x(0) - 0.5, 0, 1, h - 14);
    ctx.font = '600 11px "Chakra Petch", system-ui, sans-serif';
    ctx.fillStyle = THEME.text.muted;
    ctx.textAlign = 'center';
    for (const ms of [-135, -90, -45, 0, 45, 90, 135]) ctx.fillText(`${ms > 0 ? '+' : ''}${ms}`, Math.min(w - 14, Math.max(14, x(ms))), h - 2);
    ctx.textAlign = 'left';
    ctx.fillText('EARLY', 6, 12);
    ctx.textAlign = 'right';
    ctx.fillText('LATE', w - 6, 12);
  }

  /** Run map: chart density, where each error happened, and the life line on the same time axis */
  private drawLife(r: ResultsData): void {
    const { ctx, w, h } = fitCanvas(this.root.querySelector('.res-life') as HTMLCanvasElement);
    const st = chartStats(r.chart);
    const span = Math.max(1, st.endMs - st.startMs);
    const x = (t: number) => Math.max(0, Math.min(w, ((t - st.startMs) / span) * w));

    const max = Math.max(8, ...st.density);
    ctx.beginPath();
    ctx.moveTo(0, h);
    st.density.forEach((d, i) => ctx.lineTo((i / Math.max(1, st.density.length - 1)) * w, h - (d / max) * (h - 4)));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(160, 140, 255, 0.16)';
    ctx.fill();

    const COLORS: Record<string, string> = { miss: THEME.judgment.miss, ng: THEME.judgment.miss, mine: THEME.mine, boo: THEME.judgment.boo, good: THEME.judgment.good };
    for (const e of r.errors) {
      const tall = e.kind === 'miss' || e.kind === 'ng' || e.kind === 'mine';
      ctx.fillStyle = COLORS[e.kind]!;
      ctx.globalAlpha = tall ? 0.95 : 0.6;
      ctx.fillRect(Math.round(x(e.time)) - 1, tall ? 0 : h * 0.4, 2, tall ? h : h * 0.6);
    }
    ctx.globalAlpha = 1;

    const pts = r.lifeHistory;
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const y = h - (p.life / 100) * (h - 4) - 2;
      if (i) ctx.lineTo(x(p.time), y);
      else ctx.moveTo(x(p.time), y);
    });
    ctx.strokeStyle = THEME.accent.success;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
