import type { Note } from '../types';

/**
 * No hands (StepMania's RemoveSimultaneousNotes): never more than `maxPressed` arrows down at once.
 * A hold still being held counts as one. Extra arrows on a row go, leftmost first, as StepMania does;
 * mines stay (nothing is pressed for them).
 */
export function removeHands(notes: readonly Note[], maxPressed = 2): Note[] {
  const kept: Note[] = [];
  /** Tail times of the holds and rolls kept so far */
  const holdEnds: number[] = [];
  for (let i = 0; i < notes.length; ) {
    const t = notes[i]!.time;
    const row: Note[] = [];
    while (i < notes.length && notes[i]!.time === t) row.push(notes[i++]!);
    const held = holdEnds.filter((end) => end > t).length;
    const presses = row.filter((n) => n.type !== 'mine').sort((a, b) => a.lane - b.lane);
    const drop = new Set(presses.slice(0, Math.max(0, held + presses.length - maxPressed)));
    for (const n of row) {
      if (drop.has(n)) continue;
      kept.push(n);
      if (n.endTime !== undefined) holdEnds.push(n.endTime);
    }
  }
  return kept;
}
