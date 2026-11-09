import type { Song, Chart, Settings, Difficulty } from '../types';
import type { HostNavigationState } from '../types/multiplayer';
import { closestChart, DIFFICULTY_ORDER, type SongEntry, type ChartMeta } from '../core/manifest';
import { buildRows, findRow, groupOf, parseQuery, type WheelRow, type WheelSort } from '../core/wheel';
import { loadSong, songDir, assetUrl } from '../core/loader';
import { audio } from '../audio';
import { multiplayerClient, type MultiplayerEvent } from '../multiplayer';
import { chartStats, type ChartStats } from './chart-stats';
import { getBest, getLastRunErrors, getWheelSort, setWheelSort } from './storage';
import { escapeHtml, fitCanvas, toast } from './dom';
import { THEME } from '../render/theme';
import { openMultiplayerModal, roomBarHtml, bindRoomBar } from './multiplayer-ui';
import { BAR_OPTIONS, OPTIONS, optionForKey, stepOption, type OptionId, type OptionKind } from './options';
import { openOptionsPanel } from './options-panel';

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
  /** Shuffle the listed songs (search applied), each on the chart nearest to `difficulty` */
  onJukebox: (entries: SongEntry[], difficulty: Difficulty) => void;
}

const WHEEL_SPAN = 6;
const PREVIEW_DELAY_MS = 220;
const ERROR_COLORS: Record<string, string> = {
  miss: THEME.judgment.miss,
  boo: THEME.judgment.boo,
  good: THEME.judgment.good,
  ng: '#ff8a3d',
  mine: THEME.mine,
};

