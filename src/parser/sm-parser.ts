import type { Song, Chart, Note, Direction, Difficulty, BpmChange, Stop } from '../types';

// ============================================================================
// SM Parser - StepMania .sm file format parser
// ============================================================================

interface SmHeader {
  title?: string;
  subtitle?: string;
  artist?: string;
  banner?: string;
  background?: string;
  music?: string;
  offset?: number;
  sampleStart?: number;
  sampleLength?: number;
  bpms?: BpmChange[];
  stops?: Stop[];
}

interface SmChart {
  gameType: string;
  description: string;
  difficulty: string;
  level: number;
  grooveRadar: number[];
  noteData: string;
}

interface ParseError {
  message: string;
  line?: number;
}

// ============================================================================
// Header Parsing
// ============================================================================

function parseSmHeaders(content: string): { headers: SmHeader; errors: ParseError[] } {
  const headers: SmHeader = {};
  const errors: ParseError[] = [];

  // Match all header tags: #TAG:value; (value can span multiple lines)
  const headerRegex = /#([A-Z]+):([^;]*);/gi;
  let match;

  while ((match = headerRegex.exec(content)) !== null) {
    const key = match[1]?.toUpperCase();
    const value = match[2]?.trim() ?? '';

    switch (key) {
      case 'TITLE':
        headers.title = value;
        break;
      case 'SUBTITLE':
        headers.subtitle = value;
        break;
      case 'ARTIST':
        headers.artist = value;
        break;
      case 'BANNER':
        headers.banner = value;
        break;
      case 'BACKGROUND':
        headers.background = value;
        break;
      case 'MUSIC':
        headers.music = value;
        break;
      case 'OFFSET':
        const offset = parseFloat(value);
        if (!isNaN(offset)) {
          // SM offset is in seconds, convert to ms
          // Positive offset = beat 0 occurs later in the audio
          headers.offset = offset * 1000;
        }
        break;
      case 'SAMPLESTART':
        const sampleStart = parseFloat(value);
        if (!isNaN(sampleStart)) {
          headers.sampleStart = sampleStart;
        }
        break;
      case 'SAMPLELENGTH':
        const sampleLength = parseFloat(value);
        if (!isNaN(sampleLength)) {
          headers.sampleLength = sampleLength;
        }
        break;
      case 'BPMS':
        headers.bpms = parseBpmChanges(value, errors);
        break;
      case 'STOPS':
        headers.stops = parseStops(value, errors);
        break;
    }
  }

  return { headers, errors };
}

function parseBpmChanges(value: string, errors: ParseError[]): BpmChange[] {
  const changes: BpmChange[] = [];

  if (!value.trim()) return changes;

  const pairs = value.split(',');
  for (const pair of pairs) {
    const [beatStr, bpmStr] = pair.split('=');
    if (!beatStr || !bpmStr) continue;

    const beat = parseFloat(beatStr.trim());
    const bpm = parseFloat(bpmStr.trim());

    if (isNaN(beat) || isNaN(bpm)) {
      errors.push({ message: `Invalid BPM change: ${pair}` });
      continue;
    }

    changes.push({ beat, bpm });
  }

  // Sort by beat
  changes.sort((a, b) => a.beat - b.beat);
  return changes;
}

function parseStops(value: string, errors: ParseError[]): Stop[] {
  const stops: Stop[] = [];

  if (!value.trim()) return stops;

  const pairs = value.split(',');
  for (const pair of pairs) {
    const [beatStr, durationStr] = pair.split('=');
    if (!beatStr || !durationStr) continue;

    const beat = parseFloat(beatStr.trim());
    const duration = parseFloat(durationStr.trim());

    if (isNaN(beat) || isNaN(duration)) {
      errors.push({ message: `Invalid stop: ${pair}` });
      continue;
    }

    stops.push({ beat, duration });
  }

  // Sort by beat
  stops.sort((a, b) => a.beat - b.beat);
  return stops;
}

// ============================================================================
// Chart Parsing
// ============================================================================

