// Usage: ELEVENLABS_API_KEY=... node scripts/generate-sfx.mjs [--force] [--only id1,id2] [--reprocess]

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

// Integrated-loudness targets (LUFS) per kind; gainDb is an offset from these.
const TARGET_LUFS = { voice: -16, sfx: -18 };
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
];

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

function generate(asset) {
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

function decode(file) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
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
  if (targets.some((a) => !reprocess || !fs.existsSync(path.join(rawDir, `${a.id}.mp3`))) && !process.env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  for (const asset of targets) {
    const rawPath = path.join(rawDir, `${asset.id}.mp3`);
    const outPath = path.join(outDir, `${asset.id}.mp3`);
    if (!(reprocess && fs.existsSync(rawPath))) {
      fs.writeFileSync(rawPath, await generate(asset));
    }
    if (!canProcess) {
      fs.copyFileSync(rawPath, outPath);
      console.log(`${asset.id}: raw (unprocessed)`);
      continue;
    }
    const r = postProcess(asset, rawPath, outPath);
    console.log(
      `${asset.id}: ${durationMs(outPath)} ms, lead ${r.lead?.toFixed(1) ?? 'silent'} ms, peak ${r.peak.toFixed(1)} dB, ` +
        `level ${r.level.toFixed(1)} → target ${r.target} (gain ${r.gain.toFixed(1)} dB${r.peakCapped ? ', peak-capped' : ''})`,
    );
  }

  const assets = Object.fromEntries(
    ASSETS.filter((a) => fs.existsSync(path.join(outDir, `${a.id}.mp3`))).map((a) => {
      const file = `${a.id}.mp3`;
      return [a.id, { file, kind: a.kind, durationMs: canProcess ? durationMs(path.join(outDir, file)) : null }];
    }),
  );
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, voiceId: VOICE_ID, assets }, null, 2) + '\n');
  console.log(`manifest: ${Object.keys(assets).length}/${ASSETS.length} assets`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
