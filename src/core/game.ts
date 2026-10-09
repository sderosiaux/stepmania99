import type { Song, Chart, Note, Settings, ResultsData, Direction, DirectionStats, HitSample, ErrorMark } from '../types';
import { DIRECTIONS } from '../types';
import { audio, type SfxId } from '../audio';
import { input } from '../input';
import type { Stage } from '../render/stage';
import type { Hud } from '../render/hud';
import { THEME } from '../render/theme';
import { buildTimingData, type TimingData } from './timing-data';
import { JudgeEngine, autoplayInputs, type JudgeEvent, type SyntheticInput } from './judge';
import {
  createScoreState,
  applyEvent,
  chartTotals,
  calculateScore,
  calculatePercentage,
  calculateGrade,
  isFullCombo,
  fullComboTier,
  maxExScore,
  judgedFraction,
  lostPoints,
  referenceLoss,
  type ScoreState,
} from './score';
import { multiplayerGameManager } from '../multiplayer/game-manager';

// ============================================================================
// Game controller — one song (or one practice section), start to results.
//
// Time flow: performance.now() → output clock → song time (as heard) − user
// offset. Inputs are judged at their own timestamps through the same mapping,
// so frame rate never affects judgments. Song time runs `rate` times faster
// than real time; every real-time constant below is scaled by it.
// ============================================================================

/** Real ms of lead-in before the first note reaches the receptors */
const LEAD_IN_MS = 3200;
/** Misses are declared this late so an input event dispatched after a frame still gets its chance */
const INPUT_GRACE_MS = 25;
const RESUME_REWIND_MS = 2000;
const ASSIST_LOOKAHEAD_MS = 250;
const OUTRO_MS = 1200;
const PRACTICE_LEAD_MS = 2000;
const CURVE_SAMPLES = 100;

export interface GameOptions {
  autoplay: boolean;
  multiplayer: boolean;
  /** Loop a section of the chart (song ms), fail off, no record */
  practice?: { from: number; to: number };
  /** Pacemaker reference: personal-best loss curve, or null to pace against `paceTarget` */
  paceCurve?: number[] | null;
  paceTarget?: { label: string; percentage: number };
}

type Phase = 'playing' | 'paused' | 'outro' | 'done';

export class GameController {
  private song!: Song;
  private chart!: Chart;
  private opts!: GameOptions;
  private timing!: TimingData;
  private notes: readonly Note[] = [];
  private judge!: JudgeEngine;
  private score!: ScoreState;
  private rate = 1;
  private phase: Phase = 'done';
  private raf = 0;
  private lastPerf = 0;
  private lastSongTime = -Infinity;
  private startMs = 0;
  private endMs = 0;
  private pausedAt = 0;
  private loop = 1;

  private auto: SyntheticInput[] = [];
  private autoIdx = 0;
  private assistRows: number[] = [];
  private assistIdx = 0;
  private jumpRows = new Set<number>();
  private cues: { at: number; run: () => void }[] = [];
  private offsets: number[] = [];
  private hits: HitSample[] = [];
  private errors: ErrorMark[] = [];
  private lossCurve: number[] = [];
  private lifeHistory: { time: number; life: number }[] = [];
  private dirStats: Record<Direction, number[]> = { left: [], down: [], up: [], right: [] };
  private outroAt = 0;
  private failed = false;
  /** stop() ran — start() must not resume after its awaits */
  private stopped = false;

