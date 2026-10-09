// Usage: ELEVENLABS_API_KEY=... GEMINI_API_KEY=... node scripts/generate-sfx.mjs [--force] [--only id1,id2] [--reprocess]

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectRoot, 'public', 'sfx');
const manifestPath = path.join(outDir, 'manifest.json');
// Raw API downloads are cached outside the repo so prompt-independent tweaks
// (trim thresholds, loudness targets) can be re-applied with --reprocess without spending credits.
const rawDir = path.join(os.tmpdir(), 'stepmania99-sfx-raw');

const API = 'https://api.elevenlabs.io/v1';
const VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam (premade): deep, dominant male
const VOICE_MODEL = 'eleven_v3'; // honours [shouts]-style audio tags; multilingual_v2 reads them aloud
const VOICE_SETTINGS = { stability: 0.0, similarity_boost: 0.8, style: 0.8, use_speaker_boost: true };

// ElevenLabs' Music API is paid-plan only, so music comes from Lyria via the Gemini Interactions API.
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const MUSIC_MODEL = 'lyria-3.5';
// Each side of a music loop carries this much periodic extension (the loop's own tail before, its head after),
// so a decoder that ignores the MP3 encoder-delay header (~25 ms shift) still lands loop points inside periodic audio.
const MUSIC_PAD_MS = 100;
// The first seconds of a generation tend to settle (intro fills, mix still opening), so the loop starts after this.
const MUSIC_SKIP_SEC = 10;
const MUSIC_XFADE_SEC = 0.03;

// Integrated-loudness targets (LUFS) per kind; gainDb is an offset from these.
const TARGET_LUFS = { voice: -16, sfx: -18, music: -16 };
const PEAK_CEILING_DB = -1;

