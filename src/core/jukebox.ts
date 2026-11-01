import type { SongEntry } from './manifest';

// ============================================================================
// Jukebox: songs play themselves (autoplay) one after another, shuffled.
// A shuffle bag: every song plays once before any repeats. Songs skipped as
// "not for me" are left out, even mid-round; the caller persists that list.
// The session's history lets the player go back, then forward again, before
// new songs are drawn.
// ============================================================================

export class Jukebox {
  private bag: SongEntry[] = [];
  private lastDrawn: string | null = null;
  /** Songs played this session, in order; `pos` is the one playing */
  private history: SongEntry[] = [];
  private pos = -1;

  constructor(
    private readonly pool: readonly SongEntry[],
    private readonly forgotten: () => ReadonlySet<string>,
    private readonly random: () => number = Math.random
  ) {}

  get current(): SongEntry | null {
    return this.history[this.pos] ?? null;
  }

  /** Forward through songs already played, then a fresh draw; null when every song is forgotten or silent */
  next(): SongEntry | null {
    const skip = this.forgotten();
    for (let i = this.pos + 1; i < this.history.length; i++) if (!skip.has(this.history[i]!.id)) return this.moveTo(i);
    const e = this.draw(skip);
    if (!e) return null;
    this.history.push(e);
    return this.moveTo(this.history.length - 1);
  }

  /** Back through this session's songs; null at the first one */
  previous(): SongEntry | null {
    const skip = this.forgotten();
    for (let i = this.pos - 1; i >= 0; i--) if (!skip.has(this.history[i]!.id)) return this.moveTo(i);
    return null;
  }

  /** Play a song now (a skip undone): it goes in the history right after the current one */
  playNow(entry: SongEntry): SongEntry {
    this.history.splice(this.pos + 1, 0, entry);
    return this.moveTo(this.pos + 1);
  }

  private moveTo(i: number): SongEntry {
    this.pos = i;
    return this.history[i]!;
  }

  private draw(skip: ReadonlySet<string>): SongEntry | null {
    for (let refill = 0; refill < 2; refill++) {
      while (this.bag.length) {
        const e = this.bag.pop()!;
        if (skip.has(e.id)) continue;
        this.lastDrawn = e.id;
        return e;
      }
      this.refill(skip);
    }
    return null;
  }

  private refill(skip: ReadonlySet<string>): void {
    const bag = this.pool.filter((e) => !e.silent && !skip.has(e.id));
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
    // The bag is drawn from the end: a new round never opens with the song that just ended
    const top = bag.length - 1;
    if (top > 0 && bag[top]!.id === this.lastDrawn) [bag[0], bag[top]] = [bag[top]!, bag[0]!];
    this.bag = bag;
  }
}
