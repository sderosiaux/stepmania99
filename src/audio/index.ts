import { OutputClock } from './clock';

// ============================================================================
// Audio engine
//
// One AudioContext, three buses (music, sfx, voice) and one song timeline:
//   songMs(ctxTime) = (ctxTime - songStartCtx) * 1000
// The music source is started *on* that timeline, assist claps and announcer
// cues are scheduled on it too, so they are sample-aligned with the music.
// The game reads it through the output clock, i.e. as heard by the player.
// ============================================================================

export type SfxId =
  | 'ui-move' | 'ui-change' | 'ui-select' | 'ui-back' | 'ui-start'
  | 'assist-clap' | 'mine-explode' | 'combo-break' | 'milestone' | 'fail' | 'clear-fanfare'
  | 'grade-slam' | 'score-tick' | 'whoosh' | 'eliminated'
  | 'vo-ready' | 'vo-go' | 'vo-full-combo' | 'vo-perfect-full-combo' | 'vo-marvelous-full-combo'
  | 'vo-cleared' | 'vo-failed' | 'vo-new-record' | 'vo-combo-100' | 'vo-combo-200' | 'vo-combo-500'
  | 'vo-grade-aaaa' | 'vo-grade-aaa' | 'vo-grade-aa' | 'vo-grade-a' | 'vo-grade-b' | 'vo-grade-c' | 'vo-grade-d'
  | 'vo-welcome';

interface SfxManifest {
  assets: Record<string, { file: string; kind: 'sfx' | 'voice' | 'music'; bpm?: number; loopStartMs?: number; loopEndMs?: number; beatOffsetMs?: number }>;
}

/** Menu loop: title, song select (until a preview takes over) and results */
const MENU_MUSIC = 'music-menu';

const SCHEDULE_MARGIN_S = 0.03;
/** -40 dBFS: first sample louder than this is the attack */
const ONSET_THRESHOLD = 0.01;
/** Only codec padding is skipped; longer quiet intros (the ui-start riser) are content */
const MAX_PADDING_S = 0.03;

