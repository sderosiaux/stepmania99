# StepMania Web

A browser-based rhythm game inspired by StepMania/DDR, playable directly in your browser.

**[Play Now](https://sderosiaux.github.io/stepmania-web/)**

## Features

- **StepMania .sm file support**: Load and play real StepMania song packs
- **Beat-based arrow coloring**: Notes colored by subdivision (1/4=red, 1/8=blue, 1/16=yellow, etc.)
- **Precision timing**: Sub-frame accurate audio sync and input detection
- **Health system**: Diablo 3 style health bar with reactive background effects
- **Visual effects**: Combo animations, hit explosions, judgment feedback
- **CMod speed selector**: Constant scroll speed options (C300-C1000)
- **Audio offset calibration**: Fine-tune sync for your setup
- **No dependencies**: Pure TypeScript, Canvas 2D, Web Audio API

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000/stepmania-web/

## Adding Songs

Place StepMania song packs in `public/songs/`:

```
public/songs/
└── My Pack/
    └── Song Folder/
        ├── song.sm      # StepMania chart file
        ├── song.mp3     # Audio file
        └── banner.png   # Optional banner image
```

The game auto-discovers songs on startup.

## Controls

| Key | Action |
|-----|--------|
| Arrow Keys | Hit arrows |
| S D K L | Alternative arrow keys (split layout) |
| Enter | Confirm / Start song |
| Escape | Pause / Back to menu |
| Tab | Demo mode (auto-play) |
| Q / W | Adjust CMod speed |
| - / + | Adjust audio offset |

## Timing Windows

| Judgment | Window | Score |
|----------|--------|-------|
| Marvelous | ±22.5ms | 100% |
| Perfect | ±45ms | 98% |
| Great | ±90ms | 65% |
| Good | ±135ms | 25% |
| Boo | ±180ms | 0% |
| Miss | >180ms | 0% |

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Build**: Vite
- **Testing**: Vitest
- **Rendering**: HTML5 Canvas 2D
- **Audio**: Web Audio API

## Development

```bash
npm run dev      # Start dev server
npm test         # Run tests
npm run build    # Production build
```

## License

MIT
