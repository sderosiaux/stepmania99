import type { Song, Chart, Note, NoteType, Direction, Difficulty, BpmChange, Stop, TimingSource } from '../types';
import { DIRECTIONS } from '../types';
import { buildTimingData, quantizeBeat } from '../core/timing-data';

// ============================================================================
// StepMania simfile parser (.sm and .ssc), dance-single only.
// ============================================================================

export interface ParseIssue {
  message: string;
}

export interface SimfileParseResult {
  song: Song | null;
  errors: ParseIssue[];
}

type Tag = { key: string; value: string };

/** Tokenize `#KEY:VALUE;` pairs in file order. Comments are stripped first: they may contain ';'. */
function tokenize(content: string): Tag[] {
  // Whole-line comments only: a "//" inside a tag value (titles, URLs) is content.
  // Trailing comments on note rows are stripped in parseNoteData.
  const clean = content.replace(/^[ \t]*\/\/[^\n]*/gm, '');
  const tags: Tag[] = [];
  const re = /#([A-Za-z0-9]+)\s*:([^;]*);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    tags.push({ key: m[1]!.toUpperCase(), value: m[2]!.trim() });
  }
  return tags;
}

function parsePairs(value: string, errors: ParseIssue[], label: string): { beat: number; value: number }[] {
  if (!value.trim()) return [];
  const out: { beat: number; value: number }[] = [];
  for (const pair of value.split(',')) {
    const [b, v] = pair.split('=');
    if (b === undefined || v === undefined) continue;
    const beat = parseFloat(b);
    const val = parseFloat(v);
    if (Number.isNaN(beat) || Number.isNaN(val)) {
      errors.push({ message: `Invalid ${label}: ${pair.trim()}` });
      continue;
    }
    out.push({ beat, value: val });
  }
  return out.sort((a, b) => a.beat - b.beat);
}

const toBpms = (v: string, e: ParseIssue[]): BpmChange[] => parsePairs(v, e, 'BPM').map((p) => ({ beat: p.beat, bpm: p.value }));
const toStops = (v: string, e: ParseIssue[], label: string): Stop[] =>
  parsePairs(v, e, label).map((p) => ({ beat: p.beat, duration: p.value }));

export function normalizeDifficulty(raw: string): Difficulty {
  switch (raw.trim().toLowerCase()) {
    case 'beginner':
      return 'Beginner';
    case 'easy':
    case 'basic':
    case 'light':
      return 'Easy';
    case 'medium':
    case 'another':
    case 'trick':
    case 'standard':
      return 'Medium';
    case 'hard':
    case 'maniac':
    case 'heavy':
      return 'Hard';
    case 'challenge':
    case 'expert':
    case 'oni':
    case 'smaniac':
      return 'Challenge';
    default:
      return 'Medium';
  }
}

// ============================================================================
// Note data
// ============================================================================