  onFinish: ((results: ResultsData) => void) | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly hud: Hud,
    private settings: Settings
  ) {}

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start(song: Song, chart: Chart, opts: GameOptions): Promise<void> {
    this.song = song;
    this.chart = chart;
    this.opts = opts;
    // Battles are always 1.0x
    this.rate = opts.multiplayer ? 1 : this.settings.rate;
    this.timing = buildTimingData(chart.timing);
    const p = opts.practice;
    this.notes = p ? chart.notes.filter((n) => n.time >= p.from && n.time <= p.to) : chart.notes;
    this.jumpRows = rowsWithJumps(this.notes);
    this.loop = 1;
    this.failed = false;

    await audio.unlock();
    if (this.stopped) return;
    audio.stopPreview(150);
    audio.setVolumes({ music: this.settings.musicVolume, sfx: this.settings.sfxVolume, voice: this.settings.voiceVolume });
    void audio.loadSfx();

    let buffer: AudioBuffer | null = null;
    if (!song.silent) {
      try {
        buffer = await audio.loadMusic(`${song.basePath}/${song.musicFile}`);
      } catch (e) {
        console.warn('Music unavailable, playing on a silent clock', e);
      }
      if (this.stopped) return;
    }
    audio.setSong(buffer, this.rate);

    const first = this.notes[0]?.time ?? 0;
    const last = this.lastNoteEnd();
    this.startMs = p ? first - PRACTICE_LEAD_MS * this.rate : Math.min(-1500 * this.rate, first - LEAD_IN_MS * this.rate);
    this.endMs = p ? last + 600 * this.rate : Math.max(last + OUTRO_MS * this.rate, buffer ? Math.min(audio.songDurationMs, last + 6000) : 0);

    this.auto = opts.autoplay ? autoplayInputs(this.notes) : [];
    this.assistRows = [...new Set(this.notes.filter((n) => n.type !== 'mine').map((n) => n.time))].sort((a, b) => a - b);
    this.resetRun();

    // Visuals
    this.stage.setPerspective(this.settings.perspective);
    this.stage.setFocus(this.settings.focus);
    this.hud.setFocus(this.settings.focus);
    this.stage.background.setImage(song.background && song.basePath ? `${song.basePath}/${song.background}` : null);
    const badge = [p ? 'PRACTICE' : opts.autoplay ? 'AUTOPLAY' : '', this.rate !== 1 ? `${this.rate}×` : ''].filter(Boolean).join(' · ');
    this.hud.show(song, chart, badge);
    const [l, r] = this.stage.laneScreenSpan();
    this.hud.layout(this.stage.receptorScreenY(), [l, r], this.settings.perspective === 'tilted');

    // Announcer cues on the song timeline
    const goAt = Math.max(this.startMs + 1300 * this.rate, first - 1500 * this.rate);
    this.cues = p
      ? [{ at: this.startMs + 200 * this.rate, run: () => this.hud.message(`LOOP ${this.loop}`, 'ready', 900) }]
      : [
          { at: this.startMs + 250 * this.rate, run: () => this.hud.message('READY?', 'ready', 1100) },
          { at: goAt, run: () => this.hud.message('GO!', 'go', 800) },
        ];
    if (!p) {
      audio.loadSfx().then(() => {
        if (this.phase !== 'playing') return;
        audio.scheduleAt('vo-ready', this.startMs + 250 * this.rate);
        audio.scheduleAt('vo-go', goAt);
      });
    }

    if (opts.multiplayer) {
      multiplayerGameManager.setOnAttackReceived((a) => this.injectAttack(a.note));
      multiplayerGameManager.setOnOpponentEliminated((playerId) => {
        if (this.phase !== 'playing') return;
        const name = multiplayerGameManager.getOpponents().find((o) => o.id === playerId)?.name ?? 'RIVAL';
        audio.play1('eliminated', { gain: 0.8 });
        this.hud.message(`${name.toUpperCase()} OUT`, 'hint', 1400);
      });
    }

    input.start();
    this.phase = 'playing';
    this.lastSongTime = -Infinity;
    audio.play(this.startMs);
    this.lastPerf = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Fresh judge and score for a run (or a practice loop) */
  private resetRun(): void {
    this.judge = new JudgeEngine(this.notes, this.rate);
    const totals = chartTotals({ notes: this.notes });
    this.score = createScoreState(totals.steps, totals.freezes);
    this.autoIdx = 0;
    this.assistIdx = 0;
    this.offsets = [];
    this.hits = [];
    this.errors = [];
    this.lossCurve = [0];
    this.lifeHistory = [{ time: this.notes[0]?.time ?? 0, life: this.score.life }];
    this.dirStats = { left: [], down: [], up: [], right: [] };
  }

  /**
   * A rival's arrow: moved to a lane with no note within ±250 ms (an overlap would turn into a forced miss),
   * dropped if every lane is busy. It counts in the totals like a chart note.
   */
  private injectAttack(attack: Note): void {
    if (this.phase !== 'playing') return;
    const gap = 250 * this.rate;
    const busy = (lane: number) => this.judge.getNotes().some((n) => n.lane === lane && Math.abs(n.time - attack.time) < gap);
    const lane = [attack.lane, 0, 1, 2, 3].find((l) => !busy(l));
    if (lane === undefined) return;
    const note: Note = { ...attack, lane, direction: DIRECTIONS[lane]! };
    this.judge.addNote(note);
    this.score = { ...this.score, totalSteps: this.score.totalSteps + 1 };
    this.endMs = Math.max(this.endMs, note.time + OUTRO_MS * this.rate);
  }

  stop(): void {
    this.stopped = true;
    this.phase = 'done';
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    audio.stopSong();
    input.stop();
    this.hud.showPause(false, false);
    this.hud.hide();
    // Menus keep their effects; focus is a gameplay mode
    this.stage.setFocus(false);
    this.hud.setFocus(false);
    multiplayerGameManager.setOnAttackReceived(() => {});
    multiplayerGameManager.setOnOpponentEliminated(() => {});
  }

  setSettings(s: Settings): void {
    // The rate is fixed for the run: the audio timeline was built with it
    this.settings = { ...s, rate: this.settings.rate };
    if (this.phase !== 'done') {
      this.stage.setFocus(s.focus);
      this.hud.setFocus(s.focus);
    }
  }

  get isPaused(): boolean {
    return this.phase === 'paused';
  }

  get isPlaying(): boolean {
    return this.phase === 'playing';
  }

  get canPause(): boolean {
    return this.phase === 'playing' && !this.opts.multiplayer;
  }

  get isPractice(): boolean {
    return !!this.opts.practice;
  }

  /** User offset in song ms */
  private get offset(): number {
    return this.settings.offsetMs * this.rate;
  }

  pause(): void {
    if (!this.canPause) return;
    const now = performance.now();
    const raw = audio.songTimeAt(now);
    this.pausedAt = raw;
    // Lanes are released at the pause instant: holds drain from there if not re-pressed after resume
    input.releaseAll(now);
    this.processInputs(raw - this.offset);
    // Those releases may have finished the run (fail): never pause over it
    if (this.phase !== 'playing') return;
    audio.pause(raw);
    this.phase = 'paused';
    this.hud.showPause(true, false);
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    input.drain();
    this.hud.showPause(false, false);
    this.phase = 'playing';
    const from = this.pausedAt - RESUME_REWIND_MS * this.rate;
    this.assistIdx = this.assistRows.findIndex((t) => t >= from);
    if (this.assistIdx < 0) this.assistIdx = this.assistRows.length;
    audio.play(from, 400);
  }

  private onVisibility = () => {
    if (document.hidden && this.canPause) this.pause();
  };

  // --------------------------------------------------------------------------
  // Frame
  // --------------------------------------------------------------------------

  private frame = () => {
    if (this.phase === 'done') return;
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastPerf) / 1000));
    this.lastPerf = now;

    audio.sync();
    input.pollGamepads();
    const songNow = audio.songTimeAt(now) - this.offset;

    if (this.phase === 'playing') {
      this.processInputs(songNow);
      if (this.opts.autoplay) {
        while (this.autoIdx < this.auto.length && this.auto[this.autoIdx]!.time <= songNow) {
          const a = this.auto[this.autoIdx++]!;
          if (a.pressed) this.stage.playfield.press(a.lane);
          this.handle(a.pressed ? this.judge.press(a.lane, a.time) : this.judge.release(a.lane, a.time));
        }
      }
      this.handle(this.judge.advance(songNow - INPUT_GRACE_MS * this.rate));
      this.runCues(songNow);
      this.scheduleAssist();
      if (this.opts.multiplayer) {
        multiplayerGameManager.update(this.score.life, this.score.combo, calculateScore(this.score), songNow);
      }
      if (this.opts.practice) this.checkLoop(songNow);
      else this.checkEnd(songNow);
    } else if (this.phase === 'outro') {
      input.drain();
      if (now >= this.outroAt) this.finish();
    } else {
      input.drain();
    }

    this.render(songNow, now / 1000, dt);
  };

  private processInputs(songNow: number): void {
    for (const ev of input.drain()) {
      const t = Math.min(songNow, audio.songTimeAt(ev.timestamp) - this.offset);
      if (this.opts.autoplay) continue;
      if (ev.pressed) {
        this.stage.playfield.press(ev.lane);
        this.handle(this.judge.press(ev.lane, t));
      } else {
        this.handle(this.judge.release(ev.lane, t));
      }
    }
  }

  private handle(events: JudgeEvent[]): void {
    const canFail = !this.opts.autoplay && !this.opts.practice;
    for (const e of events) {
      const prev = this.score;
      this.score = applyEvent(this.score, e, canFail);
      this.lifeHistory.push({ time: e.time, life: this.score.life });
      this.sampleCurve();
      const lane = e.note.lane;

      if (e.kind === 'tap') {
        if (e.grade !== 'miss') {
          this.offsets.push(e.offset);
          this.hits.push({ offset: e.offset, quant: e.note.quant, jump: this.jumpRows.has(e.note.time), lane });
          this.dirStats[DIRECTIONS[lane]!].push(e.offset);
          this.stage.playfield.hit(lane, e.grade);
          if (e.grade === 'marvelous' || e.grade === 'perfect') this.stage.background.hit(THEME.lane[lane]!, 0.12);
        }
        if (e.grade === 'miss' || e.grade === 'boo' || e.grade === 'good') this.errors.push({ time: e.note.time, kind: e.grade });
        this.hud.judgment(e.grade, e.offset, this.score.combo, this.settings.showHitMs);
      } else if (e.kind === 'hold') {
        if (e.grade === 'ng') this.errors.push({ time: e.time, kind: 'ng' });
        this.stage.playfield.holdDone(lane, e.grade === 'ok');
        this.hud.holdResult(e.grade);
        this.hud.combo(this.score.combo);
      } else {
        this.errors.push({ time: e.note.time, kind: 'mine' });
        this.stage.playfield.mine(lane);
        this.stage.shake(0.35);
        this.stage.background.hit(THEME.mine, 1.2);
        audio.play1('mine-explode');
        this.hud.combo(this.score.combo);
      }

      if (prev.combo >= 20 && this.score.combo === 0) {
        audio.play1('combo-break', { gain: 0.7 });
        this.hud.comboBreak();
      }
      this.milestone(prev.combo, this.score.combo);

      if (this.score.failed && !this.failed) {
        this.fail();
        return;
      }
    }
  }

  /** Points lost at each 1% of the chart judged — the next run's pacemaker */
  private sampleCurve(): void {
    const upTo = Math.floor(judgedFraction(this.score) * CURVE_SAMPLES);
    while (this.lossCurve.length <= upTo) this.lossCurve.push(Math.round(lostPoints(this.score)));
  }

  private milestone(prev: number, combo: number): void {
    if (combo <= prev || Math.floor(combo / 100) === Math.floor(prev / 100)) return;
    const VOICE: Record<number, SfxId> = { 100: 'vo-combo-100', 200: 'vo-combo-200', 500: 'vo-combo-500' };
    const hundred = Math.floor(combo / 100) * 100;
    audio.play1('milestone', { gain: 0.6 });
    const vo = VOICE[hundred];
    if (vo) audio.play1(vo, { duck: true });
    this.stage.playfield.fireworks(THEME.accent.gold, 120);
    this.stage.background.hit(THEME.accent.gold, 1.2);
  }

  private runCues(songNow: number): void {
    while (this.cues.length && this.cues[0]!.at <= songNow) this.cues.shift()!.run();
  }

  private scheduleAssist(): void {
    if (!this.settings.assistTick) return;
    // Horizon from the audio clock itself: scheduleAt drops anything before ctx.currentTime,
    // which is ahead of the heard time by the output latency (huge on Bluetooth)
    const until = audio.scheduledSongTimeMs() + ASSIST_LOOKAHEAD_MS * this.rate;
    while (this.assistIdx < this.assistRows.length && this.assistRows[this.assistIdx]! <= until) {
      audio.scheduleAt('assist-clap', this.assistRows[this.assistIdx++]!, 0.8);
    }
  }

  /** Practice: when the section is over, report it and replay it */
  private checkLoop(songNow: number): void {
    if (songNow < this.endMs) return;
    const pct = calculatePercentage(this.score);
    const marv = this.hits.length ? (this.hits.filter((h) => Math.abs(h.offset) <= 22.5).length / Math.max(1, this.score.totalSteps)) * 100 : 0;
    this.hud.message(`${pct.toFixed(1)}% · ${marv.toFixed(0)}% MARV`, fullComboTier(this.score) ? 'fc-great' : 'hint', 1800);
    if (fullComboTier(this.score)) audio.play1('milestone', { gain: 0.6 });
    this.loop++;
    this.resetRun();
    this.cues = [{ at: this.startMs + 200 * this.rate, run: () => this.hud.message(`LOOP ${this.loop}`, 'ready', 900) }];
    audio.play(this.startMs);
  }

  private checkEnd(songNow: number): void {
    const done = this.judge.isComplete() && songNow >= this.lastNoteEnd() + 600 * this.rate;
    if (!done && songNow < this.endMs) return;
    this.phase = 'outro';
    const tier = fullComboTier(this.score);
    if (tier) {
      const [label, vo]: [string, SfxId] =
        tier === 'marvelous'
          ? ['MARVELOUS FULL COMBO', 'vo-marvelous-full-combo']
          : tier === 'perfect'
            ? ['PERFECT FULL COMBO', 'vo-perfect-full-combo']
            : ['FULL COMBO', 'vo-full-combo'];
      this.hud.message(label, `fc-${tier}`, 2600);
      audio.play1('clear-fanfare', { gain: 0.8 });
      audio.play1(vo, { duck: true });
      this.stage.playfield.fireworks(tier === 'marvelous' ? '#e8fbff' : tier === 'perfect' ? THEME.accent.gold : THEME.accent.success, 400);
    } else {
      this.hud.message('CLEARED', 'cleared', 2200);
      audio.play1('clear-fanfare', { gain: 0.8 });
      audio.play1('vo-cleared', { duck: true });
    }
    audio.fadeOut(2.2);
    this.outroAt = performance.now() + 2800;
  }

  private lastNoteEnd(): number {
    return (this.judge?.getNotes() ?? this.notes).reduce((m, n) => Math.max(m, n.endTime ?? n.time), 0);
  }

  private fail(): void {
    this.failed = true;
    this.phase = 'outro';
    audio.tapeStop(1.6);
    audio.play1('fail');
    audio.play1('vo-failed', { duck: false });
    this.hud.message('FAILED', 'failed', 2600);
    this.stage.shake(0.6);
    this.stage.background.hit(THEME.accent.danger, 1.5);
    if (this.opts.multiplayer) multiplayerGameManager.notifyDeath();
    this.outroAt = performance.now() + 3000;
  }

  private finish(): void {
    const results = this.results();
    if (this.opts.multiplayer && !this.failed) multiplayerGameManager.notifyGameFinished(results.score);
    this.stop();
    this.onFinish?.(results);
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  private render(songNow: number, time: number, dt: number): void {
    const frozen = this.phase === 'paused' ? this.lastSongTime : songNow;
    this.lastSongTime = frozen;
    const beat = this.timing.timeToBeat(frozen);
    const { width, height } = this.stage.size;
    this.stage.background.update({
      width,
      height,
      time,
      beat,
      energy: Math.min(1, this.score.combo / 150),
      danger: this.score.life < 25 && this.phase !== 'done' && !this.opts.practice ? 1 - this.score.life / 25 : 0,
      dt,
    });
    this.stage.playfield.update({
      songTime: frozen,
      beat,
      time,
      dt,
      cmod: this.settings.cmod,
      rate: this.rate,
      notes: this.judge.getNotes(),
      runtime: (n: Note) => this.judge.get(n),
      held: [0, 1, 2, 3].map((l) => this.judge.isHeld(l)),
      combo: this.score.combo,
    });
    const first = this.notes[0]?.time ?? 0;
    const last = this.lastNoteEnd();
    const pace =
      this.opts.paceTarget && !this.opts.practice && judgedFraction(this.score) > 0
        ? {
            label: this.opts.paceTarget.label,
            delta: Math.round(referenceLoss(this.opts.paceCurve ?? null, this.opts.paceTarget.percentage, judgedFraction(this.score)) - lostPoints(this.score)),
          }
        : null;
    this.hud.update({
      life: this.score.life,
      score: calculateScore(this.score),
      percentage: calculatePercentage(this.score),
      combo: this.score.combo,
      progress: (frozen - first) / Math.max(1, last - first),
      elapsedMs: Math.max(0, frozen),
      totalMs: last,
      bpm: this.timing.bpmAt(beat) * this.rate,
      counts: this.score.counts,
      holds: this.score.holds,
      opponents: this.opts.multiplayer ? multiplayerGameManager.getOpponents() : [],
      pace,
    });
    this.stage.render(dt);
  }

  private results(): ResultsData {
    const s = this.score;
    const directionStats = Object.fromEntries(
      DIRECTIONS.map((d) => {
        const t = this.dirStats[d];
        const stats: DirectionStats = { count: t.length, avgTiming: t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0, timings: t };
        return [d, stats];
      })
    ) as Record<Direction, DirectionStats>;
    while (this.lossCurve.length <= CURVE_SAMPLES) this.lossCurve.push(Math.round(lostPoints(s)));
    return {
      song: this.song,
      chart: this.chart,
      score: calculateScore(s),
      exScore: s.exScore,
      maxExScore: maxExScore(s),
      grade: calculateGrade(s),
      maxCombo: s.maxCombo,
      judgmentCounts: { ...s.counts },
      holdCounts: { ...s.holds },
      minesHit: s.minesHit,
      totalNotes: s.totalSteps,
      percentage: calculatePercentage(s),
      failed: s.failed,
      isFullCombo: isFullCombo(s),
      offsets: this.offsets,
      hits: this.hits,
      errors: this.errors,
      lossCurve: this.lossCurve,
      rate: this.rate,
      lifeHistory: this.lifeHistory,
      directionStats,
      autoplay: this.opts.autoplay,
    };
  }
}

/** Row times holding 2+ playable notes (jumps, hands, quads) */
function rowsWithJumps(notes: readonly Note[]): Set<number> {
  const count = new Map<number, number>();
  for (const n of notes) if (n.type !== 'mine') count.set(n.time, (count.get(n.time) ?? 0) + 1);
  return new Set([...count].filter(([, c]) => c >= 2).map(([t]) => t));
}