export class SongSelectScreen {
  private readonly root: HTMLElement;
  /** The library as handed over: coming back to the screen with the same one keeps the wheel as it was */
  private source: readonly SongEntry[] | null = null;
  private all: SongEntry[] = [];
  private list: WheelRow[] = [];
  private sort: WheelSort = getWheelSort();
  private query = '';
  private index = 0;
  private diff: Difficulty = 'Medium';
  private wheelItems = new Map<string, HTMLElement>();
  private previewTimer = 0;
  private visible = false;
  /** Previews start at the first navigation: arriving on the screen keeps the menu music */
  private previewArmed = false;
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
        <label class="search"><kbd>/</kbd><input type="search" placeholder="Search songs, artists, packs · lv:12" aria-label="Search songs" /><span class="search-count"></span></label>
        <button class="sort-toggle" data-act="sort" title="Group the wheel by pack or by level"><kbd>G</kbd><span>By</span><b></b></button>
        <div class="select-room"></div>
        <button class="btn btn-ghost" data-act="jukebox" title="Songs play themselves, shuffled from this list"><kbd>J</kbd> Jukebox</button>
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
    this.root.querySelector('[data-act="jukebox"]')!.addEventListener('click', () => this.startJukebox());
    this.root.querySelector('[data-act="sort"]')!.addEventListener('click', () => this.toggleSort());
    this.root.querySelector('.wheel')!.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.move(Math.sign((e as WheelEvent).deltaY));
      },
      { passive: false }
    );
    const search = this.searchInput;
    search.addEventListener('input', () => {
      this.previewArmed = true;
      this.applySearch(search.value);
    });
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
    if (entries !== this.source) {
      this.source = entries;
      this.all = [...entries].sort((a, b) => a.pack.localeCompare(b.pack) || a.title.localeCompare(b.title));
      this.applySearch(this.query, false);
    }
    this.visible = true;
    this.previewArmed = false;
    audio.playMenuMusic();
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
    const row = this.list[this.index];
    if (!row) return null;
    return { entry: row.entry, meta: this.chartFor(row) };
  }

  private chartFor(row: WheelRow): ChartMeta {
    return row.chart ?? closestChart(row.entry, this.diff);
  }

  /**
   * A row holding its own chart sets the browsing difficulty: the focused chart then stays the same
   * when the rows go back to following that difficulty (sort by pack, level filter cleared).
   */
  private followRow(): void {
    const chart = this.list[this.index]?.chart;
    if (chart) this.diff = chart.difficulty;
  }

  /** The charts ←/→ step through: all of the song's, or only those the wheel lists when rows hold one chart each */
  private chartsOffered(entry: SongEntry): ChartMeta[] {
    if (!this.list[this.index]?.chart) return entry.charts;
    return this.list
      .filter((r) => r.entry === entry)
      .map((r) => r.chart!)
      .sort((a, b) => DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty));
  }

  private get isGuest(): boolean {
    return multiplayerClient.getRoom() !== null && !multiplayerClient.isHost();
  }

  private applySearch(q: string, render = true): void {
    const keep = this.current;
    this.query = q;
    this.list = buildRows(this.all, parseQuery(q), this.sort);
    this.index = keep ? Math.max(0, findRow(this.list, keep.entry.id, keep.meta.difficulty)) : 0;
    this.followRow();
    (this.root.querySelector('.search-count') as HTMLElement).textContent = `${this.list.length}`;
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
        if (nav) this.jumpGroup(-1);
        break;
      case 'PageDown':
        if (nav) this.jumpGroup(1);
        break;
      case 'KeyG':
        if (!e.repeat) this.toggleSort();
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
      case 'KeyO':
        if (!e.repeat) void this.openOptions();
        break;
      case 'KeyM':
        this.openMultiplayer();
        break;
      case 'KeyJ':
        if (!e.repeat && solo) this.startJukebox();
        break;
      case 'KeyL':
        void this.copyLink();
        break;
      default: {
        const opt = optionForKey(e);
        if (!opt) return;
        this.runOption(opt.id, opt.dir);
      }
    }
    e.preventDefault();
  };

  private move(delta: number): void {
    if (this.list.length === 0 || this.isGuest) return;
    const next = (((this.index + delta) % this.list.length) + this.list.length) % this.list.length;
    if (next === this.index) return;
    this.index = next;
    this.followRow();
    this.previewArmed = true;
    audio.play1('ui-move', { gain: 0.6 });
    this.renderWheel();
    this.renderDetail();
    this.queuePreview();
    this.broadcast();
  }

  /** PgUp/PgDn: to the first row of the previous/next pack, or level when sorted by level */
  private jumpGroup(dir: number): void {
    const n = this.list.length;
    if (n === 0) return;
    const groupAt = (i: number) => groupOf(this.list[((i % n) + n) % n]!, this.sort);
    const cur = groupAt(this.index);
    let i = this.index;
    for (let k = 0; k < n && groupAt(i) === cur; k++) i += dir;
    const target = groupAt(i);
    for (let k = 0; k < n && groupAt(i - 1) === target; k++) i--;
    this.move((((i - this.index) % n) + n) % n);
  }

  private changeDiff(dir: number): void {
    const cur = this.current;
    if (!cur) return;
    const available = this.chartsOffered(cur.entry).map((c) => c.difficulty);
    const pos = available.indexOf(cur.meta.difficulty);
    const next = available[Math.max(0, Math.min(available.length - 1, pos + dir))]!;
    if (next === cur.meta.difficulty) return;
    this.selectDiff(next);
  }

  /** When rows hold one chart each, the song's other chart is another row: the wheel goes there */
  private selectDiff(d: Difficulty): void {
    const row = this.list[this.index];
    if (!row) return;
    if (row.chart) {
      const i = this.list.findIndex((r) => r.entry === row.entry && r.chart?.difficulty === d);
      if (i < 0) return;
      this.index = i;
    }
    this.diff = d;
    audio.play1('ui-change', { gain: 0.7 });
    this.renderDetail();
    this.renderWheel();
    this.broadcast();
  }

  private toggleSort(): void {
    this.sort = this.sort === 'pack' ? 'level' : 'pack';
    setWheelSort(this.sort);
    audio.play1('ui-change', { gain: 0.7 });
    this.applySearch(this.query);
    this.renderSort();
    this.renderOptions();
  }

  /**
   * Focus a song's chart picked elsewhere (link, host, jukebox), at the browsing difficulty `d`.
   * The search is dropped only when it hides the song or that chart.
   */
  private locate(id: string, d: Difficulty): boolean {
    const entry = this.all.find((e) => e.id === id);
    if (!entry) return false;
    const target = closestChart(entry, d).difficulty;
    if (!this.list.some((r) => r.entry === entry && (!r.chart || r.chart.difficulty === target))) this.applySearch('', false);
    this.diff = d;
    const i = findRow(this.list, id, target);
    if (i < 0) return false;
    this.index = i;
    this.followRow();
    return true;
  }

  private play(autoplay: boolean): void {
    const cur = this.current;
    if (!cur) return;
    audio.play1('ui-start');
    this.cb.onPlay(cur.entry, cur.meta.difficulty, autoplay);
  }

  private startJukebox(): void {
    if (multiplayerClient.getRoom() || this.list.length === 0) return;
    audio.play1('ui-start');
    this.cb.onJukebox([...new Set(this.list.map((r) => r.entry))], this.diff);
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

  /** Battle rooms leave out what would make players' runs differ (rate, no hands) and the calibration screen */
  private runOption(id: OptionId, dir: number): void {
    if (OPTIONS[id].solo && multiplayerClient.getRoom()) return;
    if (id === 'calibrate') this.cb.onCalibrate();
    else this.option(id, dir);
  }

  private option(kind: OptionKind, dir: number): void {
    this.settings = stepOption(this.settings, kind, dir);
    audio.play1('ui-change', { gain: 0.7 });
    this.cb.onSettings(this.settings);
    this.renderOptions();
  }

  private async openOptions(): Promise<void> {
    audio.play1('ui-select', { gain: 0.6 });
    window.removeEventListener('keydown', this.onKey);
    await openOptionsPanel({
      settings: () => this.settings,
      inRoom: !!multiplayerClient.getRoom(),
      change: (kind, dir) => this.option(kind, dir),
      calibrate: () => this.cb.onCalibrate(),
    });
    if (this.visible) window.addEventListener('keydown', this.onKey);
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

  // --------------------------------------------------------------------------
  // Shareable URL: ?song=<id>&diff=<Difficulty> always mirrors the focused chart
  // --------------------------------------------------------------------------

  /** Focus a song by id (deep link) and play its preview. Returns false when it is not in the library. */
  focusSong(id: string, difficulty?: string | null): boolean {
    if (!this.locate(id, DIFFICULTY_ORDER.find((x) => x === difficulty) ?? this.diff)) return false;
    this.previewArmed = true;
    audio.stopMenuMusic(300);
    if (this.visible) {
      this.renderWheel();
      this.renderDetail();
      this.queuePreview();
    }
    this.syncUrl();
    return true;
  }

  static linkFor(entry: SongEntry, difficulty: Difficulty): string {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('song', entry.id);
    url.searchParams.set('diff', difficulty);
    return url.toString();
  }

  private syncUrl(): void {
    const cur = this.current;
    if (!cur) return;
    const url = new URL(window.location.href);
    url.searchParams.set('song', cur.entry.id);
    url.searchParams.set('diff', cur.meta.difficulty);
    url.searchParams.delete('play');
    url.searchParams.delete('autoplay');
    window.history.replaceState(null, '', url.toString());
  }

  private async copyLink(): Promise<void> {
    const cur = this.current;
    if (!cur) return;
    try {
      await navigator.clipboard.writeText(SongSelectScreen.linkFor(cur.entry, cur.meta.difficulty));
      audio.play1('ui-select', { gain: 0.6 });
      toast(`Link to ${cur.entry.title} (${cur.meta.difficulty}) copied`, 2200);
    } catch {
      toast('Could not access the clipboard: copy the address bar instead', 3000);
    }
  }

  private broadcast(): void {
    this.syncUrl();
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
      if (nav.songId) this.locate(nav.songId, nav.difficulty ?? this.diff);
      else if (nav.difficulty) this.diff = nav.difficulty;
      this.previewArmed = true;
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
    this.renderSort();
    this.renderRoom();
    this.renderWheel();
    this.renderDetail();
    this.renderOptions();
  }

  private renderSort(): void {
    const b = this.root.querySelector('[data-act="sort"]') as HTMLElement;
    b.querySelector('b')!.textContent = this.sort === 'level' ? 'Level' : 'Pack';
    b.classList.toggle('on', this.sort === 'level');
  }

  private renderRoom(): void {
    const el = this.root.querySelector('.select-room') as HTMLElement;
    const room = multiplayerClient.getRoom();
    el.innerHTML = room ? roomBarHtml(room) : '';
    (this.root.querySelector('[data-act="mp"]') as HTMLElement).classList.toggle('hidden', !!room);
    (this.root.querySelector('[data-act="jukebox"]') as HTMLElement).classList.toggle('hidden', !!room);
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
      const row = this.list[i]!;
      if (keep.has(row.key)) continue;
      keep.add(row.key);
      let el = this.wheelItems.get(row.key);
      if (!el) {
        el = this.wheelItem(row);
        track.appendChild(el);
        this.wheelItems.set(row.key, el);
        // enter from the edge it scrolls in from
        el.style.transform = this.wheelTransform(k + Math.sign(k || 1));
        el.style.opacity = '0';
        void el.offsetWidth;
      }
      el.style.transform = this.wheelTransform(k);
      el.style.opacity = String(Math.max(0, 1 - Math.abs(k) * 0.14));
      el.style.zIndex = String(100 - Math.abs(k));
      el.classList.toggle('active', k === 0);
      const meta = this.chartFor(row);
      const best = getBest(row.entry.id, meta.difficulty);
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

  private wheelItem(row: WheelRow): HTMLElement {
    const { entry } = row;
    const el = document.createElement('button');
    el.className = 'wheel-item';
    el.innerHTML = `
      <span class="wi-pack">${escapeHtml(entry.pack)}</span>
      <span class="wi-title">${escapeHtml(entry.title)}</span>
      <span class="wi-artist">${escapeHtml(entry.artist)}</span>
      <span class="wi-level"></span>
      <span class="wi-grade"></span>`;
    el.addEventListener('click', () => {
      const i = this.list.indexOf(row);
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
    const offered = new Set(this.chartsOffered(entry).map((c) => c.difficulty));

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
        ${DIFFICULTY_ORDER.map((d) => {
          const c = entry.charts.find((x) => x.difficulty === d);
          const b = c ? getBest(entry.id, d) : null;
          const state = !c ? 'empty' : offered.has(d) ? '' : 'out';
          return `<button class="rung ${state} ${d === meta.difficulty ? 'active' : ''}" data-diff="${d}" ${state ? 'disabled' : ''} ${state === 'out' ? 'title="Outside the level filter"' : ''}>
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
        <button class="btn btn-ghost" data-act="link" title="Copy a link that opens this chart"><kbd>L</kbd> Share</button>
      </div>`;

    el.querySelectorAll<HTMLButtonElement>('.rung:not(:disabled)').forEach((r) =>
      r.addEventListener('click', () => this.selectDiff(r.dataset.diff as Difficulty))
    );
    el.querySelector('[data-act="play"]')?.addEventListener('click', () => this.play(false));
    el.querySelector('[data-act="demo"]')?.addEventListener('click', () => this.play(true));
    el.querySelector('[data-act="link"]')?.addEventListener('click', () => void this.copyLink());
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

  /** Speed and rate, whatever keeps this run from setting a record, and the way into the options panel */
  private renderOptions(): void {
    const el = this.root.querySelector('.options') as HTMLElement;
    const s = this.settings;
    const inRoom = !!multiplayerClient.getRoom();
    const button = (id: OptionId) => {
      const o = OPTIONS[id];
      return `<button class="opt ${o.warn?.(s) ? 'warn' : ''}" data-opt="${id}" ${o.solo && inRoom ? 'disabled' : ''} title="${escapeHtml(o.hint)}">
        <span class="opt-k">${o.keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span><span class="opt-l">${o.label}</span><b>${o.value(s)}</b></button>`;
    };
    const shown: OptionId[] = [...BAR_OPTIONS, ...(s.noHands ? (['nohands'] as const) : [])];
    el.innerHTML = `
      ${shown.map(button).join('')}
      <button class="opt opt-more" data-act="options" title="Offset, calibration, view, receptors, effects…"><span class="opt-k"><kbd>O</kbd></span><span class="opt-l">Timing · Display</span><b>Options</b></button>
      <div class="opt-hints"><span><kbd>↑</kbd><kbd>↓</kbd> song</span><span><kbd>←</kbd><kbd>→</kbd> difficulty</span><span><kbd>PgUp</kbd><kbd>PgDn</kbd> ${this.sort === 'level' ? 'level' : 'pack'}</span><span><kbd>/</kbd> search</span></div>`;
    el.querySelectorAll<HTMLElement>('[data-opt]').forEach((b) =>
      b.addEventListener('click', (e) => this.runOption(b.dataset.opt as OptionId, e.shiftKey ? -1 : 1))
    );
    el.querySelector('[data-act="options"]')!.addEventListener('click', () => void this.openOptions());
  }

  private queuePreview(): void {
    clearTimeout(this.previewTimer);
    const cur = this.current;
    if (!cur || !this.previewArmed) return;
    this.previewTimer = window.setTimeout(() => {
      if (!this.visible) return;
      if (cur.entry.silent) {
        audio.stopPreview();
        audio.playMenuMusic(600);
        return;
      }
      void audio.playPreview(assetUrl(songDir(cur.entry), cur.entry.musicFile)!, cur.entry.previewStart, cur.entry.previewLength);
    }, PREVIEW_DELAY_MS);
  }
}