export function parseNoteData(noteData: string, timing: TimingSource, errors: ParseIssue[]): Note[] {
  const td = buildTimingData(timing);
  const notes: Note[] = [];
  const openHolds = new Map<number, { beat: number; type: 'hold' | 'roll' }>();
  let id = 0;

  const measures = noteData.split(',');
  for (let m = 0; m < measures.length; m++) {
    const rows = measures[m]!
      .split(/\r?\n/)
      // SSC rows may carry keysound {..} / attack [..] annotations
      .map((r) => r.replace(/\/\/.*$/, '').replace(/\{[^}]*\}|\[[^\]]*\]/g, '').trim())
      .filter((r) => r.length > 0);
    if (rows.length === 0) continue;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      if (row.length !== 4) {
        errors.push({ message: `Row of length ${row.length} in measure ${m} (expected 4)` });
        continue;
      }
      const beat = m * 4 + (r * 4) / rows.length;

      for (let lane = 0; lane < 4; lane++) {
        const ch = row[lane]!;
        const direction = DIRECTIONS[lane] as Direction;
        const push = (type: NoteType, extra: Partial<Note> = {}) =>
          notes.push({ id: id++, time: td.beatToTime(beat), beat, direction, lane, type, quant: quantizeBeat(beat), ...extra });

        switch (ch) {
          case '1':
            if (openHolds.has(lane)) errors.push({ message: `Tap inside an open hold at beat ${beat}, lane ${lane}` });
            push('tap');
            break;
          case '2':
          case '4':
            if (openHolds.has(lane)) errors.push({ message: `Hold head while a hold is open at beat ${beat}, lane ${lane}` });
            openHolds.set(lane, { beat, type: ch === '2' ? 'hold' : 'roll' });
            break;
          case '3': {
            const head = openHolds.get(lane);
            if (!head) {
              errors.push({ message: `Hold tail without head at beat ${beat}, lane ${lane}` });
              break;
            }
            openHolds.delete(lane);
            notes.push({
              id: id++,
              time: td.beatToTime(head.beat),
              beat: head.beat,
              direction,
              lane,
              type: head.type,
              endTime: td.beatToTime(beat),
              endBeat: beat,
              quant: quantizeBeat(head.beat),
            });
            break;
          }
          case 'M':
          case 'm':
            push('mine');
            break;
          // L (lift), F (fake), K (keysound) and 0 are not played
          default:
            break;
        }
      }
    }
  }

  for (const [lane, head] of openHolds) {
    errors.push({ message: `Unclosed hold in lane ${lane} at beat ${head.beat}` });
  }

  return notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
}

// ============================================================================
// Song assembly
// ============================================================================

interface ChartDraft {
  stepsType: string;
  difficulty: string;
  meter: number;
  radar: number[];
  notes: string;
  timingOverride: Partial<TimingSource>;
  /** .ssc #WARPS with a non-zero length */
  warps?: boolean;
}

const hasWarps = (t: TimingSource): boolean =>
  t.bpms.some((b) => b.bpm <= 0) || t.stops.some((s) => s.duration < 0) || t.delays.some((s) => s.duration < 0);

function readTimingTag(tag: Tag, target: Partial<TimingSource>, errors: ParseIssue[]): boolean {
  switch (tag.key) {
    case 'OFFSET': {
      const v = parseFloat(tag.value);
      // Beat 0 lands at -OFFSET seconds on the audio timeline
      if (!Number.isNaN(v)) target.beat0Ms = -v * 1000;
      return true;
    }
    case 'BPMS':
      target.bpms = toBpms(tag.value, errors);
      return true;
    case 'STOPS':
    case 'FREEZES':
      target.stops = toStops(tag.value, errors, 'stop');
      return true;
    case 'DELAYS':
      target.delays = toStops(tag.value, errors, 'delay');
      return true;
    default:
      return false;
  }
}

