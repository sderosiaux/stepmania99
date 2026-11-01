import { describe, it, expect } from 'vitest';
import { Jukebox } from '../../../src/core/jukebox';
import type { SongEntry } from '../../../src/core/manifest';

const entry = (id: string, silent = false): SongEntry => ({
  id,
  pack: 'P',
  path: `P/${id}`,
  file: `${id}.sm`,
  title: id,
  artist: 'A',
  musicFile: `${id}.ogg`,
  ...(silent ? { silent: true } : {}),
  previewStart: 0,
  previewLength: 12,
  bpmMin: 120,
  bpmMax: 120,
  timing: { offset: 0, bpms: [{ beat: 0, bpm: 120 }], stops: [] } as unknown as SongEntry['timing'],
  charts: [{ difficulty: 'Medium', level: 5, steps: 100 }],
});

/** Deterministic PRNG so shuffles are reproducible */
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const draw = (box: Jukebox, n: number) => Array.from({ length: n }, () => box.next()?.id ?? null);

describe('Jukebox', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map((id) => entry(id));

  it('plays every song once before any repeats', () => {
    const box = new Jukebox(pool, () => new Set(), seeded(7));
    for (let round = 0; round < 4; round++) {
      expect(new Set(draw(box, pool.length))).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
    }
  });

  it('never opens a new round with the song that just ended', () => {
    for (let seed = 1; seed < 200; seed++) {
      const box = new Jukebox(pool, () => new Set(), seeded(seed));
      const ids = draw(box, pool.length * 3);
      ids.forEach((id, i) => i > 0 && expect(id).not.toBe(ids[i - 1]));
    }
  });

  it('skips forgotten songs, including ones forgotten mid-round', () => {
    const forgotten = new Set(['b']);
    const box = new Jukebox(pool, () => forgotten, seeded(3));
    const first = draw(box, 2);
    expect(first).not.toContain('b');
    const [dropped, kept] = ['a', 'c', 'd', 'e'].filter((id) => !first.includes(id)) as [string, string];
    forgotten.add(dropped);
    expect(draw(box, 1)).toEqual([kept]);
    // Next round: everyone but the two forgotten
    expect(new Set(draw(box, 3))).toEqual(new Set([...first, kept]));
  });

  it('leaves out songs without audio', () => {
    const box = new Jukebox([entry('x', true), entry('y')], () => new Set(), seeded(5));
    expect(draw(box, 3)).toEqual(['y', 'y', 'y']);
  });

  it('goes back through the songs played, then forward again before drawing new ones', () => {
    const box = new Jukebox(pool, () => new Set(), seeded(11));
    const [a, b, c] = draw(box, 3);
    expect(box.previous()?.id).toBe(b);
    expect(box.previous()?.id).toBe(a);
    expect(box.previous()).toBeNull();
    expect(box.current?.id).toBe(a);
    expect(draw(box, 2)).toEqual([b, c]);
    const fresh = box.next()!.id;
    expect([a, b, c]).not.toContain(fresh);
  });

  it('skips forgotten songs when going back or forward', () => {
    const forgotten = new Set<string>();
    const box = new Jukebox(pool, () => forgotten, seeded(13));
    const [a, b, c] = draw(box, 3) as [string, string, string];
    forgotten.add(b);
    expect(box.previous()?.id).toBe(a);
    expect(box.next()?.id).toBe(c);
  });

  it('plays a song brought back right after the current one', () => {
    const box = new Jukebox(pool, () => new Set(), seeded(17));
    const [a, b] = draw(box, 2);
    box.previous();
    expect(box.playNow(pool.find((e) => e.id === 'e')!).id).toBe('e');
    expect(box.previous()?.id).toBe(a);
    expect(draw(box, 2)).toEqual(['e', b]);
  });

  it('returns null when nothing is left to play', () => {
    expect(new Jukebox([], () => new Set()).next()).toBeNull();
    expect(new Jukebox(pool, () => new Set(pool.map((e) => e.id))).next()).toBeNull();
    expect(new Jukebox([entry('x', true)], () => new Set()).next()).toBeNull();
  });
});
