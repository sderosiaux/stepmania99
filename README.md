# Stepmania 99

A browser rhythm game in the StepMania/DDR family, with a battle mode: up to 8 players, and every 15 combo sends an arrow to a rival.

**[Play now](https://sderosiaux.github.io/stepmania99/)**

## Playing

- Arrows or `D` `F` `J` `K`. USB dance pads and gamepads work too.
- Press `C` on song select to calibrate your offset by tapping to a clap. Headphones help. Bluetooth adds latency you will feel.
- `A` on song select watches the chart in autoplay. `P` switches between the classic view and the highway view.

## Adding songs

Drop StepMania song folders into `public/songs/<Pack>/<Song>/` (`.ssc` or `.sm` plus the audio file), then:

```bash
npm run scan-songs
```

Packs: [StepMania Online](https://stepmaniaonline.net/).

## Development

```bash
npm install
npm run dev          # game
npm run dev:all      # game + multiplayer server (ws://localhost:3001)
npm test
```

Sound effects and announcer lines are committed in `public/sfx/`. To regenerate them you need an ElevenLabs key: `ELEVENLABS_API_KEY=... node scripts/generate-sfx.mjs`.

Design decisions are in [docs/decisions.md](docs/decisions.md).

## License

MIT
