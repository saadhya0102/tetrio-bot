import { describe, expect, it } from 'vitest';

import { BitBoard } from '../ai/board.js';
import type { LiveGarbageState, LiveMoveCandidate } from '../ai/types.js';
import { avoidTankingCandidates, tacticalAdjustment } from './tactics.js';

function candidate(
  facts: Pick<LiveMoveCandidate['facts'], 'cancelled' | 'garbageAdded' | 'rawAttack'> & {
    garbageBefore?: Partial<LiveGarbageState>;
  },
): LiveMoveCandidate {
  const { garbageBefore, ...moveFacts } = facts;
  return {
    actions: ['hardDrop'],
    frames: [],
    facts: {
      garbageAfter: {
        active: 0,
        confirmed: 0,
        earliestTankFrame: null,
        pending: 0,
      },
      garbageBefore: {
        active: 0,
        confirmed: 0,
        earliestTankFrame: null,
        pending: 0,
        ...garbageBefore,
      },
      ...moveFacts,
    },
    outcome: {
      placement: {
        piece: 't',
        rotation: 0,
        x: 3,
        useHold: false,
      },
      state: {
        b2b: -1,
        board: new BitBoard(10, 40),
        canHold: true,
        combo: -1,
        current: 'i',
        hold: null,
        pendingGarbage: 0,
        playHeight: 20,
        queue: ['j'],
      },
      lines: 0,
      attack: 0,
      perfectClear: false,
      spin: 'none',
    },
  };
}

describe('root tactical ranking', () => {
  it('does not select a known tank when a no-tank candidate exists', () => {
    const safe = candidate({
      cancelled: 0,
      garbageAdded: 0,
      garbageBefore: { pending: 3 },
      rawAttack: 0,
    });
    const tank = candidate({
      cancelled: 0,
      garbageAdded: 3,
      garbageBefore: { pending: 3 },
      rawAttack: 0,
    });

    expect(avoidTankingCandidates([safe, tank])).toEqual([safe]);
    expect(avoidTankingCandidates([tank])).toEqual([tank]);

    const noThreatSafe = candidate({ cancelled: 0, garbageAdded: 0, rawAttack: 0 });
    const noThreatTank = candidate({ cancelled: 0, garbageAdded: 3, rawAttack: 0 });
    expect(avoidTankingCandidates([noThreatSafe, noThreatTank])).toEqual([
      noThreatSafe,
      noThreatTank,
    ]);
  });

  it('prioritizes exact cancellation more strongly under urgent garbage', () => {
    const cancelFour = candidate({
      cancelled: 4,
      garbageAdded: 0,
      garbageBefore: { pending: 4 },
      rawAttack: 4,
    });
    const cancelMany = candidate({
      cancelled: 99,
      garbageAdded: 0,
      garbageBefore: { pending: 4 },
      rawAttack: 99,
    });
    const tank = candidate({
      cancelled: 0,
      garbageAdded: 2,
      garbageBefore: { pending: 4 },
      rawAttack: 0,
    });
    const noThreat = candidate({ cancelled: 4, garbageAdded: 0, rawAttack: 4 });

    expect(tacticalAdjustment(noThreat)).toBe(0);
    expect(tacticalAdjustment(cancelFour)).toBeGreaterThan(0);
    expect(tacticalAdjustment(tank)).toBeLessThan(0);
    expect(tacticalAdjustment(cancelMany)).toBe(tacticalAdjustment(cancelFour));
  });
});