// The API's minimum duration is 0.5 s, so sub-500 ms sounds are generated at 0.5 s and cut to maxMs.
const ASSETS = [
  // UI
  // The model tends to emit a train of ticks; maxMs keeps only the first one.
  { id: 'ui-move', kind: 'sfx', duration: 0.5, maxMs: 60, mono: true, gainDb: -4, influence: 0.9,
    prompt: 'One single soft digital click, one short tick only, minimal futuristic menu cursor sound' },
  { id: 'ui-change', kind: 'sfx', duration: 0.5, maxMs: 140, mono: true, gainDb: -4, influence: 0.8,
    prompt: 'A single short bright digital blip, futuristic arcade menu option change, crisp, no music, no reverb' },
  { id: 'ui-select', kind: 'sfx', duration: 0.5, maxMs: 350, influence: 0.7,
    prompt: 'Confident short confirm chime, futuristic arcade game menu select sound, two bright synth notes rising, clean' },
  { id: 'ui-back', kind: 'sfx', duration: 0.5, maxMs: 280, gainDb: -2, influence: 0.7,
    prompt: 'Soft short descending cancel blip, futuristic arcade game menu back sound, two synth notes falling, gentle' },
  // trimDb is lowered so the quiet start of the riser survives leading-silence removal.
  { id: 'ui-start', kind: 'sfx', duration: 1.8, maxMs: 1500, trimDb: -55, influence: 0.85,
    prompt: 'Quiet synth noise sweep rising in pitch and volume, crescendo build-up, ending in a huge boom impact at the very end' },

  // Gameplay
  // Generated claps carry a ~100 ms room tail; an early exponential fade gates it into a tight tick.
  { id: 'assist-clap', kind: 'sfx', duration: 0.5, maxMs: 80, fadeOutMs: 60, mono: true, gainDb: -2, influence: 0.7,
    prompt: 'Loud punchy hand clap, single clap, very short, dry' },
  { id: 'mine-explode', kind: 'sfx', duration: 0.5, maxMs: 450, influence: 0.6,
    prompt: 'Short electric zap explosion, sci-fi arcade mine detonation, crackling electricity burst' },
  { id: 'combo-break', kind: 'sfx', duration: 0.5, maxMs: 450, gainDb: -4, influence: 0.6,
    prompt: 'Subtle glassy crack with a short downward whoosh, soft digital shatter, arcade game combo lost' },
  { id: 'milestone', kind: 'sfx', duration: 0.8, maxMs: 800, influence: 0.6,
    prompt: 'Sparkly ascending magical shimmer whoosh, bright glittering rising chimes, arcade game achievement' },
  { id: 'fail', kind: 'sfx', duration: 2.0, maxMs: 2200, influence: 0.6,
    prompt: 'Dramatic electronic power down, machine system failure, pitch dropping synth whine shutting off, arcade game over' },
  { id: 'clear-fanfare', kind: 'sfx', duration: 2.5, maxMs: 2800, influence: 0.5,
    prompt: 'Short triumphant arcade victory jingle, bright synth brass fanfare, retro video game stage clear' },
  { id: 'grade-slam', kind: 'sfx', duration: 0.8, maxMs: 900, influence: 0.6,
    prompt: 'Heavy cinematic impact hit, deep boom with metallic slam, trailer hit, no music' },
  { id: 'score-tick', kind: 'sfx', duration: 0.5, maxMs: 50, mono: true, gainDb: -6, influence: 0.9,
    prompt: 'One tiny short digital counter tick, single click of a score counter, very short, no reverb' },
  { id: 'whoosh', kind: 'sfx', duration: 0.5, maxMs: 450, gainDb: -2, influence: 0.7,
    prompt: 'Fast clean air swoosh, quick transition whoosh passing by, no music' },
  { id: 'eliminated', kind: 'sfx', duration: 0.7, maxMs: 700, influence: 0.6,
    prompt: 'Sci-fi player eliminated zap, laser disintegration with descending electronic tone, arcade' },

  // Announcer
  { id: 'vo-ready', kind: 'voice', text: 'Ready?', tag: 'excited' },
  { id: 'vo-go', kind: 'voice', text: 'Go!', tag: 'shouts' },
  { id: 'vo-full-combo', kind: 'voice', text: 'Full combo!', tag: 'shouts' },
  { id: 'vo-perfect-full-combo', kind: 'voice', text: 'Perfect full combo!', tag: 'shouts' },
  { id: 'vo-marvelous-full-combo', kind: 'voice', text: 'Marvelous full combo!', tag: 'shouts' },
  { id: 'vo-cleared', kind: 'voice', text: 'Stage cleared!', tag: 'shouts' },
  { id: 'vo-failed', kind: 'voice', text: 'Stage failed...', tag: 'disappointed' },
  { id: 'vo-new-record', kind: 'voice', text: 'New record!', tag: 'shouts' },
  { id: 'vo-combo-100', kind: 'voice', text: 'One hundred combo!', tag: 'shouts' },
  { id: 'vo-combo-200', kind: 'voice', text: 'Two hundred combo!', tag: 'shouts' },
  { id: 'vo-combo-500', kind: 'voice', text: 'Five hundred combo!', tag: 'shouts' },
  { id: 'vo-grade-aaaa', kind: 'voice', text: 'Quad A! Flawless!', tag: 'shouts' },
  { id: 'vo-grade-aaa', kind: 'voice', text: 'Triple A!', tag: 'shouts' },
  { id: 'vo-grade-aa', kind: 'voice', text: 'Double A!', tag: 'shouts' },
  { id: 'vo-grade-a', kind: 'voice', text: 'A rank!', tag: 'excited' },
  { id: 'vo-grade-b', kind: 'voice', text: 'B rank.', tag: 'confident' },
  { id: 'vo-grade-c', kind: 'voice', text: 'C rank.' }, // [neutral] is read aloud by v3
  { id: 'vo-grade-d', kind: 'voice', text: 'D rank...', tag: 'disappointed' },
  { id: 'vo-welcome', kind: 'voice', text: 'Stepmania ninety-nine!', tag: 'shouts' },

  // Music. Lyria has no tempo parameter, so the real tempo is measured and the loop is varispeeded to `bpm`.
  // The prompt asks for ~84 s so a 32-bar loop fits after MUSIC_SKIP_SEC and before the generation's ending.
  { id: 'music-menu', kind: 'music', bpm: 120, bars: 32,
    prompt: `Instrumental synthwave retro arcade menu music, 120 BPM, 4/4, constant tempo. Driving but not busy: warm analog pads, punchy drums with four-on-the-floor kick, pulsing synth bass, arpeggiated synth lead. Instrumental only, no vocals.
[0:00 - 1:24] One continuous groove at full steady energy from the first second to the last. No intro build, no breakdown, no stops or silent breaks, no drop, no outro, no fade in, no fade out, no ending.` },
];