function parseSmCharts(content: string): { charts: SmChart[]; errors: ParseError[] } {
  const charts: SmChart[] = [];
  const errors: ParseError[] = [];

  // Match #NOTES: sections
  const notesRegex = /#NOTES:\s*([^:]*):([^:]*):([^:]*):([^:]*):([^:]*):([^;]*);/gs;
  let match;

  while ((match = notesRegex.exec(content)) !== null) {
    const gameType = match[1]?.trim() ?? '';
    const description = match[2]?.trim() ?? '';
    const difficulty = match[3]?.trim() ?? '';
    const levelStr = match[4]?.trim() ?? '1';
    const grooveRadarStr = match[5]?.trim() ?? '';
    const noteData = match[6] ?? '';

    // Only parse dance-single charts (4-panel)
    if (gameType !== 'dance-single') {
      continue;
    }

    const level = parseInt(levelStr, 10) || 1;
    const grooveRadar = grooveRadarStr.split(',').map(v => parseFloat(v.trim()) || 0);

    charts.push({
      gameType,
      description,
      difficulty,
      level,
      grooveRadar,
      noteData,
    });
  }

  return { charts, errors };
}

// ============================================================================
// Note Data Parsing
// ============================================================================

const DIRECTION_MAP: Direction[] = ['left', 'down', 'up', 'right'];

function normalizeDifficulty(smDifficulty: string): Difficulty {
  const lower = smDifficulty.toLowerCase();
  switch (lower) {
    case 'beginner':
      return 'Beginner';
    case 'easy':
    case 'basic':
      return 'Easy';
    case 'medium':
    case 'another':
    case 'trick':
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

function parseNoteData(
  noteData: string,
  bpmChanges: BpmChange[],
  stops: Stop[],
  offset: number
): { notes: Note[]; errors: ParseError[] } {
  const notes: Note[] = [];
  const errors: ParseError[] = [];

  // Track active holds per lane (column index -> start note)
  const activeHolds: Map<number, { id: number; time: number; direction: Direction }> = new Map();

  // Split into measures (separated by commas)
  const measures = noteData
    .split(',')
    .map(m => m.trim())
    .filter(m => m.length > 0);

  let noteId = 0;

  for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
    const measureData = measures[measureIndex];
    if (!measureData) continue;

    // Split measure into rows (lines with 4 characters)
    const rows = measureData
      .split(/\r?\n/)
      .map(r => r.replace(/\/\/.*$/, '').trim()) // Remove comments
      .filter(r => r.length === 4);

    if (rows.length === 0) continue;

    const rowsPerMeasure = rows.length;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      if (!row) continue;

      // Calculate beat position
      const beat = measureIndex * 4 + (rowIndex / rowsPerMeasure) * 4;
      const time = beatToTimeWithChanges(beat, bpmChanges, stops, offset);

      // Parse each column (0=left, 1=down, 2=up, 3=right)
      for (let col = 0; col < 4; col++) {
        const char = row[col];
        if (!char) continue;

        const direction = DIRECTION_MAP[col];
        if (!direction) continue;

        switch (char) {
          case '0':
            // Empty - do nothing
            break;

          case '1':
            // Tap note
            notes.push({
              id: noteId++,
              time,
              direction,
              type: 'tap',
              judged: false,
            });
            break;

          case '2':
          case '4':
            // Hold head (2) or Roll head (4) - treat both as hold
            activeHolds.set(col, {
              id: noteId++,
              time,
              direction,
            });
            break;

          case '3':
            // Hold/Roll tail
            const holdStart = activeHolds.get(col);
            if (holdStart) {
              const duration = time - holdStart.time;
              notes.push({
                id: holdStart.id,
                time: holdStart.time,
                direction: holdStart.direction,
                type: 'hold',
                duration,
                endTime: time,
                judged: false,
                holdState: {
                  isHeld: false,
                  started: false,
                  completed: false,
                  dropped: false,
                  progress: 0,
                },
              });
              activeHolds.delete(col);
            } else {
              errors.push({ message: `Hold tail without head at beat ${beat}, column ${col}` });
            }
            break;

          case 'M':
          case 'm':
            // Mine - skip for now (could add later)
            break;

          case 'L':
          case 'l':
            // Lift - skip for now
            break;

          case 'F':
          case 'f':
            // Fake - skip for now
            break;

          default:
            // Unknown character - ignore
            break;
        }
      }
    }
  }

  // Handle any unclosed holds (shouldn't happen in valid files)
  for (const [col, holdStart] of activeHolds) {
    errors.push({ message: `Unclosed hold in column ${col} starting at time ${holdStart.time}` });
  }

  // Sort notes by time
  notes.sort((a, b) => a.time - b.time);

  return { notes, errors };
}

