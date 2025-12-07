import { describe, it, expect } from 'vitest';
import {
  createScoreState,
  getComboMultiplier,
  applyJudgment,
  calculateFinalScore,
  calculatePercentage,
  calculateGrade,
} from '../../../src/core/score';
import type { Judgment } from '../../../src/types';

describe('Score System', () => {
  describe('createScoreState', () => {
    it('initializes with correct values', () => {
      const state = createScoreState(100);

      expect(state.rawScore).toBe(0);
      expect(state.combo).toBe(0);
      expect(state.maxCombo).toBe(0);
      expect(state.totalNotes).toBe(100);
      expect(state.judgmentCounts.marvelous).toBe(0);
    });
  });

  describe('getComboMultiplier', () => {
    it('returns 1x for combo < 10', () => {
      expect(getComboMultiplier(0)).toBe(1);
      expect(getComboMultiplier(5)).toBe(1);
      expect(getComboMultiplier(9)).toBe(1);
    });

    it('returns 2x for combo 10-19', () => {
      expect(getComboMultiplier(10)).toBe(2);
      expect(getComboMultiplier(15)).toBe(2);
      expect(getComboMultiplier(19)).toBe(2);
    });

    it('returns 3x for combo 20-29', () => {
      expect(getComboMultiplier(20)).toBe(3);
      expect(getComboMultiplier(25)).toBe(3);
      expect(getComboMultiplier(29)).toBe(3);
    });

    it('returns 4x (max) for combo 30+', () => {
      expect(getComboMultiplier(30)).toBe(4);
      expect(getComboMultiplier(100)).toBe(4);
      expect(getComboMultiplier(1000)).toBe(4);
    });
  });

  describe('applyJudgment', () => {
    const createJudgment = (grade: Judgment['grade']): Judgment => ({
      noteId: 1,
      timingDiff: 0,
      grade,
      time: 1000,
    });

    it('increments combo on marvelous', () => {
      let state = createScoreState(10);
      state = applyJudgment(state, createJudgment('marvelous'));

      expect(state.combo).toBe(1);
      expect(state.maxCombo).toBe(1);
      expect(state.judgmentCounts.marvelous).toBe(1);
    });

    it('increments combo on perfect', () => {
      let state = createScoreState(10);
      state = applyJudgment(state, createJudgment('perfect'));

      expect(state.combo).toBe(1);
    });

    it('increments combo on great', () => {
      let state = createScoreState(10);
      state = applyJudgment(state, createJudgment('great'));

      expect(state.combo).toBe(1);
    });

    it('breaks combo on good (too inaccurate to maintain)', () => {
      let state = createScoreState(10);
      state.combo = 50;
      state = applyJudgment(state, createJudgment('good'));

      expect(state.combo).toBe(0);
    });

    it('breaks combo on boo', () => {
      let state = createScoreState(10);
      state.combo = 50;
      state = applyJudgment(state, createJudgment('boo'));

      expect(state.combo).toBe(0);
      expect(state.judgmentCounts.boo).toBe(1);
    });

    it('breaks combo on miss', () => {
      let state = createScoreState(10);
      state.combo = 25;
      state.maxCombo = 25;
      state = applyJudgment(state, createJudgment('miss'));

      expect(state.combo).toBe(0);
      expect(state.maxCombo).toBe(25); // Max combo preserved
      expect(state.judgmentCounts.miss).toBe(1);
    });

    it('tracks max combo correctly', () => {
      let state = createScoreState(10);

      // Build up combo
      for (let i = 0; i < 15; i++) {
        state = applyJudgment(state, createJudgment('marvelous'));
      }
      expect(state.maxCombo).toBe(15);

      // Break combo
      state = applyJudgment(state, createJudgment('miss'));
      expect(state.combo).toBe(0);
      expect(state.maxCombo).toBe(15);

      // Build up again
      for (let i = 0; i < 10; i++) {
        state = applyJudgment(state, createJudgment('marvelous'));
      }
      expect(state.maxCombo).toBe(15); // Still 15

      // Exceed previous max
      for (let i = 0; i < 10; i++) {
        state = applyJudgment(state, createJudgment('marvelous'));
      }
      expect(state.maxCombo).toBe(20); // Now 20
    });
  });

  describe('calculateFinalScore', () => {
    it('returns max score for all marvelous', () => {
      let state = createScoreState(100);

      for (let i = 0; i < 100; i++) {
        state = applyJudgment(state, { noteId: i, timingDiff: 0, grade: 'marvelous', time: i * 100 });
      }

      const score = calculateFinalScore(state);
      expect(score).toBe(1_000_000);
    });

    it('returns 0 for all misses', () => {
      let state = createScoreState(10);

      for (let i = 0; i < 10; i++) {
        state = applyJudgment(state, { noteId: i, timingDiff: 200, grade: 'miss', time: i * 100 });
      }

      const score = calculateFinalScore(state);
      expect(score).toBe(0);
    });

    it('calculates proportional score for mixed judgments', () => {
      let state = createScoreState(4);

      state = applyJudgment(state, { noteId: 0, timingDiff: 0, grade: 'marvelous', time: 0 }); // 100%
      state = applyJudgment(state, { noteId: 1, timingDiff: 30, grade: 'perfect', time: 100 }); // 98%
      state = applyJudgment(state, { noteId: 2, timingDiff: 60, grade: 'great', time: 200 }); // 65%
      state = applyJudgment(state, { noteId: 3, timingDiff: 200, grade: 'miss', time: 300 }); // 0%

      const score = calculateFinalScore(state);
      // (100 + 98 + 65 + 0) / 400 * 1000000 = 657500
      expect(score).toBe(657500);
    });

    it('returns 0 for empty song', () => {
      const state = createScoreState(0);
      expect(calculateFinalScore(state)).toBe(0);
    });
  });

  describe('calculatePercentage', () => {
    it('returns 100 for all marvelous', () => {
      let state = createScoreState(10);
      state.judgmentCounts.marvelous = 10;

      expect(calculatePercentage(state)).toBe(100);
    });

    it('returns 0 for all misses', () => {
      let state = createScoreState(10);
      state.judgmentCounts.miss = 10;

      expect(calculatePercentage(state)).toBe(0);
    });

    it('cannot exceed 100% with many hold notes (2 judgments per hold)', () => {
      // Simulate a chart with 5 tap notes + 5 hold notes
      // Hold notes generate 2 judgments each (head + tail)
      // Total judgments = 5 taps + 5 holds * 2 = 15
      const totalJudgments = 15;
      let state = createScoreState(totalJudgments);

      // All 15 judgments are marvelous (best possible)
      for (let i = 0; i < totalJudgments; i++) {
        state = applyJudgment(state, { noteId: i, timingDiff: 0, grade: 'marvelous', time: i * 100 });
      }

      const percentage = calculatePercentage(state);
      expect(percentage).toBe(100);
      expect(percentage).toBeLessThanOrEqual(100);
    });

    it('calculates correct percentage for hold-heavy chart with mixed judgments', () => {
      // 10 hold notes = 20 judgments (head + tail each)
      const totalJudgments = 20;
      let state = createScoreState(totalJudgments);

      // 10 marvelous (heads) + 10 perfect (tails)
      for (let i = 0; i < 10; i++) {
        state = applyJudgment(state, { noteId: i, timingDiff: 0, grade: 'marvelous', time: i * 100 });
      }
      for (let i = 10; i < 20; i++) {
        state = applyJudgment(state, { noteId: i, timingDiff: 20, grade: 'perfect', time: i * 100 });
      }

      const percentage = calculatePercentage(state);
      // (10 * 100 + 10 * 98) / (20 * 100) = 1980 / 2000 = 99%
      expect(percentage).toBe(99);
      expect(percentage).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateGrade', () => {
    // Helper to create a score state with specific judgment counts
    const makeState = (counts: Partial<Record<string, number>>, totalNotes = 100) => ({
      rawScore: 0,
      maxPossibleScore: 0,
      combo: 0,
      maxCombo: 0,
      judgmentCounts: {
        marvelous: counts.marvelous ?? 0,
        perfect: counts.perfect ?? 0,
        great: counts.great ?? 0,
        good: counts.good ?? 0,
        boo: counts.boo ?? 0,
        miss: counts.miss ?? 0,
      },
      totalJudged: totalNotes,
      totalNotes,
      health: 50,
      failed: false,
    });

    it('returns AAAA for all Marvelous', () => {
      expect(calculateGrade(makeState({ marvelous: 100 }))).toBe('AAAA');
    });

    it('returns AAA for all Marvelous/Perfect (no Great or worse)', () => {
      expect(calculateGrade(makeState({ marvelous: 50, perfect: 50 }))).toBe('AAA');
      expect(calculateGrade(makeState({ perfect: 100 }))).toBe('AAA');
    });

    it('returns AA for high percentage with some Greats', () => {
      // 93+ Marvelous, 7 Great = 93*100 + 7*65 = 9755 / 10000 = 97.55%
      expect(calculateGrade(makeState({ marvelous: 93, great: 7 }))).toBe('AA');
    });

    it('returns A for 80%+ with mixed judgments', () => {
      // 80 Marvelous, 20 Great = 80*100 + 20*65 = 9300 / 10000 = 93% -> AA
      // 70 Marvelous, 30 Great = 70*100 + 30*65 = 8950 / 10000 = 89.5% -> A
      expect(calculateGrade(makeState({ marvelous: 70, great: 30 }))).toBe('A');
    });

    it('returns B for 65%+ with poor judgments', () => {
      // 50 Marvelous, 50 Good = 50*100 + 50*25 = 6250 / 10000 = 62.5% -> C
      // 60 Marvelous, 40 Great = 60*100 + 40*65 = 8600 / 10000 = 86% -> A
      // 40 Marvelous, 60 Great = 40*100 + 60*65 = 7900 / 10000 = 79% -> B
      expect(calculateGrade(makeState({ marvelous: 40, great: 60 }))).toBe('B');
    });

    it('returns C for 45%+ with many misses', () => {
      // 45 Marvelous, 55 Miss = 45*100 + 55*0 = 4500 / 10000 = 45% -> C
      expect(calculateGrade(makeState({ marvelous: 45, miss: 55 }))).toBe('C');
    });

    it('returns D for <45%', () => {
      // 40 Marvelous, 60 Miss = 40*100 / 10000 = 40% -> D
      expect(calculateGrade(makeState({ marvelous: 40, miss: 60 }))).toBe('D');
      expect(calculateGrade(makeState({ miss: 100 }))).toBe('D');
    });
  });
});
