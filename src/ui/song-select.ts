import type { Song, Chart, Settings, Difficulty } from '../types';
import { CMOD_OPTIONS, RATE_OPTIONS } from '../types';
import type { HostNavigationState } from '../types/multiplayer';
import type { SongEntry, ChartMeta } from '../core/manifest';
import { loadSong, songDir } from '../core/loader';
import { audio } from '../audio';
import { multiplayerClient, type MultiplayerEvent } from '../multiplayer';
import { chartStats, type ChartStats } from './chart-stats';
import { getBest, getLastRunErrors } from './storage';
import { escapeHtml, assetUrl, fitCanvas } from './dom';
import { THEME } from '../render/theme';
import { openMultiplayerModal, roomBarHtml, bindRoomBar } from './multiplayer-ui';

// ============================================================================
// Song select: music wheel (left), song + chart detail (right), options bar.
// Works from manifest entries; the simfile is loaded when a song is focused.
// Keyboard-first; every action is also clickable.
// ============================================================================

export interface PracticeRange {
  from: number;
  to: number;
}

export interface SongSelectCallbacks {
  onPlay: (entry: SongEntry, difficulty: Difficulty, autoplay: boolean, practice?: PracticeRange) => void;
  onCalibrate: () => void;
  onSettings: (s: Settings) => void;
}

const DIFFS: Difficulty[] = ['Beginner', 'Easy', 'Medium', 'Hard', 'Challenge'];
const WHEEL_SPAN = 6;
const PREVIEW_DELAY_MS = 220;
const ERROR_COLORS: Record<string, string> = {
  miss: THEME.judgment.miss,
  boo: THEME.judgment.boo,
  good: THEME.judgment.good,
  ng: '#ff8a3d',
  mine: THEME.mine,
};

type OptionKind = 'speed' | 'offset' | 'perspective' | 'assist' | 'rate' | 'hitms' | 'focus';