const loopMs = (asset) => (asset.bars * 4 * 60_000) / asset.bpm;
const rawFile = (asset) => path.join(rawDir, `${asset.id}.${asset.kind === 'music' ? 'wav' : 'mp3'}`);

function parseArgs(argv) {
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1]?.split(',').filter(Boolean) : null;
  return { force: argv.includes('--force'), reprocess: argv.includes('--reprocess'), only };
}

function hasBinary(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function callApi(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateMusic(asset) {
  const res = await fetch(`${GEMINI_API}/interactions`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MUSIC_MODEL, input: asset.prompt, response_format: { type: 'audio', mime_type: 'audio/wav' } }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  const audio = json.steps?.flatMap((step) => step.content ?? []).find((c) => c.type === 'audio');
  if (!audio) throw new Error(`Lyria returned no audio (status ${json.status})`);
  return Buffer.from(audio.data, 'base64');
}

function generate(asset) {
  if (asset.kind === 'music') return generateMusic(asset);
  if (asset.kind === 'voice') {
    const text = asset.tag ? `[${asset.tag}] ${asset.text}` : asset.text;
    return callApi(`${API}/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      text,
      model_id: VOICE_MODEL,
      voice_settings: VOICE_SETTINGS,
    });
  }
  return callApi(`${API}/sound-generation?output_format=mp3_44100_128`, {
    text: asset.prompt,
    duration_seconds: asset.duration ?? null,
    prompt_influence: asset.influence ?? 0.5,
  });
}

function ffmpeg(args) {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) {
    throw new Error(`ffmpeg failed: ${e.stderr?.toString().slice(-500)}`);
  }
}

function measureLoudness(file) {
  // ffmpeg writes filter reports to stderr; route it to stdout through a shell to capture it on success.
  const res = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128,astats=metadata=0 -f null - 2>&1`]).toString();
  const lufs = Number(res.match(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/)?.[1]);
  const rms = Number(res.match(/Overall[\s\S]*?RMS level dB:\s+(-?[\d.]+)/)?.[1]);
  return { lufs, rms };
}

function durationMs(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  return Math.round(Number(out) * 1000);
}

function decode(file, channels = 1) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-ac', String(channels), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

const peakDb = (samples) => 20 * Math.log10(samples.reduce((m, s) => Math.max(m, Math.abs(s)), 1e-9));

// First sample louder than -40 dBFS in the decoded mp3, i.e. what a player actually hears after encoder delay handling.
function leadMs(samples) {
  const threshold = 10 ** (-40 / 20);
  const idx = samples.findIndex((s) => Math.abs(s) > threshold);
  return idx < 0 ? null : (idx / 44100) * 1000;
}

// Start of the first sustained sound, in seconds. A lone click (common at the head of TTS output)
// must not count as the onset, which is why plain silenceremove is not used for the head: its
// start_duration option would instead swallow the first milliseconds of the real attack.
function findOnset(samples, thresholdDb, sustainMs) {
  const win = 44; // ~1 ms
  const threshold = 10 ** (thresholdDb / 20);
  const loud = [];
  for (let i = 0; i < samples.length; i += win) {
    let m = 0;
    for (let j = i; j < Math.min(samples.length, i + win); j++) m = Math.max(m, Math.abs(samples[j]));
    loud.push(m > threshold);
  }
  const k = loud.findIndex((l, i) => l && loud.slice(i, i + sustainMs).filter(Boolean).length >= sustainMs / 2);
  if (k < 0) return 0;
  // Refine to the first loud sample inside the onset window so the transient sits at t=0.
  const first = samples.subarray(k * win, (k + 1) * win).findIndex((s) => Math.abs(s) > threshold);
  return (k * win + Math.max(0, first)) / 44100;
}

function postProcess(asset, rawPath, outPath) {
  const work = path.join(rawDir, `${asset.id}.work.wav`);
  // Head threshold is tight for SFX so the transient lands at t=0; voices use a softer threshold so
  // breathy consonants survive. The tail is trimmed by reversing and reusing silenceremove's start detector.
  const isVoice = asset.kind === 'voice';
  const onset = findOnset(decode(rawPath), asset.trimDb ?? (isVoice ? -45 : -40), isVoice ? 20 : 10);
  const filters = [
    `atrim=start=${onset.toFixed(5)}`,
    'asetpts=PTS-STARTPTS',
    'areverse',
    'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0',
    'areverse',
  ];
  if (asset.maxMs) {
    const end = asset.maxMs / 1000;
    const fade = (asset.fadeOutMs ?? Math.min(30, asset.maxMs / 4)) / 1000;
    filters.push(`atrim=end=${end}`, `afade=t=out:st=${(end - fade).toFixed(4)}:d=${fade.toFixed(4)}:curve=exp`);
  }
  // 1 ms fade-in removes the click from cutting mid-waveform without moving the transient.
  filters.push('afade=t=in:st=0:d=0.001');
  ffmpeg(['-i', rawPath, '-af', filters.join(','), '-ar', '44100', ...(asset.mono ? ['-ac', '1'] : []), work]);

  const { lufs, rms } = measureLoudness(work);
  // ebur128 integrates over 400 ms blocks; shorter clips report -70 LUFS, so fall back to RMS for ticks.
  const level = Number.isFinite(lufs) && lufs > -69 ? lufs : rms;
  const target = TARGET_LUFS[asset.kind] + (asset.gainDb ?? 0);
  // Linear gain capped by peak headroom instead of a limiter: limiters add lookahead latency,
  // which would push transients off t=0. MP3 encoding overshoots, so the cap is re-checked on the decoded output.
  let gain = Math.min(target - level, PEAK_CEILING_DB - peakDb(decode(work)));
  let samples;
  for (let attempt = 0; attempt < 4; attempt++) {
    ffmpeg(['-i', work, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-b:a', asset.mono ? '96k' : '128k', '-ar', '44100', outPath]);
    samples = decode(outPath);
    const overshoot = peakDb(samples) - PEAK_CEILING_DB;
    if (overshoot <= 0) break;
    gain -= overshoot + 0.1;
  }
  fs.rmSync(work, { force: true });
  return { level, target, gain, peak: peakDb(samples), lead: leadMs(samples), peakCapped: gain < target - level - 0.05 };
}

function sampleRate(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file]).toString());
}

// In-place iterative radix-2 FFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// Log energies in 32 log-spaced bands per frame, plus spectral flux.
function spectralFeatures(samples, sr, hop = 128, size = 1024) {
  const nBands = 32;
  const edges = Array.from({ length: nBands + 1 }, (_, b) => Math.round((40 * (16000 / 40) ** (b / nBands) * size) / sr));
  const window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const frames = Math.floor((samples.length - size) / hop);
  const bands = new Float32Array(frames * nBands);
  const flux = new Float32Array(frames);
  const level = new Float32Array(frames);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) {
      re[i] = samples[f * hop + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    let total = 0;
    for (let b = 0; b < nBands; b++) {
      let e = 0;
      for (let k = edges[b]; k < Math.max(edges[b + 1], edges[b] + 1); k++) e += re[k] * re[k] + im[k] * im[k];
      total += e;
      const v = Math.log10(e + 1e-6);
      bands[f * nBands + b] = v;
      if (f > 0) flux[f] += Math.max(0, v - bands[(f - 1) * nBands + b]);
    }
    level[f] = 10 * Math.log10(total + 1e-12);
  }
  // Frame f covers samples [f*hop, f*hop+size); its onset response is centred, hence the offset.
  return { bands, nBands, flux, level, frames, hopSec: hop / sr, offsetSec: size / 2 / sr };
}

const interp = (arr, x) => {
  const i = Math.floor(x);
  return i < 0 || i + 1 >= arr.length ? 0 : arr[i] + (arr[i + 1] - arr[i]) * (x - i);
};

// Vertex of the parabola through (−1, a), (0, b), (1, c): sub-frame refinement of a discrete maximum.
const parabolic = (a, b, c) => (a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c));

