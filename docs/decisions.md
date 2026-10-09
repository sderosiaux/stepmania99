# Decisions

Why the game is built the way it is. The code shows what; this file keeps the reasons and the options we turned down.

## Clock: the audio output, mapped onto performance.now()

Song time is read from `AudioContext.getOutputTimestamp()`, which pairs the sample leaving the speakers with a `performance.now()` value. We keep `ctx = perf + k`, low-pass `k` to remove jitter, and snap when it jumps (device change, resume). The music, the assist clap and the announcer cues are all started on that one context timeline.

What it replaced: `currentTime` read directly (quantized to render quanta, ahead of the speakers by the output latency), plus a `setTimeout` that started the music after the countdown and switched the game from the performance clock to the audio clock. That switch was hidden by a default offset of -180 ms.

Measured in headless Chrome: song time moves by exactly the frame delta (error under 0.004 ms per frame) and never goes backwards.

## Judging: event timestamps, not frames

Each key event is judged at its own `KeyboardEvent.timeStamp` (or `Gamepad.timestamp`), mapped through the clock above. Frame rate has no effect on a judgment. Misses are declared 25 ms late, so a key event dispatched just after a frame still gets judged.

This replaces the planned 240 Hz fixed-step loop. A fixed step would quantize inputs that already carry exact timestamps.

An in-page bot sending key events at computed times got 165/165 Marvelous with a mean offset of +0.39 ms, the same as its own timer lateness.

## Rules: StepMania J4 windows, DDR freeze semantics

- Tap windows: 22.5 / 45 / 90 / 135 / 180 ms. Great or better keeps the combo.
- Freezes: a release is forgiven for 250 ms if you press again. Rolls must be re-tapped every 500 ms. Each freeze is also judged OK or NG and counts toward the score, the combo and the AAA/AAAA conditions.
- Mines explode when pressed within 90 ms or held while they pass.
- `#OFFSET` puts beat 0 at `-OFFSET` seconds. A STOP freezes after the notes on its beat, a DELAY before them. The old parser had both of these wrong.

## One global offset, measured by tapping

There is a single `offsetMs`, applied to judging and drawing. The calibration screen is audio only: claps on the audio clock, taps on their event timestamps, median after IQR rejection. A visual cue would add display latency to the result. The results screen suggests a correction when 40 or more hits are off by 8 ms or more.

## Rendering: Three.js stage, DOM HUD

Canvas 2D couldn't do bloom, depth or particles at 60 fps. The playfield (extruded instanced arrows, shader holds, bursts, GPU points) and a beat-synced background run in WebGL with an UnrealBloom pass. "Highway" mode is a camera setting, not a separate renderer.

Text (judgment, combo, score, menus) is DOM over the canvas: crisp at any DPI, animated with WAAPI on transform and opacity. One WebGL context lives for the whole session; screens never create their own.

Dark theme on purpose: additive neon bloom only reads on a dark background.

## Simfiles: .sm and .ssc only

The custom `.stp` format was dropped; nothing loaded it. `.ssc` is preferred when a folder has both, because it carries per-chart timing and delays.

## Multiplayer: the server owns the attack rule

One arrow per 15 combo, enforced by the server with a per-player milestone that resets when the combo breaks. Before this, the client attacked every 10 combo while the server wanted 50 and subtracted it, so no attack ever arrived. The client now sends its combo right before an attack, so the server judges the current value. `ATTACK_CONFIG.comboThreshold` and `ATTACK_COMBO_STEP` are pinned together by a test.

## Sound: ElevenLabs, generated offline

`scripts/generate-sfx.mjs` builds every SFX and announcer line into `public/sfx/` with a manifest. Assets are committed, so the API key is only needed to regenerate. Short cues have their leading silence trimmed, because a click that starts 30 ms late feels like input lag.

## Still true from the first version

TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No UI framework: the screens are small and the hot path is WebGL.