export class SongSelectScreen {
  private readonly root: HTMLElement;
  private all: SongEntry[] = [];
  private list: SongEntry[] = [];
  private query = '';
  private index = 0;
  private diff: Difficulty = 'Medium';
  private wheelItems = new Map<string, HTMLElement>();
  private previewTimer = 0;
  private visible = false;
  /** Section to loop, per song+difficulty */
  private practice = new Map<string, PracticeRange>();
  /** Loaded simfile + stats for the focused chart (null while loading) */
  private loaded: { key: string; song: Song; chart: Chart; stats: ChartStats } | null = null;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private readonly cb: SongSelectCallbacks
  ) {
    this.root = document.createElement('div');
    this.root.className = 'select hidden';
    this.root.innerHTML = `
      <header class="select-top">
        <div class="logo" aria-label="Stepmania 99"><span>STEPMANIA</span><b>99</b></div>
        <label class="search"><kbd>/</kbd><input type="search" placeholder="Search songs, artists, packs" aria-label="Search songs" /><span class="search-count"></span></label>
        <div class="select-room"></div>
        <button class="btn btn-ghost" data-act="mp"><kbd>M</kbd> Multiplayer</button>
      </header>
      <section class="wheel" aria-label="Songs"><div class="wheel-track"></div><div class="wheel-focus"></div></section>
      <section class="detail"></section>
      <footer class="options glass"></footer>
      <div class="select-empty hidden">
        <h2>No songs yet</h2>
        <p>Drop StepMania song folders (<code>.sm</code> or <code>.ssc</code> + audio) into <code>public/songs/&lt;Pack&gt;/&lt;Song&gt;/</code>, then run <code>npm run scan-songs</code>.</p>
      </div>`;
    parent.appendChild(this.root);
    this.root.querySelector('[data-act="mp"]')!.addEventListener('click', () => this.openMultiplayer());
    this.root.querySelector('.wheel')!.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.move(Math.sign((e as WheelEvent).deltaY));
      },
      { passive: false }
    );
    const search = this.searchInput;
    search.addEventListener('input', () => this.applySearch(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        search.value = '';
        this.applySearch('');
        search.blur();
      } else if (e.code === 'Enter' || e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        search.blur();
      }
      e.stopPropagation();
    });
    multiplayerClient.addEventListener(this.onMultiplayer);
  }

  private get searchInput(): HTMLInputElement {
    return this.root.querySelector('.search input') as HTMLInputElement;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  show(entries: SongEntry[], settings: Settings): void {
    this.settings = settings;
    if (entries !== this.all) {
      this.all = [...entries].sort((a, b) => a.pack.localeCompare(b.pack) || a.title.localeCompare(b.title));
      this.applySearch(this.query, false);
    }
    this.visible = true;
    this.root.classList.remove('hidden');
    this.root.querySelector('.select-empty')!.classList.toggle('hidden', this.all.length > 0);
    window.addEventListener('keydown', this.onKey);
    this.renderAll();
    this.queuePreview();
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add('hidden');
    window.removeEventListener('keydown', this.onKey);
    clearTimeout(this.previewTimer);
  }

  get current(): { entry: SongEntry; meta: ChartMeta } | null {
    const entry = this.list[this.index];
    if (!entry) return null;
    return { entry, meta: this.chartFor(entry) };
  }

  private chartFor(entry: SongEntry): ChartMeta {
    // Closest available difficulty to the one the player is browsing with
    const want = DIFFS.indexOf(this.diff);
    return [...entry.charts].sort((a, b) => Math.abs(DIFFS.indexOf(a.difficulty) - want) - Math.abs(DIFFS.indexOf(b.difficulty) - want))[0]!;
  }

  private get isGuest(): boolean {
    return multiplayerClient.getRoom() !== null && !multiplayerClient.isHost();
  }

  private applySearch(q: string, render = true): void {
    const keepId = this.list[this.index]?.id;
    this.query = q;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    this.list = terms.length
      ? this.all.filter((e) => {
          const hay = `${e.title} ${e.subtitle ?? ''} ${e.artist} ${e.pack}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
      : this.all;
    const keep = keepId ? this.list.findIndex((e) => e.id === keepId) : -1;
    this.index = keep >= 0 ? keep : 0;
    (this.root.querySelector('.search-count') as HTMLElement).textContent = terms.length ? `${this.list.length}` : `${this.all.length}`;
    this.wheelItems.forEach((el) => el.remove());
    this.wheelItems.clear();
    if (render && this.visible) {
      this.renderWheel();
      this.renderDetail();
      this.queuePreview();
    }
  }

  // --------------------------------------------------------------------------
  // Input
  // --------------------------------------------------------------------------

  private onKey = (e: KeyboardEvent) => {
    if (!this.visible || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const nav = !this.isGuest;
    const solo = !multiplayerClient.getRoom();
    switch (e.code) {
      case 'ArrowUp':
        if (nav) this.move(-1);
        break;
      case 'ArrowDown':
        if (nav) this.move(1);
        break;
      case 'PageUp':
        if (nav) this.jumpPack(-1);
        break;
      case 'PageDown':
        if (nav) this.jumpPack(1);
        break;
      case 'ArrowLeft':
        this.changeDiff(-1);
        break;
      case 'ArrowRight':
        this.changeDiff(1);
        break;
      case 'Slash':
      case 'KeyF':
        if (e.code === 'KeyF' && !(e.ctrlKey || e.metaKey)) return;
        this.searchInput.focus();
        this.searchInput.select();
        break;
      case 'Enter':
        if (!e.repeat && solo) this.play(e.shiftKey);
        break;
      case 'KeyA':
        if (!e.repeat && solo) this.play(true);
        break;
      case 'KeyS':
        if (!e.repeat && solo) this.startPractice();
        break;
      case 'Backspace':
      case 'Delete':
        this.clearPractice();
        break;
      case 'Minus':
        this.option('speed', -1);
        break;
      case 'Equal':
        this.option('speed', 1);
        break;
      case 'BracketLeft':
        this.option('offset', -1);
        break;
      case 'BracketRight':
        this.option('offset', 1);
        break;
      case 'Comma':
        if (solo) this.option('rate', -1);
        break;
      case 'Period':
        if (solo) this.option('rate', 1);
        break;
      case 'KeyP':
        this.option('perspective', 1);
        break;
      case 'KeyT':
        this.option('assist', 1);
        break;
      case 'KeyH':
        this.option('hitms', 1);
        break;
      case 'KeyV':
        this.option('focus', 1);
        break;
      case 'KeyC':
        if (solo) this.cb.onCalibrate();
        break;
      case 'KeyM':
        this.openMultiplayer();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  private move(delta: number): void {
    if (this.list.length === 0 || this.isGuest) return;
    const next = (((this.index + delta) % this.list.length) + this.list.length) % this.list.length;
    if (next === this.index) return;
    this.index = next;
    audio.play1('ui-move', { gain: 0.6 });
    this.renderWheel();
    this.renderDetail();
    this.queuePreview();
    this.broadcast();
  }

  private jumpPack(dir: number): void {
    const n = this.list.length;
    if (n === 0) return;
    const packOf = (i: number) => this.list[((i % n) + n) % n]!.pack;
    const cur = packOf(this.index);
    let i = this.index;
    for (let k = 0; k < n && packOf(i) === cur; k++) i += dir;
    // Land on the first song of that pack
    const target = packOf(i);
    for (let k = 0; k < n && packOf(i - 1) === target; k++) i--;
    this.move((((i - this.index) % n) + n) % n);
  }

  private changeDiff(dir: number): void {
    const cur = this.current;
    if (!cur) return;
    const available = cur.entry.charts.map((c) => c.difficulty);
    const pos = available.indexOf(cur.meta.difficulty);
    const next = available[Math.max(0, Math.min(available.length - 1, pos + dir))]!;
    if (next === cur.meta.difficulty) return;
    this.diff = next;
    audio.play1('ui-change', { gain: 0.7 });
    this.renderDetail();
    this.renderWheel();
    this.broadcast();
  }

  private play(autoplay: boolean): void {
    const cur = this.current;
    if (!cur) return;
    audio.play1('ui-start');
    this.cb.onPlay(cur.entry, cur.meta.difficulty, autoplay);
  }

  private practiceKey(): string | null {
    const cur = this.current;
    return cur ? `${cur.entry.id}::${cur.meta.difficulty}` : null;
  }

  /** Loop the selected section, or the whole chart when nothing is selected */
  private startPractice(): void {
    const cur = this.current;
    const key = this.practiceKey();
    if (!cur || !key) return;
    const range = this.practice.get(key) ?? (this.loaded?.key === key ? { from: this.loaded.stats.startMs, to: this.loaded.stats.endMs } : null);
    if (!range) return;
    audio.play1('ui-start');
    this.cb.onPlay(cur.entry, cur.meta.difficulty, false, range);
  }

  private clearPractice(): void {
    const key = this.practiceKey();
    if (key && this.practice.delete(key)) {
      audio.play1('ui-back', { gain: 0.6 });
      this.drawDensity();
    }
  }

  private option(kind: OptionKind, dir: number): void {
    const s = { ...this.settings };
    const step = (opts: readonly number[], cur: number, fallback: number) => {
      const i = opts.indexOf(cur);
      return opts[Math.max(0, Math.min(opts.length - 1, (i < 0 ? fallback : i) + dir))]!;
    };
    if (kind === 'speed') s.cmod = step(CMOD_OPTIONS, s.cmod, 8);
    else if (kind === 'offset') s.offsetMs = Math.max(-300, Math.min(300, s.offsetMs + dir * 5));
    else if (kind === 'rate') s.rate = step(RATE_OPTIONS, s.rate, RATE_OPTIONS.indexOf(1));
    else if (kind === 'perspective') s.perspective = s.perspective === 'flat' ? 'tilted' : 'flat';
    else if (kind === 'assist') s.assistTick = !s.assistTick;
    else if (kind === 'hitms') s.showHitMs = !s.showHitMs;
    else s.focus = !s.focus;
    this.settings = s;
    audio.play1('ui-change', { gain: 0.7 });
    this.cb.onSettings(s);
    this.renderOptions();
  }

  private async openMultiplayer(): Promise<void> {
    if (multiplayerClient.getRoom()) return;
    audio.play1('ui-select');
    window.removeEventListener('keydown', this.onKey);
    await openMultiplayerModal();
    if (this.visible) window.addEventListener('keydown', this.onKey);
    this.renderAll();
  }

  async joinFromUrl(code: string): Promise<void> {
    window.removeEventListener('keydown', this.onKey);
    await openMultiplayerModal(code);
    if (this.visible) window.addEventListener('keydown', this.onKey);
    this.renderAll();
  }

  // --------------------------------------------------------------------------
  // Multiplayer sync
  // --------------------------------------------------------------------------

  private broadcast(): void {
    if (!multiplayerClient.getRoom() || !multiplayerClient.isHost()) return;
    const cur = this.current;
    const nav: HostNavigationState = { packIndex: 0, songIndex: this.index };
    if (cur) {
      nav.songId = cur.entry.id;
      nav.difficulty = cur.meta.difficulty;
    }
    multiplayerClient.sendHostNavigation(nav);
  }

  private onMultiplayer = (e: MultiplayerEvent) => {
    const joinedNav = e.type === 'room-joined' ? (e.data as { hostNavigation?: HostNavigationState })?.hostNavigation : undefined;
    if (e.type === 'host-navigation' || joinedNav) {
      if (!this.isGuest) return;
      const nav = joinedNav ?? (e.data as HostNavigationState);
      if (nav.songId && !this.list.some((s) => s.id === nav.songId)) this.applySearch('', false);
      const i = nav.songId ? this.list.findIndex((s) => s.id === nav.songId) : -1;
      if (i >= 0) this.index = i;
      if (nav.difficulty) this.diff = nav.difficulty;
      if (this.visible) {
        this.renderWheel();
        this.renderDetail();
        this.queuePreview();
      }
    }
    if (['room-created', 'room-joined', 'room-updated', 'player-joined', 'player-left', 'connection-changed'].includes(e.type) && this.visible) {
      this.renderRoom();
      this.renderOptions();
      this.renderDetail();
      if (e.type === 'room-created') this.broadcast();
    }
  };

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  private renderAll(): void {
    this.renderRoom();
    this.renderWheel();
    this.renderDetail();
    this.renderOptions();
  }

  private renderRoom(): void {
    const el = this.root.querySelector('.select-room') as HTMLElement;
    const room = multiplayerClient.getRoom();
    el.innerHTML = room ? roomBarHtml(room) : '';
    (this.root.querySelector('[data-act="mp"]') as HTMLElement).classList.toggle('hidden', !!room);
    if (room)
      bindRoomBar(
        el,
        () => {
          const c = this.current;
          return c ? { songId: c.entry.id, difficulty: c.meta.difficulty } : null;
        },
        () => this.renderAll()
      );
  }

  private renderWheel(): void {
    const track = this.root.querySelector('.wheel-track') as HTMLElement;
    const n = this.list.length;
    const keep = new Set<string>();
    for (let k = -WHEEL_SPAN; k <= WHEEL_SPAN && n > 0; k++) {
      if (n < 2 * WHEEL_SPAN + 1 && Math.abs(k) > Math.floor(n / 2)) continue;
      const i = (((this.index + k) % n) + n) % n;
      const entry = this.list[i]!;
      if (keep.has(entry.id)) continue;
      keep.add(entry.id);
      let el = this.wheelItems.get(entry.id);
      if (!el) {
        el = this.wheelItem(entry);
        track.appendChild(el);
        this.wheelItems.set(entry.id, el);
        // enter from the edge it scrolls in from
        el.style.transform = this.wheelTransform(k + Math.sign(k || 1));
        el.style.opacity = '0';
        void el.offsetWidth;
      }
      el.style.transform = this.wheelTransform(k);
      el.style.opacity = String(Math.max(0, 1 - Math.abs(k) * 0.14));
      el.style.zIndex = String(100 - Math.abs(k));
      el.classList.toggle('active', k === 0);
      const meta = this.chartFor(entry);
      const best = getBest(entry.id, meta.difficulty);
      const level = el.querySelector('.wi-level') as HTMLElement;
      level.textContent = String(meta.level);
      level.dataset.diff = meta.difficulty;
      const grade = el.querySelector('.wi-grade') as HTMLElement;
      grade.textContent = best?.grade ?? '';
      grade.dataset.grade = best?.grade ?? '';
    }
    for (const [id, el] of this.wheelItems) {
      if (!keep.has(id)) {
        el.remove();
        this.wheelItems.delete(id);
      }
    }
  }

  private wheelTransform(k: number): string {
    // The focused item sits flush in the track; neighbours recede to the left along an arc
    const angle = k * 9;
    const y = k * 78;
    const x = -Math.abs(k) * Math.abs(k) * 4;
    const s = 1 - Math.min(0.24, Math.abs(k) * 0.035);
    return `translate3d(${x}px, ${y}px, 0) rotateX(${-angle}deg) scale(${s})`;
  }

  private wheelItem(entry: SongEntry): HTMLElement {
    const el = document.createElement('button');
    el.className = 'wheel-item';
    el.innerHTML = `
      <span class="wi-pack">${escapeHtml(entry.pack)}</span>
      <span class="wi-title">${escapeHtml(entry.title)}</span>
      <span class="wi-artist">${escapeHtml(entry.artist)}</span>
      <span class="wi-level"></span>
      <span class="wi-grade"></span>`;
    el.addEventListener('click', () => {
      const i = this.list.indexOf(entry);
      if (i === this.index) this.play(false);
      else if (i >= 0) this.move(i - this.index);
    });
    return el;
  }

  private renderDetail(): void {
    const el = this.root.querySelector('.detail') as HTMLElement;
    const cur = this.current;
    if (!cur) {
      el.innerHTML = this.query ? `<div class="detail-none">No song matches "${escapeHtml(this.query)}".</div>` : '';
      return;
    }
    const { entry, meta } = cur;
    const best = getBest(entry.id, meta.difficulty);
    const dir = songDir(entry);
    const art = assetUrl(dir, entry.jacket) ?? assetUrl(dir, entry.background) ?? assetUrl(dir, entry.banner);
    const bpmText = Math.round(entry.bpmMin) === Math.round(entry.bpmMax) ? `${Math.round(entry.bpmMin)}` : `${Math.round(entry.bpmMin)}–${Math.round(entry.bpmMax)}`;
    const inRoom = !!multiplayerClient.getRoom();

    el.innerHTML = `
      <div class="jacket" style="${art ? `--art: url(&quot;${art}&quot;)` : ''}">
        <div class="jacket-art"></div>
        ${entry.silent ? '<span class="jacket-tag">NO AUDIO · DRILL</span>' : ''}
      </div>
      <div class="detail-head">
        <div class="detail-pack">${escapeHtml(entry.pack)}</div>
        <h1 class="detail-title">${escapeHtml(entry.title)}</h1>
        ${entry.subtitle ? `<div class="detail-sub">${escapeHtml(entry.subtitle)}</div>` : ''}
        <div class="detail-artist">${escapeHtml(entry.artist)}</div>
        <div class="detail-meta"><span><b>${bpmText}</b> BPM</span><span class="meta-len"><b>–:––</b></span><span><b>${meta.steps}</b> steps</span></div>
      </div>
      <div class="ladder" role="listbox" aria-label="Difficulty">
        ${DIFFS.map((d) => {
          const c = entry.charts.find((x) => x.difficulty === d);
          const b = c ? getBest(entry.id, d) : null;
          return `<button class="rung ${c ? '' : 'empty'} ${d === meta.difficulty ? 'active' : ''}" data-diff="${d}" ${c ? '' : 'disabled'}>
            <span class="rung-name">${d}</span><span class="rung-level">${c ? c.level : '–'}</span><span class="rung-grade" data-grade="${b?.grade ?? ''}">${b?.grade ?? ''}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="chart-panel glass">
        <div class="chart-best">
          ${best
            ? `<div class="best-grade" data-grade="${best.grade}">${best.grade}</div><div><div class="best-score">${best.score.toLocaleString('en-US')}</div><div class="best-sub">${best.percentage.toFixed(2)}% · ${best.maxCombo} max combo${best.fullCombo ? ' · <b>FC</b>' : ''}</div></div>`
            : '<div class="best-none">Not played yet. Clear it to set a record.</div>'}
          <div class="density-legend"></div>
        </div>
        <div class="density-wrap" title="Drag to pick a section to practice">
          <canvas class="density" aria-label="Note density over time"></canvas>
          <div class="density-range hidden"></div>
        </div>
        <div class="chart-row">
          <svg class="radar" viewBox="-60 -60 120 120" aria-label="Groove radar"></svg>
          <dl class="chart-stats"></dl>
        </div>
      </div>
      <div class="play-cta">
        ${inRoom
          ? this.isGuest ? '<span class="cta-wait">Waiting for the host…</span>' : '<span class="cta-wait">Start the battle from the room bar</span>'
          : `<button class="btn btn-play" data-act="play"><kbd>Enter</kbd> Play</button>
             <button class="btn btn-ghost" data-act="practice"><kbd>S</kbd> Practice</button>
             <button class="btn btn-ghost" data-act="demo"><kbd>A</kbd> Autoplay</button>`}
      </div>`;

    el.querySelectorAll<HTMLElement>('.rung:not(.empty)').forEach((r) =>
      r.addEventListener('click', () => {
        this.diff = r.dataset.diff as Difficulty;
        audio.play1('ui-change', { gain: 0.7 });
        this.renderDetail();
        this.renderWheel();
        this.broadcast();
      })
    );
    el.querySelector('[data-act="play"]')?.addEventListener('click', () => this.play(false));
    el.querySelector('[data-act="demo"]')?.addEventListener('click', () => this.play(true));
    el.querySelector('[data-act="practice"]')?.addEventListener('click', () => this.startPractice());
    this.bindRangeDrag(el.querySelector('.density-wrap') as HTMLElement);

    const key = `${entry.id}::${meta.difficulty}`;
    if (this.loaded?.key === key) this.fillStats();
    else {
      this.loaded = null;
      loadSong(entry)
        .then((song) => {
          const chart = song.charts.find((c) => c.difficulty === meta.difficulty) ?? song.charts[0]!;
          const cur2 = this.current;
          if (!cur2 || `${cur2.entry.id}::${cur2.meta.difficulty}` !== key) return;
          this.loaded = { key, song, chart, stats: chartStats(chart) };
          this.fillStats();
        })
        .catch((e) => console.warn(e));
    }
  }

  /** Second pass once the simfile is parsed: length, density, radar, counts */
  private fillStats(): void {
    const l = this.loaded;
    if (!l) return;
    const el = this.root.querySelector('.detail') as HTMLElement;
    const st = l.stats;
    (el.querySelector('.meta-len') as HTMLElement).innerHTML = `<b>${Math.floor(st.durationSec / 60)}:${String(Math.round(st.durationSec % 60)).padStart(2, '0')}</b>`;
    (el.querySelector('.radar') as SVGElement).innerHTML = this.radarSvg(st.radar);
    (el.querySelector('.chart-stats') as HTMLElement).innerHTML = `
      <div><dt>Jumps</dt><dd>${st.jumps}</dd></div>
      <div><dt>Freezes</dt><dd>${st.holds}</dd></div>
      <div><dt>Rolls</dt><dd>${st.rolls}</dd></div>
      <div><dt>Mines</dt><dd>${st.mines}</dd></div>
      <div><dt>Avg NPS</dt><dd>${st.avgNps.toFixed(1)}</dd></div>
      <div><dt>Peak NPS</dt><dd>${st.peakNps.toFixed(1)}</dd></div>`;
    this.drawDensity();
  }

  private bindRangeDrag(wrap: HTMLElement): void {
    let start: number | null = null;
    const toMs = (clientX: number): number | null => {
      const l = this.loaded;
      if (!l) return null;
      const r = wrap.getBoundingClientRect();
      const k = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      return l.stats.startMs + k * (l.stats.endMs - l.stats.startMs);
    };
    wrap.addEventListener('pointerdown', (e) => {
      start = toMs(e.clientX);
      if (start !== null) wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', (e) => {
      const key = this.practiceKey();
      const cur = toMs(e.clientX);
      if (start === null || cur === null || !key) return;
      this.practice.set(key, { from: Math.min(start, cur), to: Math.max(start, cur) });
      this.drawDensity();
    });
    wrap.addEventListener('pointerup', () => {
      const key = this.practiceKey();
      const r = key ? this.practice.get(key) : undefined;
      // A click without a real drag clears the selection
      if (key && r && r.to - r.from < 1500) this.practice.delete(key);
      start = null;
      this.drawDensity();
    });
  }

  private radarSvg(v: number[]): string {
    const axes = ['STREAM', 'VOLTAGE', 'AIR', 'FREEZE', 'CHAOS'];
    const pt = (i: number, r: number) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
    };
    const ring = (r: number) => `<polygon class="radar-ring" points="${axes.map((_, i) => pt(i, r)).join(' ')}"/>`;
    return `${ring(42)}${ring(28)}${ring(14)}
      <polygon class="radar-shape" points="${v.map((x, i) => pt(i, 4 + x * 38)).join(' ')}"/>
      ${axes.map((a, i) => { const [x, y] = pt(i, 52).split(','); return `<text x="${x}" y="${y}">${a}</text>`; }).join('')}`;
  }

  /** Density curve + last run's errors + the practice section */
  private drawDensity(): void {
    const canvas = this.root.querySelector('.density') as HTMLCanvasElement | null;
    const l = this.loaded;
    const cur = this.current;
    if (!canvas || !l || !cur) return;
    const { ctx, w, h } = fitCanvas(canvas);
    const st = l.stats;
    const max = Math.max(8, ...st.density);
    const color = getComputedStyle(this.root).getPropertyValue(`--diff-${cur.meta.difficulty.toLowerCase()}`).trim() || '#22e7ff';
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.moveTo(0, h);
    st.density.forEach((d, i) => ctx.lineTo((i / Math.max(1, st.density.length - 1)) * w, h - (d / max) * (h - 8)));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const x = (t: number) => ((t - st.startMs) / Math.max(1, st.endMs - st.startMs)) * w;
    const errors = getLastRunErrors(cur.entry.id, cur.meta.difficulty) ?? [];
    for (const e of errors) {
      const tall = e.kind === 'miss' || e.kind === 'ng' || e.kind === 'mine';
      ctx.fillStyle = ERROR_COLORS[e.kind] ?? '#fff';
      ctx.globalAlpha = e.kind === 'good' ? 0.55 : 0.9;
      ctx.fillRect(Math.round(x(e.time)) - 1, tall ? 0 : h * 0.35, 2, tall ? h : h * 0.65);
    }
    ctx.globalAlpha = 1;
    const legend = this.root.querySelector('.density-legend') as HTMLElement;
    const count = (k: string) => errors.filter((e) => e.kind === k).length;
    legend.innerHTML = errors.length
      ? `<span>Last run</span>${['miss', 'ng', 'boo', 'good']
          .filter((k) => count(k))
          .map((k) => `<i style="--c:${ERROR_COLORS[k]}">${count(k)} ${k === 'ng' ? 'N.G.' : k}</i>`)
          .join('')}`
      : '';

    const range = this.root.querySelector('.density-range') as HTMLElement;
    const key = this.practiceKey();
    const r = key ? this.practice.get(key) : undefined;
    range.classList.toggle('hidden', !r);
    if (r) {
      range.style.left = `${(x(r.from) / w) * 100}%`;
      range.style.width = `${((x(r.to) - x(r.from)) / w) * 100}%`;
      const secs = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}`;
      range.dataset.label = `${secs(r.from)}–${secs(r.to)} · S to loop`;
    }
  }

  private renderOptions(): void {
    const el = this.root.querySelector('.options') as HTMLElement;
    const s = this.settings;
    const inRoom = !!multiplayerClient.getRoom();
    el.innerHTML = `
      <button class="opt" data-opt="speed"><span class="opt-k"><kbd>−</kbd><kbd>=</kbd></span><span class="opt-l">Speed</span><b>C${s.cmod}</b></button>
      <button class="opt ${s.rate !== 1 ? 'warn' : ''}" data-opt="rate" ${inRoom ? 'disabled' : ''}><span class="opt-k"><kbd>,</kbd><kbd>.</kbd></span><span class="opt-l">Rate</span><b>${s.rate.toFixed(2)}×</b></button>
      <button class="opt" data-opt="offset"><span class="opt-k"><kbd>[</kbd><kbd>]</kbd></span><span class="opt-l">Offset</span><b>${s.offsetMs > 0 ? '+' : ''}${s.offsetMs} ms</b></button>
      <button class="opt" data-opt="calibrate" ${inRoom ? 'disabled' : ''}><span class="opt-k"><kbd>C</kbd></span><span class="opt-l">Calibrate</span><b>Tap test</b></button>
      <button class="opt" data-opt="perspective"><span class="opt-k"><kbd>P</kbd></span><span class="opt-l">View</span><b>${s.perspective === 'flat' ? 'Classic' : 'Highway'}</b></button>
      <button class="opt" data-opt="assist"><span class="opt-k"><kbd>T</kbd></span><span class="opt-l">Assist tick</span><b>${s.assistTick ? 'On' : 'Off'}</b></button>
      <button class="opt" data-opt="focus"><span class="opt-k"><kbd>V</kbd></span><span class="opt-l">Effects</span><b>${s.focus ? 'Focus' : 'Full'}</b></button>
      <button class="opt" data-opt="hitms"><span class="opt-k"><kbd>H</kbd></span><span class="opt-l">Hit ms</span><b>${s.showHitMs ? 'Every hit' : 'Off'}</b></button>
      <div class="opt-hints"><span><kbd>↑</kbd><kbd>↓</kbd> song</span><span><kbd>←</kbd><kbd>→</kbd> difficulty</span><span><kbd>PgUp</kbd><kbd>PgDn</kbd> pack</span><span><kbd>/</kbd> search</span></div>`;
    el.querySelectorAll<HTMLElement>('[data-opt]').forEach((b) =>
      b.addEventListener('click', (e) => {
        const o = b.dataset.opt!;
        const dir = (e as MouseEvent).shiftKey ? -1 : 1;
        if (o === 'calibrate') this.cb.onCalibrate();
        else this.option(o as OptionKind, dir);
      })
    );
  }

  private queuePreview(): void {
    clearTimeout(this.previewTimer);
    const cur = this.current;
    if (!cur) return;
    this.previewTimer = window.setTimeout(() => {
      if (!this.visible) return;
      if (cur.entry.silent) {
        audio.stopPreview();
        return;
      }
      void audio.playPreview(`${songDir(cur.entry)}/${cur.entry.musicFile}`, cur.entry.previewStart, cur.entry.previewLength);
    }, PREVIEW_DELAY_MS);
  }
}
