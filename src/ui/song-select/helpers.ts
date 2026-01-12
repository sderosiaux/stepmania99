/**
 * Song Select Helper Functions
 *
 * Utility functions for BPM display, chart stats, groove radar, and score storage.
 */

import type { Song, Note } from '../../types';

// ============================================================================
// BPM Display Helper
// ============================================================================

/**
 * Format BPM for display - shows min-max range for variable BPM songs
 */
export function formatBpm(song: Song): string {
  if (!song.bpmChanges || song.bpmChanges.length <= 1) {
    // Single BPM - truncate decimals
    return `${Math.round(song.bpm)} BPM`;
  }

  // Multiple BPM changes - show min-max range
  const bpms = song.bpmChanges.map((c) => c.bpm);
  const minBpm = Math.round(Math.min(...bpms));
  const maxBpm = Math.round(Math.max(...bpms));

  if (minBpm === maxBpm) {
    return `${minBpm} BPM`;
  }

  return `${minBpm}-${maxBpm} BPM`;
}

// ============================================================================
// Chart Stats Calculator
// ============================================================================

export interface ChartStats {
  totalNotes: number;
  taps: number;
  jumps: number;
  hands: number;
  quads: number;
  durationSec: number;
  nps: number;
  peakNps: number;
}

export function calculateChartStats(notes: Note[]): ChartStats {
  if (notes.length === 0) {
    return { totalNotes: 0, taps: 0, jumps: 0, hands: 0, quads: 0, durationSec: 0, nps: 0, peakNps: 0 };
  }

  const notesByTime = new Map<number, Note[]>();
  for (const note of notes) {
    const time = Math.round(note.time);
    if (!notesByTime.has(time)) {
      notesByTime.set(time, []);
    }
    notesByTime.get(time)!.push(note);
  }

  let taps = 0, jumps = 0, hands = 0, quads = 0;

  for (const [, notesAtTime] of notesByTime) {
    const count = notesAtTime.length;
    if (count === 1) taps++;
    else if (count === 2) jumps++;
    else if (count === 3) hands++;
    else if (count >= 4) quads++;
  }

  const firstNote = notes[0]!;
  const lastNote = notes[notes.length - 1]!;
  const durationMs = lastNote.time - firstNote.time;
  const durationSec = Math.max(1, durationMs / 1000);
  const nps = notes.length / durationSec;

  let peakNps = 0;
  for (let windowStart = firstNote.time; windowStart <= lastNote.time; windowStart += 500) {
    const notesInWindow = notes.filter(n => n.time >= windowStart && n.time < windowStart + 1000);
    peakNps = Math.max(peakNps, notesInWindow.length);
  }

  return { totalNotes: notes.length, taps, jumps, hands, quads, durationSec, nps: Math.round(nps * 10) / 10, peakNps };
}

// ============================================================================
// Groove Radar Calculator
// ============================================================================

export interface GrooveRadar {
  stream: number;   // Note density (0-100)
  voltage: number;  // Peak difficulty (0-100)
  air: number;      // Jumps/hands (0-100)
  freeze: number;   // Hold notes (0-100)
  chaos: number;    // Pattern complexity (0-100)
}

export function calculateGrooveRadar(notes: Note[], durationSec: number): GrooveRadar {
  if (notes.length === 0 || durationSec <= 0) {
    return { stream: 0, voltage: 0, air: 0, freeze: 0, chaos: 0 };
  }

  const notesByTime = new Map<number, Note[]>();
  for (const note of notes) {
    const time = Math.round(note.time);
    if (!notesByTime.has(time)) {
      notesByTime.set(time, []);
    }
    notesByTime.get(time)!.push(note);
  }

  // Stream: Based on average NPS (normalized to 0-100, where 10 NPS = 100)
  const nps = notes.length / durationSec;
  const stream = Math.min(100, (nps / 10) * 100);

  // Voltage: Based on peak NPS (normalized, 15 NPS peak = 100)
  const firstNote = notes[0]!;
  const lastNote = notes[notes.length - 1]!;
  let peakNps = 0;
  for (let windowStart = firstNote.time; windowStart <= lastNote.time; windowStart += 500) {
    const notesInWindow = notes.filter(n => n.time >= windowStart && n.time < windowStart + 1000);
    peakNps = Math.max(peakNps, notesInWindow.length);
  }
  const voltage = Math.min(100, (peakNps / 15) * 100);

  // Air: Percentage of jumps/hands (notes with 2+ at same time)
  let jumpsAndHands = 0;
  for (const [, notesAtTime] of notesByTime) {
    if (notesAtTime.length >= 2) jumpsAndHands++;
  }
  const air = Math.min(100, (jumpsAndHands / notesByTime.size) * 200);

  // Freeze: Percentage of hold notes
  const holdNotes = notes.filter(n => n.type === 'hold').length;
  const freeze = Math.min(100, (holdNotes / notes.length) * 400);

  // Chaos: Based on timing variance (irregular patterns)
  const intervals: number[] = [];
  const sortedTimes = Array.from(notesByTime.keys()).sort((a, b) => a - b);
  for (let i = 1; i < sortedTimes.length; i++) {
    intervals.push(sortedTimes[i]! - sortedTimes[i - 1]!);
  }

  let chaos = 0;
  if (intervals.length > 0) {
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    // High stdDev = irregular patterns = high chaos
    chaos = Math.min(100, (stdDev / avgInterval) * 100);
  }

  return {
    stream: Math.round(stream),
    voltage: Math.round(voltage),
    air: Math.round(air),
    freeze: Math.round(freeze),
    chaos: Math.round(chaos),
  };
}

// ============================================================================
// Score Storage (in-memory)
// ============================================================================

export interface ScoreRecord {
  grade: string;
  score: number;
  maxCombo: number;
  accuracy: number;
  date: number;
}

// Map of "songId-difficulty" -> best score
const scoreStorage = new Map<string, ScoreRecord>();

export function saveScore(songId: string, difficulty: string, record: ScoreRecord): void {
  const key = `${songId}-${difficulty}`;
  const existing = scoreStorage.get(key);
  if (!existing || record.score > existing.score) {
    scoreStorage.set(key, record);
  }
}

export function getScore(songId: string, difficulty: string): ScoreRecord | null {
  return scoreStorage.get(`${songId}-${difficulty}`) ?? null;
}

// ============================================================================
// HTML Escape Utility
// ============================================================================

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
