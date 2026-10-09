// ============================================================================
// Output clock: maps performance.now() to the AudioContext timeline *as heard*.
//
// AudioContext.currentTime is quantized (render quanta, 3–10 ms steps, worse on
// Safari) and is ahead of the speakers by the output latency. getOutputTimestamp()
// gives a (contextTime, performanceTime) pair for the sample leaving the device,
// so ctx = perf + k. We low-pass k to remove jitter while still tracking the
// slow drift between the audio and system crystals, and snap on large jumps
// (device change, resume after suspend).
// ============================================================================

const SNAP_THRESHOLD_MS = 25;
const SMOOTHING = 0.04;

export class OutputClock {
  /** ctxMs - perfMs */
  private k: number | null = null;

  constructor(private readonly ctx: AudioContext) {}

  private sample(): { ctxMs: number; perfMs: number } {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0 && ts.contextTime > 0) {
      return { ctxMs: ts.contextTime * 1000, perfMs: ts.performanceTime };
    }
    // Fallback: currentTime minus what we know about the pipeline latency
    const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return { ctxMs: (this.ctx.currentTime - latency) * 1000, perfMs: performance.now() };
  }

  /** Call once per frame */
  update(): void {
    if (this.ctx.state !== 'running') return;
    const { ctxMs, perfMs } = this.sample();
    const raw = ctxMs - perfMs;
    if (this.k === null || Math.abs(raw - this.k) > SNAP_THRESHOLD_MS) this.k = raw;
    else this.k += (raw - this.k) * SMOOTHING;
  }

  /** AudioContext seconds being heard at `perfMs` */
  ctxTimeAt(perfMs: number): number {
    if (this.k === null) this.update();
    return (perfMs + (this.k ?? this.ctx.currentTime * 1000 - performance.now())) / 1000;
  }

  reset(): void {
    this.k = null;
  }
}
