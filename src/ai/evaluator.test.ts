import { describe, expect, it } from 'vitest';

import { BitBoard } from './board.js';
import { HeuristicEvaluator, type EvaluationProfile, type EvaluationWeights } from './evaluator.js';
import { generateOutcomes } from './search.js';
import type { SearchState } from './types.js';

const ZERO_WEIGHTS: EvaluationWeights = {
  aggregateHeight: 0,
  attack: 0,
  b2b: 0,
  bumpiness: 0,
  clear: 0,
  columnTransitions: 0,
  combo: 0,
  coveredHoles: 0,
  dangerHeight: 0,
  deepestWell: 0,
  holes: 0,
  perfectClear: 0,
  rowTransitions: 0,
  spin: 0,
};

const ZERO_PROFILE: EvaluationProfile = {
  downstack: ZERO_WEIGHTS,
  pressure: ZERO_WEIGHTS,
  survival: ZERO_WEIGHTS,
};

const STATE: SearchState = {
  b2b: -1,
  board: new BitBoard(),
  canHold: false,
  combo: -1,
  current: 't',
  hold: null,
  pendingGarbage: 0,
  playHeight: 20,
  queue: ['i', 'o'],
};

describe('HeuristicEvaluator', () => {
  it('keeps structural value out of immediate transition reward', () => {
    const outcome = generateOutcomes(STATE)[0];
    if (!outcome) {
      throw new Error('Expected a legal fixture outcome.');
    }
    const evaluator = new HeuristicEvaluator(ZERO_PROFILE);

    expect(evaluator.moveValue(STATE, outcome)).toBe(0);
  });

  it('selects pressure, downstack, and survival modes on distinct fixtures', () => {
    const evaluator = new HeuristicEvaluator();
    const downstack = {
      ...STATE,
      board: BitBoard.fromRows(
        10,
        Array.from({ length: 40 }, (_, row) => (row < 15 ? 1 : 0)),
      ),
    };
    const survival = {
      ...STATE,
      board: BitBoard.fromRows(
        10,
        Array.from({ length: 40 }, (_, row) => (row < 32 ? 1 : 0)),
      ),
    };

    expect(evaluator.modeFor(STATE)).toBe('pressure');
    expect(evaluator.modeFor(downstack)).toBe('downstack');
    expect(evaluator.modeFor(survival)).toBe('survival');
  });
});
