# Stepmania99 - Product Specification

## Overview

A browser-based rhythm game inspired by StepMania/DDR where arrows scroll up the screen and players must press corresponding keys when arrows align with target receptors. **Precision is the core value** - audio sync, input detection, and visual timing must be frame-perfect.

## Problem Statement

Rhythm games require extremely precise synchronization between:
1. Audio playback timing
2. Visual arrow positions
3. Player input detection

Most web-based implementations fail on precision. This project prioritizes timing accuracy above all else.

## Target Users

- Rhythm game enthusiasts who want to play in browser
- Developers who want to create custom step charts
- AI/GenAI systems that can generate step files programmatically

## Goals

1. **Precision**: Sub-frame accurate timing for audio, visuals, and input
2. **Simplicity**: Easy-to-understand step file format that GenAI can generate
3. **Performance**: Smooth 60fps+ gameplay with no frame drops
4. **Authenticity**: StepMania-style look, feel, and scoring

## Non-Goals (for v1)

- Mobile/touch support
- Online multiplayer
- Custom noteskins or themes
- Song downloading/streaming from external sources
- Offline PWA support
- Editor (step charts created manually or via GenAI)

---

## Core Gameplay

### Game Flow

```
[Song Select] → [Gameplay] → [Results Screen] → [Song Select]
```

### Controls

| Key | Action |
|-----|--------|
| ← | Left arrow |
| ↓ | Down arrow |
| ↑ | Up arrow |
| → | Right arrow |
| Enter | Confirm/Start |
| Escape | Back/Pause |

### Arrow Types

| Type | Description | Input |
|------|-------------|-------|
| Tap | Single arrow, tap once | Single keypress |
| Jump | 2+ arrows simultaneously | Multiple keys at once |

### Timing Windows

Based on StepMania's standard timing:

| Judgment | Window | Score | Combo |
|----------|--------|-------|-------|
| Marvelous | ±22.5ms | 100% | +1 |
| Perfect | ±45ms | 98% | +1 |
| Great | ±90ms | 65% | +1 |
| Good | ±135ms | 25% | +1 |
| Boo | ±180ms | 0% | Break |
| Miss | >180ms | 0% | Break |

### Scoring System

```
Base Score = Hit Score × Combo Multiplier
```

- **Max Score**: 1,000,000 per song (normalized)
- **Combo Multiplier**: Increases every 10 combo (caps at 4x)
- **Hit Score**: Based on judgment (Marvelous=100%, Perfect=98%, etc.)

### Grades

| Grade | Threshold |
|-------|-----------|
| AAA | 100% |
| AA | 93% |
| A | 80% |
| B | 65% |
| C | 45% |
| D | <45% |

---

## Song Management

### Directory Structure

```
songs/
├── my-song/
│   ├── song.mp3
│   └── chart.stp
├── another-song/
│   ├── music.mp3
│   └── chart.stp
```

### Step File Format

See `docs/step-format.md` for complete specification.

Quick example:
```
#TITLE:My Song
#ARTIST:Artist
#BPM:140
#MUSIC:song.mp3

L...
....
.D.R
....
,
```

---

## Technical Requirements

### Performance

- **Frame Rate**: 60fps minimum, supports higher refresh rates
- **Input Latency**: <1 frame (16ms) input-to-response
- **Audio Sync**: <5ms drift tolerance
- **Scroll Speed**: Configurable, default ~400px/sec

### Browser Support

- Chrome 90+
- Firefox 90+
- Safari 15+
- Edge 90+

### Tech Stack

- **Rendering**: HTML5 Canvas (2D context)
- **Audio**: Web Audio API (precise scheduling)
- **Input**: Keyboard events with high-resolution timestamps
- **Language**: TypeScript (strict mode)
- **Build**: Vite (fast, minimal config)
- **No frameworks**: Vanilla TypeScript, no React/Vue/etc.

### Architecture Principles

1. **Fixed timestep game loop**: Logic runs at fixed rate, rendering interpolates
2. **Audio as master clock**: All timing derived from AudioContext.currentTime
3. **Input buffering**: Inputs timestamped immediately, processed in game loop
4. **No garbage collection during gameplay**: Object pooling for arrows

---

## User Settings

### Calibration

- **Audio Offset**: Global ms adjustment for audio latency
- **Visual Offset**: Global ms adjustment for display latency
- **Calibration Tool**: Built-in tool to help users find their offset

### Gameplay Options

- **Scroll Speed**: Arrows per second (affects readability, not timing)
- **Background Dim**: 0-100% darkness behind arrows

---

## Data Model

### Song

```typescript
interface Song {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  offset: number;      // ms, audio start offset
  musicFile: string;   // relative path to mp3
  charts: Chart[];
}
```

### Chart

```typescript
interface Chart {
  difficulty: 'Beginner' | 'Easy' | 'Medium' | 'Hard' | 'Challenge';
  level: number;       // 1-20 difficulty rating
  notes: Note[];
}
```

### Note

```typescript
interface Note {
  time: number;        // ms from song start
  direction: 'left' | 'down' | 'up' | 'right';
}
```

### Judgment

```typescript
interface Judgment {
  note: Note;
  timing: number;      // ms difference (negative=early, positive=late)
  grade: 'marvelous' | 'perfect' | 'great' | 'good' | 'boo' | 'miss';
}
```

---

## Open Questions

1. Should we support BPM changes mid-song? (Deferred to v2)
2. Should we support stops/freezes? (Deferred to v2)
3. What happens on browser tab switch? (Pause game)

---

## Assumptions

1. Users have a keyboard (no touch support)
2. Users have speakers/headphones with reasonable latency
3. Song files are pre-loaded (no streaming during gameplay)
4. Modern browser with Web Audio API support
