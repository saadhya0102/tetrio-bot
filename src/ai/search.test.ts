import { describe, expect, it } from 'vitest';

import { BitBoard } from './board.js';
import type { PositionEvaluator } from './evaluator.js';
import { BeamSearch, generateOutcomes, searchStateKey } from './search.js';
import type { MoveOutcome, SearchState } from './types.js';

const EMPTY_O_STATE: SearchState = {
  b2b: -1,
  board: new BitBoard(),
  canHold: false,
  combo: -1,
  current: 'o',
  hold: null,
  pendingGarbage: 0,
  playHeight: 20,
  queue: ['o', 'o', 'o'],
};

const LEAF_EVALUATOR: PositionEvaluator = {
  moveValue: () => 0,
  stateValue: (state) => -state.board.features().aggregateHeight,
};

function reward(outcome: MoveOutcome): number {
  return outcome.placement.x * 0.01 + outcome.lines * 10;
}

describe('BeamSearch', () => {
  it('finds an immediate line clear when one is available', () => {
    const full = (1 << 10) - 1;
    const search = new BeamSearch();
    const best = search.choose(
      {
        board: BitBoard.fromRows(10, [full ^ 0b1111, 0, 0, 0, 0, 0, 0, 0], 8),
        playHeight: 8,
        current: 'i',
        queue: ['t', 'o', 's', 'z', 'j', 'l'],
        hold: null,
        canHold: true,
        combo: -1,
        b2b: -1,
        pendingGarbage: 0,
      },
      {
        beamWidth: 12,
        lookahead: 2,
      },
    );

    expect(best).toBeDefined();
    expect(best?.outcome.lines).toBe(1);
    expect(best?.outcome.placement.useHold).toBe(false);
  });

  it('does not treat spawn-buffer rows as playable future space', () => {
    const outcomes = generateOutcomes({
      board: BitBoard.fromRows(10, [0, 0, 0, 0, 0, 0, 1, 0], 8),
      playHeight: 6,
      current: 't',
      queue: ['i', 'o', 's'],
      hold: null,
      canHold: true,
      combo: -1,
      b2b: -1,
      pendingGarbage: 0,
    });

    expect(outcomes).toEqual([]);
  });

  it('returns the same terminal score used to select a one-ply move', () => {
    const outcomes = generateOutcomes(EMPTY_O_STATE);
    const expected = outcomes
      .map((outcome) => ({
        outcome,
        score:
          LEAF_EVALUATOR.moveValue(EMPTY_O_STATE, outcome) +
          LEAF_EVALUATOR.stateValue(outcome.state),
      }))
      .sort((left, right) => right.score - left.score)[0];
    const selected = new BeamSearch(LEAF_EVALUATOR).choose(EMPTY_O_STATE, {
      beamWidth: 16,
      lookahead: 1,
    });

    expect(expected).toBeDefined();
    expect(selected?.score).toBe(expected?.score);
    expect(selected?.outcome).toEqual(expected?.outcome);
  });

  it('uses path rewards plus one terminal value across two plies', () => {
    const evaluator: PositionEvaluator = {
      moveValue: (_before, outcome) => reward(outcome),
      stateValue: (state) => -state.board.features().aggregateHeight,
    };
    const expected = generateOutcomes(EMPTY_O_STATE)
      .flatMap((first) =>
        generateOutcomes(first.state).map((second) => ({
          first,
          score: reward(first) + reward(second) + evaluator.stateValue(second.state),
        })),
      )
      .sort((left, right) => right.score - left.score)[0];
    const selected = new BeamSearch(evaluator).choose(EMPTY_O_STATE, {
      beamWidth: 16,
      lookahead: 2,
    });

    expect(expected).toBeDefined();
    expect(selected?.score).toBe(expected?.score);
    expect(selected?.principalVariation).toHaveLength(2);
  });

  it('does not commit a partially expanded deeper beam at its deadline', () => {
    const rootOutcomes = generateOutcomes(EMPTY_O_STATE);
    const rootUniqueStates = new Set(rootOutcomes.map((outcome) => searchStateKey(outcome.state)))
      .size;
    let now = 0;
    let values = 0;
    const evaluator: PositionEvaluator = {
      moveValue: () => 0,
      stateValue: () => {
        values += 1;
        if (values > rootUniqueStates) {
          now = 10;
        }
        return 0;
      },
    };
    const selected = new BeamSearch(evaluator, { now: () => now }).choose(
      EMPTY_O_STATE,
      { beamWidth: 16, lookahead: 2 },
      10,
    );

    expect(selected?.principalVariation).toHaveLength(1);
  });

  it('includes board dimensions in canonical search state keys', () => {
    const taller = {
      ...EMPTY_O_STATE,
      board: new BitBoard(10, 24),
      playHeight: 20,
    };

    expect(searchStateKey(EMPTY_O_STATE)).not.toBe(searchStateKey(taller));
  });
});
