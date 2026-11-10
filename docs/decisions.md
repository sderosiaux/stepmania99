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

## My level: a second scale, learned from where runs break

The chart's own level stays as written. A personal level sits next to it, on the same scale, and says how hard the chart is for this player.

The reason is in the play history. On 42 logged runs, the original level ranks charts by break rate (good, boo, miss) with a Spearman correlation of 0.56: community packs don't share a scale, and a level can't know which patterns a given player handles. The personal level reaches 0.78 on the same runs, each chart rated by a model that never saw it.

A chart is cut into windows of about 64 notes, each described by seven numbers: speed, jacks, jumps, hands, holds that pin the other finger of the hand, stamina, rhythm changes. Lanes 0-1 are one hand and 2-3 the other, as on S D K L. A run logs its breaks per window, and a logistic regression learns the break rate from the seven numbers, so the weights are the player's own. A chart's risk is the predicted rate over its hardest quarter of windows: a long easy chart with one wall should rate as the wall. Risks are then ranked across the library and read on the distribution of the original levels. A 12 keeps its usual weight, and a player who gets better at everything sees no drift, because only the relative cost of patterns moves a chart.

We turned down a fixed formula in the style of Etterna's MSD: it is not personal and its weights would be guesses. Regressing each chart's best score was the other candidate, with 38 points to fit 7 weights where windows give about 800.

There is no personal level below 10 usable runs and 150 breaks. Autoplay, practice, battles, other rates and No hands are not logged. A failed run counts the windows before the one it died in. A feature can change (bump `PATTERNS_VERSION`) without losing the run log, which stores breaks per window and no features; changing the window size would lose it.