// ============================================================================
// Time Conversion with BPM Changes and Stops
// ============================================================================

function beatToTimeWithChanges(
  beat: number,
  bpmChanges: BpmChange[],
  stops: Stop[],
  offset: number
): number {
  if (bpmChanges.length === 0) {
    // No BPM changes, shouldn't happen but fallback to 120 BPM
    return offset + (beat * 60000) / 120;
  }

  let time = offset;
  let currentBeat = 0;
  let currentBpm = bpmChanges[0]?.bpm ?? 120;

  // Process each BPM segment up to target beat
  for (let i = 0; i < bpmChanges.length; i++) {
    const change = bpmChanges[i]!;
    const nextChange = bpmChanges[i + 1];

    // If this change is after our target beat, stop here
    if (change.beat > beat) {
      break;
    }

    // Add time for the segment from currentBeat to this change
    if (change.beat > currentBeat) {
      const segmentBeats = change.beat - currentBeat;
      const msPerBeat = 60000 / currentBpm;
      time += segmentBeats * msPerBeat;
      currentBeat = change.beat;
    }

    // Update current BPM
    currentBpm = change.bpm;

    // If we've passed the target beat or this is the last change
    if (!nextChange || nextChange.beat > beat) {
      // Calculate remaining time to target beat
      const remainingBeats = beat - currentBeat;
      const msPerBeat = 60000 / currentBpm;
      time += remainingBeats * msPerBeat;
      currentBeat = beat;
      break;
    }
  }

  // Add time for stops that occurred before this beat
  for (const stop of stops) {
    if (stop.beat <= beat) {
      time += stop.duration * 1000; // Convert seconds to ms
    }
  }

  return time;
}

// ============================================================================
// Main Parser
// ============================================================================

export interface SmParseResult {
  song: Song | null;
  errors: ParseError[];
}

export function parseSmFile(content: string, songId: string, basePath: string = ''): SmParseResult {
  const errors: ParseError[] = [];

  // Parse headers
  const { headers, errors: headerErrors } = parseSmHeaders(content);
  errors.push(...headerErrors);

  // Validate required fields
  if (!headers.title) {
    errors.push({ message: 'Missing required header: TITLE' });
  }
  if (!headers.music) {
    errors.push({ message: 'Missing required header: MUSIC' });
  }
  if (!headers.bpms || headers.bpms.length === 0) {
    errors.push({ message: 'Missing required header: BPMS' });
  }

  if (!headers.title || !headers.music || !headers.bpms || headers.bpms.length === 0) {
    return { song: null, errors };
  }

  // Parse charts
  const { charts: smCharts, errors: chartErrors } = parseSmCharts(content);
  errors.push(...chartErrors);

  if (smCharts.length === 0) {
    errors.push({ message: 'No valid dance-single charts found' });
    return { song: null, errors };
  }

  // Convert charts to our format
  const charts: Chart[] = [];
  const offset = headers.offset ?? 0;
  const stops = headers.stops ?? [];

  for (const smChart of smCharts) {
    const { notes, errors: noteErrors } = parseNoteData(
      smChart.noteData,
      headers.bpms,
      stops,
      offset
    );
    errors.push(...noteErrors);

    if (notes.length > 0) {
      charts.push({
        difficulty: normalizeDifficulty(smChart.difficulty),
        level: smChart.level,
        notes,
      });
    }
  }

  if (charts.length === 0) {
    errors.push({ message: 'No charts with valid notes found' });
    return { song: null, errors };
  }

  // Build song object
  const song: Song = {
    id: songId,
    title: headers.title,
    artist: headers.artist ?? 'Unknown Artist',
    bpm: headers.bpms[0]?.bpm ?? 120,
    offset,
    musicFile: headers.music,
    previewStart: headers.sampleStart ?? 0,
    charts,
    bpmChanges: headers.bpms,
    basePath,
  };

  // Add optional properties only if they have values
  if (stops.length > 0) {
    song.stops = stops;
  }
  if (headers.banner) {
    song.banner = headers.banner;
  }
  if (headers.background) {
    song.background = headers.background;
  }

  return { song, errors };
}

// Export time conversion for use elsewhere
export { beatToTimeWithChanges };
