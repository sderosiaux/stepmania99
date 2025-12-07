# Step File Format Specification (.stp)

## Overview

The `.stp` format is a human-readable, GenAI-friendly step chart format for rhythm games. It uses a simple text-based notation where each line represents a beat subdivision and each character represents an arrow lane.

## File Extension

`.stp` (StepMania Text Pattern)

## Encoding

UTF-8, Unix line endings (LF)

---

## Structure

```
[Header Section]
[Blank Line]
[Chart Section(s)]
```

---

## Header Section

Headers define song metadata. Each header is on its own line:

```
#KEY:Value
```

### Required Headers

| Header | Description | Example |
|--------|-------------|---------|
| `#TITLE` | Song title | `#TITLE:Through the Fire` |
| `#BPM` | Beats per minute | `#BPM:140` |
| `#MUSIC` | Audio filename (relative) | `#MUSIC:song.mp3` |

### Optional Headers

| Header | Description | Default | Example |
|--------|-------------|---------|---------|
| `#ARTIST` | Artist name | Unknown | `#ARTIST:DragonForce` |
| `#OFFSET` | Audio offset in seconds | 0.0 | `#OFFSET:0.150` |
| `#PREVIEW` | Preview start time (sec) | 0 | `#PREVIEW:45.0` |
| `#GENRE` | Music genre | - | `#GENRE:Metal` |

---

## Chart Section

Charts begin with a difficulty declaration and contain measures of notes.

### Difficulty Declaration

```
//--- CHART: [Difficulty] (Level [N]) ---
```

Valid difficulties: `Beginner`, `Easy`, `Medium`, `Hard`, `Challenge`
Level: 1-20 (difficulty rating)

Example:
```
//--- CHART: Hard (Level 12) ---
```

### Note Grid

Each line in a measure represents a moment in time. The number of lines determines beat subdivision:

| Lines per Measure | Division | Note Type |
|-------------------|----------|-----------|
| 4 | 1/4 | Quarter notes |
| 8 | 1/8 | Eighth notes |
| 12 | 1/12 | Triplets |
| 16 | 1/16 | Sixteenth notes |
| 24 | 1/24 | Twenty-fourth notes |
| 32 | 1/32 | Thirty-second notes |
| 48 | 1/48 | Forty-eighth notes |

### Column Layout

Each line has exactly 4 characters representing arrow lanes:

```
Position:  1    2    3    4
Lane:      L    D    U    R
           ↓    ↓    ↓    ↓
          Left Down  Up  Right
```

### Characters

| Char | Meaning |
|------|---------|
| `.` | No arrow (empty) |
| `L` | Left arrow |
| `D` | Down arrow |
| `U` | Up arrow |
| `R` | Right arrow |

### Measure Separator

Measures are separated by a single comma on its own line:

```
L...
....
..U.
....
,
```

### Comments

Lines starting with `//` are comments and ignored:

```
// This is a comment
L...  // Inline comments NOT supported
```

---

## Complete Example

```
#TITLE:Tutorial Song
#ARTIST:Stepmania99
#BPM:120
#OFFSET:0.0
#MUSIC:tutorial.mp3

//--- CHART: Easy (Level 3) ---

// Measure 1 - Quarter notes (4 rows)
// Simple left-right pattern
L...
....
...R
....
,
// Measure 2 - Quarter notes
// Down-up pattern
.D..
....
..U.
....
,
// Measure 3 - Eighth notes (8 rows)
// Faster pattern
L...
....
...R
....
.D..
....
..U.
....
,
// Measure 4 - Eighth notes with jump
L...
....
.D..
....
L..R
....
.DU.
....
,

//--- CHART: Hard (Level 8) ---

// Measure 1 - Sixteenth notes (16 rows)
L...
....
...R
....
.D..
....
..U.
....
L...
....
...R
....
.D..
....
..U.
....
,
// Measure 2 - Sixteenth notes with jumps
L..R
....
.DU.
....
L...
...R
.D..
..U.
L..R
....
.DU.
....
....
....
....
....
,
```

---

## Timing Calculation

### Beat Timing Formula

```
note_time_ms = (measure_index × 4 + beat_in_measure) × (60000 / BPM) + offset_ms
```

Where:
- `measure_index`: 0-based measure number
- `beat_in_measure`: `row_index / rows_per_measure × 4` (converts to quarter note beats)
- `BPM`: Beats per minute from header
- `offset_ms`: Offset from header (converted to ms)

### Example Calculation

Given:
- BPM: 120
- Offset: 0
- Measure 2, Row 3 of 8 rows

```
beat_in_measure = 3 / 8 × 4 = 1.5 beats
note_time_ms = (1 × 4 + 1.5) × (60000 / 120) + 0
             = 5.5 × 500
             = 2750ms
```

---

## Validation Rules

1. Header section must come before any chart section
2. `#TITLE`, `#BPM`, and `#MUSIC` are required
3. Each note line must have exactly 4 characters
4. Only valid characters: `.`, `L`, `D`, `U`, `R`
5. Measures must have valid row counts: 4, 8, 12, 16, 24, 32, 48
6. At least one chart section required
7. BPM must be positive number (typically 60-300)
8. Difficulty must be one of: Beginner, Easy, Medium, Hard, Challenge

---

## GenAI Prompt Template

When asking an AI to generate step files, use this template:

```
Generate a .stp step file for a rhythm game with these parameters:
- BPM: [BPM]
- Duration: [X] measures
- Difficulty: [Easy/Medium/Hard]
- Pattern style: [describe pattern, e.g., "alternating left-right", "streams", "jumps"]

Format rules:
- 4 columns: L D U R (left, down, up, right)
- "." means no arrow, letter means arrow
- Rows per measure: 4 (quarter), 8 (eighth), 16 (sixteenth)
- Separate measures with single comma on own line
- Jumps: multiple arrows on same row (e.g., "L..R")

Example measure (8th notes):
L...
....
...R
....
.D..
....
..U.
....
,
```

---

## Parser Pseudocode

```typescript
function parseStpFile(content: string): Song {
  const lines = content.split('\n');
  const song: Song = { charts: [] };
  let currentChart: Chart | null = null;
  let currentMeasure: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//')) {
      // Check for chart declaration in comment
      if (trimmed.match(/^\/\/--- CHART:/)) {
        // Parse difficulty and level, start new chart
        currentChart = parseChartHeader(trimmed);
        song.charts.push(currentChart);
      }
      continue;
    }

    // Parse headers
    if (trimmed.startsWith('#')) {
      const [key, value] = parseHeader(trimmed);
      song[key] = value;
      continue;
    }

    // Measure separator
    if (trimmed === ',') {
      if (currentChart && currentMeasure.length > 0) {
        processMeasure(currentChart, currentMeasure);
        currentMeasure = [];
      }
      continue;
    }

    // Note line
    if (trimmed.length === 4 && isValidNoteLine(trimmed)) {
      currentMeasure.push(trimmed);
    }
  }

  // Process final measure if no trailing comma
  if (currentChart && currentMeasure.length > 0) {
    processMeasure(currentChart, currentMeasure);
  }

  return song;
}
```
