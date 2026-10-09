import { audio } from '../audio';
import { KEY_TO_DIRECTION } from '../types';

// ============================================================================
// Offset calibration: tap along to a metronome scheduled on the audio clock.
// Audio-only on purpose — a pulsing visual would mix display latency into
// the measurement. Taps are timestamped by the event, mapped through the same
// output clock as gameplay, so the result is exactly the offset the judge needs.
// ============================================================================

const BPM = 100;
const BEAT_MS = 60000 / BPM;
const WARMUP_BEATS = 4;
const TARGET_TAPS = 24;
const MAX_DEVIATION_MS = 160;

export interface CalibrationCallbacks {
  onDone: (offsetMs: number | null) => void;
}

export function robustOffset(deviations: number[]): { offset: number; spread: number } | null {
  if (deviations.length < 8) return null;
  const sorted = [...deviations].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
  const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
  const iqr = q3 - q1;
  const kept = sorted.filter((d) => d >= q1 - 1.5 * iqr && d <= q3 + 1.5 * iqr);
  const median = kept[Math.floor(kept.length / 2)]!;
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  const spread = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / kept.length);
  return { offset: Math.round(median), spread };
}

export class CalibrationScreen {
  private readonly root: HTMLElement;
  private deviations: number[] = [];
  private raf = 0;
  private scheduledBeats = 0;
  private visible = false;
  private result: { offset: number; spread: number } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly cb: CalibrationCallbacks
  ) {
    this.root = document.createElement('div');
    this.root.className = 'calib hidden';
    parent.appendChild(this.root);
  }

  async show(currentOffset: number): Promise<void> {
    this.visible = true;
    this.deviations = [];
    this.result = null;
    this.scheduledBeats = 0;
    this.root.innerHTML = `
      <div class="calib-card glass">
        <h2>Offset calibration</h2>
        <p class="calib-lead">Close your eyes. Tap any arrow key, <kbd>D</kbd><kbd>F</kbd><kbd>J</kbd><kbd>K</kbd> or <kbd>Space</kbd> exactly on each clap.</p>
        <div class="calib-scale"><span>EARLY</span><div class="calib-track"><i class="calib-zero"></i></div><span>LATE</span></div>
        <div class="calib-progress"><div class="calib-progress-fill"></div></div>
        <div class="calib-readout">Current offset <b>${currentOffset > 0 ? '+' : ''}${currentOffset} ms</b> · listening…</div>
        <div class="calib-actions">
          <button class="btn" data-act="cancel"><kbd>Esc</kbd> Cancel</button>
          <button class="btn" data-act="restart"><kbd>R</kbd> Restart</button>
          <button class="btn btn-primary" data-act="apply" disabled><kbd>Enter</kbd> Apply</button>
        </div>
      </div>`;
    this.root.classList.remove('hidden');
    this.root.querySelector('[data-act="cancel"]')!.addEventListener('click', () => this.close(null));
    this.root.querySelector('[data-act="restart"]')!.addEventListener('click', () => this.restart());
    this.root.querySelector('[data-act="apply"]')!.addEventListener('click', () => this.result && this.close(this.result.offset));
    window.addEventListener('keydown', this.onKey);

    await audio.unlock();
    await audio.loadSfx();
    audio.stopPreview();
    this.restart();
  }

  private restart(): void {
    this.deviations = [];
    this.result = null;
    this.root.querySelectorAll('.calib-tap').forEach((t) => t.remove());
    this.updateReadout();
    audio.setSong(null);
    audio.play(-1200);
    this.scheduledBeats = 0;
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.visible) return;
      audio.sync();
      // Keep ~1 s of claps scheduled ahead on the audio clock
      const now = audio.songTimeAt(performance.now());
      while (this.scheduledBeats * BEAT_MS < now + 1000) {
        audio.scheduleAt('assist-clap', this.scheduledBeats * BEAT_MS, 1);
        this.scheduledBeats++;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.visible) return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') return this.close(null);
    if (e.code === 'Enter') return this.result && this.close(this.result.offset);
    if (e.code === 'KeyR') return this.restart();
    if (!KEY_TO_DIRECTION[e.code] && e.code !== 'Space') return;
    if (this.deviations.length >= TARGET_TAPS) return; // done: Enter applies, R starts over
    const t = audio.songTimeAt(e.timeStamp);
    const beat = Math.round(t / BEAT_MS);
    if (beat < WARMUP_BEATS) return;
    const dev = t - beat * BEAT_MS;
    if (Math.abs(dev) > MAX_DEVIATION_MS) return;
    this.deviations.push(dev);
    this.plotTap(dev);
    this.result = robustOffset(this.deviations.slice(-TARGET_TAPS));
    if (this.deviations.length >= TARGET_TAPS) this.finish();
    else this.updateReadout();
  };

  /** Enough taps: stop the metronome once, chime once, wait for Apply or Restart */
  private finish(): void {
    cancelAnimationFrame(this.raf);
    audio.stopSong();
    audio.play1('ui-select');
    this.updateReadout();
  }

  private plotTap(dev: number): void {
    const track = this.root.querySelector('.calib-track') as HTMLElement;
    const dot = document.createElement('i');
    dot.className = 'calib-tap';
    dot.style.left = `${50 + (dev / MAX_DEVIATION_MS) * 50}%`;
    track.appendChild(dot);
    dot.animate([{ transform: 'translate(-50%,-50%) scale(2.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0.85 }], { duration: 300, fill: 'forwards' });
    const taps = track.querySelectorAll('.calib-tap');
    if (taps.length > TARGET_TAPS) taps[0]!.remove();
  }

  private updateReadout(): void {
    const n = Math.min(this.deviations.length, TARGET_TAPS);
    (this.root.querySelector('.calib-progress-fill') as HTMLElement).style.transform = `scaleX(${n / TARGET_TAPS})`;
    const readout = this.root.querySelector('.calib-readout') as HTMLElement;
    const apply = this.root.querySelector('[data-act="apply"]') as HTMLButtonElement;
    if (!this.result) {
      readout.innerHTML = n === 0 ? 'Listening… the first 4 claps are a warm-up.' : `${n} taps · keep going`;
      apply.disabled = true;
      return;
    }
    const { offset, spread } = this.result;
    const quality = spread < 12 ? 'very consistent' : spread < 25 ? 'consistent' : 'noisy — try a few more';
    const done = this.deviations.length >= TARGET_TAPS;
    readout.innerHTML = `Measured offset <b>${offset > 0 ? '+' : ''}${offset} ms</b> · spread ${spread.toFixed(0)} ms (${quality})${done ? ' · <kbd>Enter</kbd> to apply, <kbd>R</kbd> to try again' : ''}`;
    apply.disabled = n < TARGET_TAPS / 2;
  }

  private close(offset: number | null): void {
    this.visible = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    audio.stopSong();
    this.root.classList.add('hidden');
    audio.play1(offset === null ? 'ui-back' : 'ui-select');
    this.cb.onDone(offset);
  }
}