export function parseSimfile(content: string, songId: string, basePath = ''): SimfileParseResult {
  const errors: ParseIssue[] = [];
  const tags = tokenize(content);
  const header: Record<string, string> = {};
  const songTiming: Partial<TimingSource> = {};
  const drafts: ChartDraft[] = [];
  let current: ChartDraft | null = null;

  for (const tag of tags) {
    if (tag.key === 'NOTEDATA') {
      current = { stepsType: '', difficulty: '', meter: 1, radar: [], notes: '', timingOverride: {} };
      drafts.push(current);
      continue;
    }

    if (current) {
      // .ssc chart block
      if (readTimingTag(tag, current.timingOverride, errors)) continue;
      switch (tag.key) {
        case 'STEPSTYPE':
          current.stepsType = tag.value;
          break;
        case 'DIFFICULTY':
          current.difficulty = tag.value;
          break;
        case 'METER':
          current.meter = parseInt(tag.value, 10) || 1;
          break;
        case 'RADARVALUES':
          current.radar = tag.value.split(',').slice(0, 5).map((v) => parseFloat(v) || 0);
          break;
        case 'NOTES':
        case 'NOTES2':
          current.notes = tag.value;
          break;
        case 'WARPS':
          current.warps = parsePairs(tag.value, errors, 'warp').some((p) => p.value > 0);
          break;
      }
      continue;
    }

    if (readTimingTag(tag, songTiming, errors)) continue;

    if (tag.key === 'NOTES') {
      // .sm: #NOTES:type:description:difficulty:meter:radar:data;
      const parts = tag.value.split(':');
      if (parts.length < 6) {
        errors.push({ message: 'Malformed #NOTES block' });
        continue;
      }
      drafts.push({
        stepsType: parts[0]!.trim(),
        difficulty: parts[2]!.trim(),
        meter: parseInt(parts[3]!.trim(), 10) || 1,
        radar: parts[4]!.split(',').slice(0, 5).map((v) => parseFloat(v) || 0),
        notes: parts.slice(5).join(':'),
        timingOverride: {},
      });
      continue;
    }

    header[tag.key] = tag.value;
  }

  const title = header.TITLE;
  const music = header.MUSIC;
  if (!title) errors.push({ message: 'Missing #TITLE' });
  if (!music) errors.push({ message: 'Missing #MUSIC' });
  if (!songTiming.bpms?.length) errors.push({ message: 'Missing #BPMS' });
  if (!title || !music || !songTiming.bpms?.length) return { song: null, errors };

  const timing: TimingSource = {
    beat0Ms: songTiming.beat0Ms ?? 0,
    bpms: songTiming.bpms,
    stops: songTiming.stops ?? [],
    delays: songTiming.delays ?? [],
  };

  const songWarps = parsePairs(header.WARPS ?? '', errors, 'warp').some((p) => p.value > 0);
  const charts: Chart[] = [];
  for (const d of drafts) {
    if (d.stepsType !== 'dance-single') continue;
    const chartTiming: TimingSource = { ...timing, ...d.timingOverride };
    if (hasWarps(chartTiming) || d.warps || songWarps) {
      // Negative BPMs/stops are warps (gimmick charts). Unsupported: playing them would desync every note after the warp.
      errors.push({ message: `${d.difficulty} chart uses warps (negative BPM/stop or #WARPS), not supported` });
      continue;
    }
    const notes = parseNoteData(d.notes, chartTiming, errors);
    if (notes.length === 0) continue;
    const chart: Chart = { difficulty: normalizeDifficulty(d.difficulty), level: d.meter, notes, timing: chartTiming };
    if (d.radar.some((v) => v > 0)) chart.radar = d.radar;
    charts.push(chart);
  }

  const ORDER: Difficulty[] = ['Beginner', 'Easy', 'Medium', 'Hard', 'Challenge'];
  charts.sort((a, b) => ORDER.indexOf(a.difficulty) - ORDER.indexOf(b.difficulty) || a.level - b.level);

  if (charts.length === 0) {
    errors.push({ message: 'No playable dance-single chart' });
    return { song: null, errors };
  }

  const silent = /^virtual(\.\w+)?$/i.test(music.trim());
  const song: Song = {
    id: songId,
    title,
    artist: header.ARTIST || 'Unknown Artist',
    bpm: timing.bpms[0]!.bpm,
    musicFile: music,
    previewStart: parseFloat(header.SAMPLESTART ?? '') || 0,
    previewLength: parseFloat(header.SAMPLELENGTH ?? '') || 12,
    charts,
    timing,
    basePath,
  };
  if (header.SUBTITLE) song.subtitle = header.SUBTITLE;
  if (header.BANNER) song.banner = header.BANNER;
  if (header.JACKET) song.jacket = header.JACKET;
  if (header.BACKGROUND) song.background = header.BACKGROUND;
  if (silent) song.silent = true;

  return { song, errors };
}