/** Leading silence to skip (≤ 30 ms), whatever the decoder did with MP3 encoder delay */
export function onsetSeconds(buffer: AudioBuffer): number {
  let first = buffer.length;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    const limit = Math.min(first, data.length);
    for (let i = 0; i < limit; i++) {
      if (Math.abs(data[i]!) > ONSET_THRESHOLD) {
        first = i;
        break;
      }
    }
  }
  return first === buffer.length ? 0 : Math.min(MAX_PADDING_S, first / buffer.sampleRate);
}
const BASE = import.meta.env.BASE_URL;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private clock: OutputClock | null = null;
  private buses: { master: GainNode; music: GainNode; duck: GainNode; sfx: GainNode; voice: GainNode } | null = null;

  private musicCache = new Map<string, Promise<AudioBuffer>>();
  private sfx = new Map<string, { buffer: AudioBuffer; kind: 'sfx' | 'voice'; onset: number }>();
  private menuTrack: { buffer: AudioBuffer; bpm: number; loopStart: number; loopEnd: number; beatOffset: number } | null = null;
  private menu: { source: AudioBufferSourceNode; gain: GainNode; startCtx: number } | null = null;
  private sfxLoading: Promise<void> | null = null;

  // Song timeline
  private song: AudioBuffer | null = null;
  private songSource: AudioBufferSourceNode | null = null;
  private songGain: GainNode | null = null;
  private songStartCtx = 0;
  /** Music rate: song ms advance `rate` times faster than real ms */
  private rate = 1;
  private pausedAtMs: number | null = null;
  private scheduled: AudioBufferSourceNode[] = [];

  // Preview
  private preview: { source: AudioBufferSourceNode; gain: GainNode; url: string; startCtx: number; start: number; end: number } | null = null;
  private previewToken = 0;

  /** Create/resume the context. Call from a user gesture at least once. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.clock = new OutputClock(this.ctx);
      const master = this.ctx.createGain();
      const music = this.ctx.createGain();
      const duck = this.ctx.createGain();
      const sfx = this.ctx.createGain();
      const voice = this.ctx.createGain();
      music.connect(duck).connect(master);
      sfx.connect(master);
      voice.connect(master);
      master.connect(this.ctx.destination);
      this.buses = { master, music, duck, sfx, voice };
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get context(): AudioContext {
    if (!this.ctx) throw new Error('AudioEngine not unlocked');
    return this.ctx;
  }

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  setVolumes(v: { music: number; sfx: number; voice: number }): void {
    if (!this.buses) return;
    this.buses.music.gain.value = v.music;
    this.buses.sfx.gain.value = v.sfx;
    this.buses.voice.gain.value = v.voice;
  }

  // --------------------------------------------------------------------------
  // Loading
  // --------------------------------------------------------------------------

  loadMusic(url: string): Promise<AudioBuffer> {
    let p = this.musicCache.get(url);
    if (!p) {
      p = (async () => {
        await this.unlock();
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
        return this.context.decodeAudioData(await res.arrayBuffer());
      })();
      p.catch(() => this.musicCache.delete(url));
      this.musicCache.set(url, p);
    }
    return p;
  }

  loadSfx(): Promise<void> {
    if (!this.sfxLoading) {
      this.sfxLoading = (async () => {
        await this.unlock();
        const res = await fetch(`${BASE}sfx/manifest.json`);
        if (!res.ok) {
          console.warn('No SFX manifest — playing without sound effects');
          return;
        }
        const manifest = (await res.json()) as SfxManifest;
        await Promise.all(
          Object.entries(manifest.assets).map(async ([id, a]) => {
            try {
              const r = await fetch(`${BASE}sfx/${a.file}`);
              const buffer = await this.context.decodeAudioData(await r.arrayBuffer());
              if (a.kind === 'music') {
                if (id === MENU_MUSIC) {
                  this.menuTrack = {
                    buffer,
                    bpm: a.bpm ?? 120,
                    loopStart: (a.loopStartMs ?? 0) / 1000,
                    loopEnd: (a.loopEndMs ?? buffer.duration * 1000) / 1000,
                    beatOffset: (a.beatOffsetMs ?? 0) / 1000,
                  };
                }
              } else {
                this.sfx.set(id, { buffer, kind: a.kind, onset: onsetSeconds(buffer) });
              }
            } catch (e) {
              console.warn(`SFX ${id} failed to load`, e);
            }
          })
        );
      })();
    }
    return this.sfxLoading;
  }

  // --------------------------------------------------------------------------
  // Song timeline
  // --------------------------------------------------------------------------

  /** Prepare a song (null = silent clock only) at a music rate (pitch follows the rate) */
  setSong(buffer: AudioBuffer | null, rate = 1): void {
    this.stopSong();
    this.song = buffer;
    this.rate = rate;
    this.pausedAtMs = null;
    this.clock?.reset();
  }

  /** Start the timeline so that song time `fromMs` is heard ~now. Negative = lead-in before the music. */
  play(fromMs: number, fadeInMs = 0): void {
    const ctx = this.context;
    this.stopSource();
    const when = ctx.currentTime + SCHEDULE_MARGIN_S;
    this.songStartCtx = when - fromMs / 1000 / this.rate;
    this.pausedAtMs = null;

    if (!this.song) return;
    const source = ctx.createBufferSource();
    source.buffer = this.song;
    source.playbackRate.value = this.rate;
    const gain = ctx.createGain();
    source.connect(gain).connect(this.buses!.music);
    if (fadeInMs > 0) {
      gain.gain.setValueAtTime(0, Math.max(when, this.songStartCtx));
      gain.gain.linearRampToValueAtTime(1, Math.max(when, this.songStartCtx) + fadeInMs / 1000);
    }
    if (fromMs >= 0) source.start(when, fromMs / 1000);
    else source.start(this.songStartCtx, 0);
    this.songSource = source;
    this.songGain = gain;
  }

  /** Arcade "power down": pitch and volume dive to zero. The timeline is meaningless afterwards. */
  tapeStop(seconds = 1.4): void {
    const ctx = this.ctx;
    if (!ctx || !this.songSource || !this.songGain) return;
    const now = ctx.currentTime;
    this.songSource.playbackRate.setValueAtTime(this.rate, now);
    this.songSource.playbackRate.exponentialRampToValueAtTime(0.05, now + seconds);
    this.songGain.gain.setValueAtTime(this.songGain.gain.value, now);
    this.songGain.gain.linearRampToValueAtTime(0, now + seconds);
  }

  /** Fade the music out (song end, quit) */
  fadeOut(seconds = 0.8): void {
    const ctx = this.ctx;
    if (!ctx || !this.songGain) return;
    const now = ctx.currentTime;
    this.songGain.gain.setValueAtTime(this.songGain.gain.value, now);
    this.songGain.gain.linearRampToValueAtTime(0, now + seconds);
  }

  pause(atMs: number): void {
    this.stopSource();
    this.pausedAtMs = atMs;
  }

  stopSong(): void {
    this.stopSource();
    this.pausedAtMs = null;
  }

  private stopSource(): void {
    for (const s of this.scheduled) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    this.scheduled = [];
    if (this.songSource) {
      try {
        this.songSource.stop();
      } catch {
        /* already stopped */
      }
      this.songSource.disconnect();
      this.songGain?.disconnect();
      this.songSource = null;
      this.songGain = null;
    }
  }

  /** Call once per frame before reading time */
  sync(): void {
    this.clock?.update();
  }

  /** Song time (ms, audio-file timeline) heard at `perfMs` */
  songTimeAt(perfMs: number): number {
    if (this.pausedAtMs !== null) return this.pausedAtMs;
    if (!this.clock) return 0;
    return (this.clock.ctxTimeAt(perfMs) - this.songStartCtx) * 1000 * this.rate;
  }

  /** Song time at the AudioContext's scheduling clock (ahead of what is heard) */
  scheduledSongTimeMs(): number {
    if (!this.ctx || this.pausedAtMs !== null) return this.pausedAtMs ?? 0;
    return (this.ctx.currentTime - this.songStartCtx) * 1000 * this.rate;
  }

  get songDurationMs(): number {
    return this.song ? this.song.duration * 1000 : 0;
  }

  /** Schedule a sample exactly at a song time (assist clap, announcer cue). Cancelled by pause/stop. */
  scheduleAt(id: SfxId, songMs: number, gain = 1): void {
    const ctx = this.ctx;
    const entry = this.sfx.get(id);
    if (!ctx || !entry || this.pausedAtMs !== null) return;
    const when = this.songStartCtx + songMs / 1000 / this.rate;
    if (when < ctx.currentTime) return;
    const src = this.makeSource(entry, gain);
    // Start at the measured attack: decoders disagree on MP3 encoder delay (~25 ms)
    src.start(when, entry.onset);
    this.scheduled.push(src);
    src.onended = () => {
      this.scheduled = this.scheduled.filter((s) => s !== src);
    };
  }

  // --------------------------------------------------------------------------
  // One-shots
  // --------------------------------------------------------------------------

  play1(id: SfxId, opts: { gain?: number; rate?: number; duck?: boolean } = {}): void {
    const ctx = this.ctx;
    const entry = this.sfx.get(id);
    if (!ctx || ctx.state !== 'running' || !entry) return;
    const src = this.makeSource(entry, opts.gain ?? 1);
    if (opts.rate) src.playbackRate.value = opts.rate;
    src.start(0, entry.onset);
    if (opts.duck) this.duck(entry.buffer.duration);
  }

  has(id: SfxId): boolean {
    return this.sfx.has(id);
  }

  private makeSource(entry: { buffer: AudioBuffer; kind: 'sfx' | 'voice'; onset: number }, gain: number): AudioBufferSourceNode {
    const ctx = this.context;
    const src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(entry.kind === 'voice' ? this.buses!.voice : this.buses!.sfx);
    return src;
  }

  /** Dip the music under an announcer line */
  private duck(seconds: number): void {
    const g = this.buses!.duck.gain;
    const now = this.context.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.55, now, 0.03);
    g.setTargetAtTime(1, now + seconds, 0.15);
  }

  // --------------------------------------------------------------------------
  // Song-select preview: looped excerpt with fades, independent from the song timeline
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Menu music: a seamless loop that yields to song previews and gameplay
  // --------------------------------------------------------------------------

  playMenuMusic(fadeInMs = 1200): void {
    const ctx = this.ctx;
    const track = this.menuTrack;
    if (!ctx || ctx.state !== 'running' || !track || this.menu || this.preview) return;
    const source = ctx.createBufferSource();
    source.buffer = track.buffer;
    source.loop = true;
    source.loopStart = track.loopStart;
    source.loopEnd = track.loopEnd;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.75, now + fadeInMs / 1000);
    source.connect(gain).connect(this.buses!.music);
    const startCtx = now + SCHEDULE_MARGIN_S;
    source.start(startCtx, track.loopStart);
    this.menu = { source, gain, startCtx };
  }

  stopMenuMusic(fadeMs = 400): void {
    const m = this.menu;
    if (!m || !this.ctx) return;
    this.menu = null;
    const now = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(now);
    m.gain.gain.setValueAtTime(m.gain.gain.value, now);
    m.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    m.source.stop(now + fadeMs / 1000 + 0.02);
  }

  /** Beat of the menu loop heard at `perfMs`, or null when it is not playing */
  menuBeatAt(perfMs: number): number | null {
    const m = this.menu;
    const t = this.menuTrack;
    if (!m || !t || !this.clock) return null;
    const elapsed = this.clock.ctxTimeAt(perfMs) - m.startCtx;
    if (elapsed < 0) return null;
    const pos = t.loopStart + (elapsed % (t.loopEnd - t.loopStart));
    return ((pos - t.beatOffset) * t.bpm) / 60;
  }

  async playPreview(url: string, startSec: number, lengthSec: number): Promise<void> {
    if (this.preview?.url === url) return;
    this.stopPreview();
    // After stopPreview(), which bumps the token itself: taking it before made every load look stale
    const token = ++this.previewToken;
    let buffer: AudioBuffer;
    try {
      buffer = await this.loadMusic(url);
    } catch {
      return;
    }
    if (token !== this.previewToken || !this.ctx) return;
    // Handover only once the preview can actually play: no silent gap while a long file decodes
    this.stopMenuMusic(500);
    const ctx = this.ctx;
    const start = Math.min(Math.max(0, startSec), Math.max(0, buffer.duration - 1));
    const end = Math.min(buffer.duration, start + Math.max(4, lengthSec));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = end;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.6);
    source.connect(gain).connect(this.buses!.music);
    const startCtx = ctx.currentTime + SCHEDULE_MARGIN_S;
    source.start(startCtx, start);
    this.preview = { source, gain, url, startCtx, start, end };
  }

  /** Position (ms, audio-file timeline) of the preview heard at `perfMs`, or null */
  previewTimeAt(perfMs: number): number | null {
    const p = this.preview;
    if (!p || !this.clock) return null;
    const elapsed = this.clock.ctxTimeAt(perfMs) - p.startCtx;
    if (elapsed < 0) return null;
    const loop = p.end - p.start;
    return (p.start + (elapsed % loop)) * 1000;
  }

  stopPreview(fadeMs = 250): void {
    this.previewToken++;
    const p = this.preview;
    if (!p || !this.ctx) return;
    this.preview = null;
    const now = this.ctx.currentTime;
    p.gain.gain.cancelScheduledValues(now);
    p.gain.gain.setValueAtTime(p.gain.gain.value, now);
    p.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    p.source.stop(now + fadeMs / 1000 + 0.02);
  }
}

export const audio = new AudioEngine();