function pearson(x, y) {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy + 1e-12);
}

// Finds a loop of exactly bars*4 beats starting on a (detected) downbeat, choosing the start whose
// continuation after one loop length looks most like the start itself, so the seam is musically continuous.
function findLoop(feat, asset) {
  const { flux, level, frames, hopSec, offsetSec, bands, nBands } = feat;
  const sorted = Array.from(level).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  // Usable audio ends where the smoothed level falls 6 dB under the median (the generation's ending/fade).
  const smooth = Math.round(1 / hopSec);
  let usableEnd = frames - 1;
  while (usableEnd > smooth) {
    let m = 0;
    for (let i = usableEnd - smooth; i < usableEnd; i++) m += level[i];
    if (m / smooth >= median - 6) break;
    usableEnd -= smooth >> 2;
  }

  const t0 = Math.round(MUSIC_SKIP_SEC / hopSec);
  // Beat period from the flux autocorrelation, searched within 100–150 BPM.
  const acf = (lag) => {
    let s = 0;
    for (let i = t0; i + lag < usableEnd; i++) s += flux[i] * flux[i + lag];
    return s;
  };
  const lags = [];
  for (let lag = Math.floor(0.4 / hopSec); lag <= Math.ceil(0.6 / hopSec); lag++) lags.push([lag, acf(lag)]);
  const best = lags.reduce((a, b) => (b[1] > a[1] ? b : a));
  const period = best[0] + parabolic(acf(best[0] - 1), best[1], acf(best[0] + 1));

  // Beat phase: the grid offset that collects the most onset energy.
  let phase = 0;
  let phaseScore = -1;
  for (let p = 0; p < period; p += 0.25) {
    let s = 0;
    for (let t = t0 + p; t < usableEnd; t += period) s += interp(flux, t);
    if (s > phaseScore) [phase, phaseScore] = [p, s];
  }
  // Downbeat: chords change on bar lines, so pick the beat (mod 4) where the average spectrum of the
  // beat differs most from the previous beat. A four-on-the-floor kick carries no bar accent to use instead.
  const beatMean = (t) => {
    const v = new Float32Array(nBands);
    const from = Math.round(t);
    for (let f = from; f < from + Math.round(period); f++) for (let b = 0; b < nBands; b++) v[b] += bands[f * nBands + b];
    return v;
  };
  const changeByBeat = [0, 1, 2, 3].map((m) => {
    let s = 0;
    let n = 0;
    for (let t = t0 + phase + (m + 4) * period; t + period < usableEnd; t += 4 * period) {
      s += 1 - pearson(beatMean(t - period), beatMean(t));
      n++;
    }
    return s / n;
  });
  const downbeat = changeByBeat.indexOf(Math.max(...changeByBeat));

  const beats = asset.bars * 4;
  const nominal = beats * period;
  const win = Math.round(4 / hopSec);
  const slice = (start) => {
    const out = new Float32Array(win * (nBands + 1));
    for (let i = 0; i < win; i++) {
      const f = Math.round(start) + i;
      for (let b = 0; b < nBands; b++) out[i * (nBands + 1) + b] = bands[f * nBands + b];
      out[i * (nBands + 1) + nBands] = flux[f] * 4;
    }
    return out;
  };
  // Lyria sometimes inserts a full stop (digital silence for about a beat) mid-groove; under a menu that
  // sounds like a glitch every loop, so windows containing one are rejected.
  const dropFrames = Math.round(0.1 / hopSec);
  const hasDropout = (from, to) => {
    let run = 0;
    for (let f = Math.floor(from); f < Math.min(to, frames); f++) {
      run = level[f] < median - 30 ? run + 1 : 0;
      if (run >= dropFrames) return true;
    }
    return false;
  };
  let pick = null;
  for (let start = t0 + phase + downbeat * period; start + nominal + win + 10 < usableEnd; start += 4 * period) {
    if (hasDropout(start, start + nominal + win)) continue;
    const head = slice(start);
    const scores = [];
    for (let d = -40; d <= 40; d++) scores.push(pearson(head, slice(start + nominal + d)));
    const i = scores.indexOf(Math.max(...scores));
    const refined = i > 0 && i < scores.length - 1 ? parabolic(scores[i - 1], scores[i], scores[i + 1]) : 0;
    const candidate = { start, length: nominal + (i - 40) + refined, score: scores[i] };
    if (!pick || candidate.score > pick.score) pick = candidate;
  }
  if (!pick) throw new LoopError(`no dropout-free ${asset.bars}-bar window between ${MUSIC_SKIP_SEC}s and ${(usableEnd * hopSec).toFixed(1)}s`);
  return {
    // The seam sits one crossfade before the downbeat, so the crossfade is over by the time the beat hits.
    startSec: pick.start * hopSec + offsetSec - MUSIC_XFADE_SEC,
    lengthSec: pick.length * hopSec,
    score: pick.score,
    measuredBpm: (60 * beats) / (pick.length * hopSec),
    gridBpm: 60 / (period * hopSec),
    changeByBeat,
    usableEndSec: usableEnd * hopSec,
  };
}

