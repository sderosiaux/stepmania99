import { describe, it, expect, beforeEach } from 'vitest';
import { getPlays, recordPlay } from '../../../src/ui/storage';

describe('play counts', () => {
  beforeEach(() => localStorage.clear());

  it('start from history: one play per chart with a record or a last run, at its latest date', () => {
    localStorage.setItem(
      'sm99.scores.v2',
      JSON.stringify({ 'P/Song::Hard': { grade: 'A', score: 1, date: 50 }, 'P/Other::Easy': { grade: 'B', score: 1, date: 10 } })
    );
    localStorage.setItem(
      'sm99.lastrun.v1',
      JSON.stringify({ 'P/Song::Hard': { errors: [], date: 70 }, 'P/Song::Challenge': { errors: [], date: 60 } })
    );
    expect(getPlays()).toEqual({ 'P/Song': { count: 2, last: 70 }, 'P/Other': { count: 1, last: 10 } });
  });

  it('history is read once: later plays add to the stored counts', () => {
    localStorage.setItem('sm99.lastrun.v1', JSON.stringify({ 'P/Song::Hard': { errors: [], date: 70 } }));
    recordPlay('P/Song');
    recordPlay('P/New');
    localStorage.setItem('sm99.lastrun.v1', JSON.stringify({ 'P/Song::Hard': { errors: [], date: 90 }, 'P/X::Easy': { errors: [], date: 90 } }));
    const plays = getPlays();
    expect(plays['P/Song']!.count).toBe(2);
    expect(plays['P/New']!.count).toBe(1);
    expect(plays['P/X']).toBeUndefined();
  });

  it('nothing played yet: no counts', () => {
    expect(getPlays()).toEqual({});
  });
});
