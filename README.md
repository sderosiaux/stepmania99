# Stepmania99

A browser-based multiplayer rhythm game inspired by StepMania/DDR with battle royale mechanics. Play against up to 8 players - land combos to attack others with disruptive arrows!

**[Play Now](https://sderosiaux.github.io/stepmania99/)**

## Features

- **Multiplayer Battle Royale**: Join rooms of up to 8 players
- **Attack System**: Build combos to send disruptive arrows to opponents
- **Real-time Competition**: See other players' health and combos live
- **Solo Mode**: Practice on your own

## Adding Songs

**[Download song packs from StepMania Online](https://stepmaniaonline.net/)**

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

## License

MIT