class LoopError extends Error {}

function postProcessMusic(asset, rawPath, outPath) {
  const sr = sampleRate(rawPath);
  const loop = findLoop(spectralFeatures(decode(rawPath), sr), asset);
  const outRate = 44100;
  const n = Math.round((loopMs(asset) / 1000) * outRate);
  const pad = Math.round((MUSIC_PAD_MS / 1000) * outRate);
  const xfade = Math.round(MUSIC_XFADE_SEC * outRate);

  // Varispeed (resample) the measured loop so it lasts exactly bars at asset.bpm. ffmpeg here has no
  // rubberband, and atempo's WSOLA smears drum transients; varispeed only shifts pitch by the same tiny ratio.
  const stretched = path.join(rawDir, `${asset.id}.stretched.f32`);
  const rate = (sr * loop.lengthSec) / (loopMs(asset) / 1000);
  ffmpeg([
    '-i', rawPath,
    '-af', `atrim=start=${loop.startSec.toFixed(6)}:end=${(loop.startSec + loop.lengthSec + 0.2).toFixed(6)},asetpts=PTS-STARTPTS,asetrate=${rate.toFixed(4)},aresample=${outRate}`,
    '-ac', '2', '-f', 'f32le', stretched,
  ]);
  const raw = fs.readFileSync(stretched);
  fs.rmSync(stretched, { force: true });
  const y = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  if (y.length / 2 < n + xfade) throw new Error('stretched audio shorter than loop + crossfade');

  // Equal-power crossfade into the head from the audio that follows the loop end, so the sample after
  // the loop's last one is its true continuation: the seam needs no fade at either end.
  const body = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      if (i < xfade) {
        const th = (Math.PI / 2) * (i / xfade);
        body[i * 2 + c] = y[i * 2 + c] * Math.sin(th) + y[(n + i) * 2 + c] * Math.cos(th);
      } else body[i * 2 + c] = y[i * 2 + c];
    }
  }
  const file = new Float32Array((n + 2 * pad) * 2);
  file.set(body.subarray((n - pad) * 2), 0);
  file.set(body, pad * 2);
  file.set(body.subarray(0, pad * 2), (n + pad) * 2);

  const work = path.join(rawDir, `${asset.id}.work.wav`);
  const workRaw = path.join(rawDir, `${asset.id}.work.f32`);
  fs.writeFileSync(workRaw, Buffer.from(file.buffer));
  ffmpeg(['-f', 'f32le', '-ar', String(outRate), '-ac', '2', '-i', workRaw, '-c:a', 'pcm_f32le', work]);
  fs.rmSync(workRaw, { force: true });

  const { lufs } = measureLoudness(work);
  const target = TARGET_LUFS.music + (asset.gainDb ?? 0);
  let gain = Math.min(target - lufs, PEAK_CEILING_DB - peakDb(decode(work, 2)));
  let samples;
  for (let attempt = 0; attempt < 4; attempt++) {
    ffmpeg(['-i', work, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', String(outRate), outPath]);
    samples = decode(outPath, 2);
    const overshoot = peakDb(samples) - PEAK_CEILING_DB;
    if (overshoot <= 0) break;
    gain -= overshoot + 0.1;
  }
  fs.rmSync(work, { force: true });
  return { loop, lufs, target, gain, peak: peakDb(samples), checks: checkLoop(samples, pad, n) };
}

// Seam diagnostics on the decoded MP3 (stereo interleaved): loop points must see identical audio,
// the jump across the seam must look like any other sample step, and head/tail levels must match (no fades).
function checkLoop(samples, start, n) {
  const ch = 2;
  const at = (i, c) => samples[i * ch + c];
  const rms = (from, len) => {
    let s = 0;
    for (let i = from; i < from + len; i++) for (let c = 0; c < ch; c++) s += at(i, c) ** 2;
    return 10 * Math.log10(s / (len * ch) + 1e-12);
  };
  const w50 = Math.round(0.05 * 44100);
  // Audio after loopEnd is the periodic extension of audio after loopStart: their difference is codec noise only.
  let sig = 0;
  let diff = 0;
  for (let i = 0; i < w50; i++) {
    for (let c = 0; c < ch; c++) {
      sig += at(start + i, c) ** 2;
      diff += (at(start + n + i, c) - at(start + i, c)) ** 2;
    }
  }
  const steps = [];
  for (let i = start + 1; i < start + n; i++) steps.push(Math.abs(at(i, 0) - at(i - 1, 0)));
  steps.sort((a, b) => a - b);
  const seamStep = Math.max(...[0, 1].map((c) => Math.abs(at(start, c) - at(start + n - 1, c))));
  return {
    headRmsDb: rms(start, w50),
    tailRmsDb: rms(start + n - w50, w50),
    periodicSnrDb: 10 * Math.log10(sig / (diff + 1e-12)),
    seamStep,
    p99Step: steps[Math.floor(steps.length * 0.99)],
    maxStep: steps[steps.length - 1],
  };
}

async function main() {
  if (typeof fetch !== 'function') throw new Error('Node 20+ required (global fetch)');
  const { force, reprocess, only } = parseArgs(process.argv.slice(2));
  const known = new Set(ASSETS.map((a) => a.id));
  const unknown = (only ?? []).filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown ids: ${unknown.join(', ')}`);

  const canProcess = hasBinary('ffmpeg') && hasBinary('ffprobe');
  if (!canProcess) console.warn('WARN: ffmpeg/ffprobe not found — skipping post-processing; durationMs will be null');

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const targets = ASSETS.filter((a) => {
    if (only) return only.includes(a.id);
    return force || reprocess || !fs.existsSync(path.join(outDir, `${a.id}.mp3`));
  });
  const needsApi = targets.filter((a) => !reprocess || !fs.existsSync(rawFile(a)));
  if (needsApi.some((a) => a.kind !== 'music') && !process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set');
  if (needsApi.some((a) => a.kind === 'music') && !process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');

  for (const asset of targets) {
    const rawPath = rawFile(asset);
    const outPath = path.join(outDir, `${asset.id}.mp3`);
    const fresh = !(reprocess && fs.existsSync(rawPath));
    if (fresh) fs.writeFileSync(rawPath, await generate(asset));
    if (!canProcess) {
      fs.copyFileSync(rawPath, outPath);
      console.log(`${asset.id}: raw (unprocessed)`);
      continue;
    }
    if (asset.kind === 'music') {
      // Generations are not always loopable (see findLoop); retry fresh ones a few times before giving up.
      let result;
      for (let attempt = 1; !result; attempt++) {
        try {
          result = postProcessMusic(asset, rawPath, outPath);
        } catch (e) {
          if (!(e instanceof LoopError) || !fresh || attempt >= 3) throw e;
          console.log(`${asset.id}: attempt ${attempt} rejected (${e.message}), regenerating`);
          fs.writeFileSync(rawPath, await generate(asset));
        }
      }
      const { loop, lufs, gain, peak, checks } = result;
      console.log(
        `${asset.id}: ${durationMs(outPath)} ms, loop src ${loop.startSec.toFixed(3)}s +${loop.lengthSec.toFixed(4)}s ` +
          `(measured ${loop.measuredBpm.toFixed(3)} BPM, grid ${loop.gridBpm.toFixed(2)}, seam match r=${loop.score.toFixed(3)}, ` +
          `spectral change by beat ${loop.changeByBeat.map((k) => k.toFixed(3)).join('/')}, usable until ${loop.usableEndSec.toFixed(1)}s), ` +
          `${lufs.toFixed(1)} LUFS → gain ${gain.toFixed(1)} dB, peak ${peak.toFixed(1)} dB\n  checks ${JSON.stringify(checks)}`,
      );
      continue;
    }
    const r = postProcess(asset, rawPath, outPath);
    console.log(
      `${asset.id}: ${durationMs(outPath)} ms, lead ${r.lead?.toFixed(1) ?? 'silent'} ms, peak ${r.peak.toFixed(1)} dB, ` +
        `level ${r.level.toFixed(1)} → target ${r.target} (gain ${r.gain.toFixed(1)} dB${r.peakCapped ? ', peak-capped' : ''})`,
    );
  }

  const previousManifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const assets = Object.fromEntries(
    ASSETS.filter((a) => fs.existsSync(path.join(outDir, `${a.id}.mp3`))).map((a) => {
      const file = `${a.id}.mp3`;
      const entry = { file, kind: a.kind, durationMs: canProcess ? durationMs(path.join(outDir, file)) : null };
      // Loop points are fixed by construction (periodic padding of MUSIC_PAD_MS around an exact loop).
      if (a.kind === 'music') Object.assign(entry, { bpm: a.bpm, loopStartMs: MUSIC_PAD_MS, loopEndMs: MUSIC_PAD_MS + loopMs(a) });
      // Where the beat grid sits in the file is measured per generation (see report): keep the stored value
      const beatOffsetMs = previousManifest?.assets?.[a.id]?.beatOffsetMs;
      if (a.kind === 'music' && beatOffsetMs !== undefined) entry.beatOffsetMs = beatOffsetMs;
      return [a.id, entry];
    }),
  );
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, voiceId: VOICE_ID, assets }, null, 2) + '\n');
  console.log(`manifest: ${Object.keys(assets).length}/${ASSETS.length} assets`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
