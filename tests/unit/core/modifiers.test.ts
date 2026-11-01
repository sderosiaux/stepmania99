import { describe, it, expect } from 'vitest';
import { removeHands } from '../../../src/core/modifiers';
import type { Note, NoteType } from '../../../src/types';
import { DIRECTIONS } from '../../../src/types';

let nextId = 0;
const note = (lane: number, time: number, type: NoteType = 'tap', endTime?: number): Note => ({
  id: nextId++,
  time,
  beat: time / 500,
  lane,
  direction: DIRECTIONS[lane]!,
  type,
  quant: 4,
  ...(endTime !== undefined ? { endTime, endBeat: endTime / 500 } : {}),
});

const rows = (notes: readonly Note[]) => notes.map((n) => `${n.time}:${n.lane}${n.type === 'tap' ? '' : n.type[0]}`);

describe('removeHands', () => {
  it('keeps singles and jumps as they are', () => {
    const chart = [note(0, 0), note(1, 500), note(2, 500), note(3, 1000)];
    expect(removeHands(chart)).toEqual(chart);
  });

  it('turns hands and quads into jumps, dropping the leftmost arrows', () => {
    const chart = [note(0, 0), note(1, 0), note(3, 0), note(0, 500), note(1, 500), note(2, 500), note(3, 500)];
    expect(rows(removeHands(chart))).toEqual(['0:1', '0:3', '500:2', '500:3']);
  });

  it('counts a hold still held as a pressed arrow', () => {
    const chart = [note(0, 0, 'hold', 2000), note(1, 1000), note(2, 1000), note(3, 3000)];
    expect(rows(removeHands(chart))).toEqual(['0:0h', '1000:2', '3000:3']);
  });

  it('frees the lane once the hold has ended', () => {
    const chart = [note(0, 0, 'hold', 1000), note(1, 1000), note(2, 1000)];
    expect(rows(removeHands(chart))).toEqual(['0:0h', '1000:1', '1000:2']);
  });

  it('does not count a hold that was removed', () => {
    // Row 0 is a hand: the hold on lane 0 goes, so it doesn't hold lane 0 down at 500
    const chart = [note(0, 0, 'hold', 2000), note(1, 0), note(2, 0), note(1, 500), note(3, 500)];
    expect(rows(removeHands(chart))).toEqual(['0:1', '0:2', '500:1', '500:3']);
  });

  it('leaves mines alone: they are not pressed', () => {
    const chart = [note(0, 0, 'mine'), note(1, 0), note(2, 0), note(3, 0, 'mine')];
    expect(removeHands(chart)).toEqual(chart);
  });
});
