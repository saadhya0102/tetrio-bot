import { describe, expect, it } from 'vitest';

import { BitBoard } from './board.js';
import { SHAPES } from './tetrominoes.js';

describe('BitBoard', () => {
  it('clears four rows from a vertical I placement', () => {
    const full = (1 << 10) - 1;
    const board = BitBoard.fromRows(
      10,
      [full ^ (1 << 4), full ^ (1 << 4), full ^ (1 << 4), full ^ (1 << 4), 0, 0, 0, 0],
      8,
    );

    const verticalI = SHAPES.i[1];
    if (!verticalI) {
      throw new Error('Expected the I piece to have a vertical rotation.');
    }
    const result = board.hardDrop(verticalI, 4);

    expect(result?.lines).toBe(4);
    expect(result?.board.occupiedCount).toBe(0);
  });

  it('counts enclosed holes and the blocks covering them', () => {
    const board = BitBoard.fromRows(10, [1, 0, 1, 0, 0, 0], 6);
    const features = board.features();

    expect(features.holes).toBe(1);
    expect(features.coveredHoles).toBe(1);
    expect(features).toMatchObject({
      aggregateHeight: 3,
      bumpiness: 3,
      columnTransitions: 22,
      deepestWell: 0,
      heightVariance: 8.1,
      maxHeight: 3,
      occupiedCells: 2,
      rowTransitions: 6,
    });
  });

  it('inserts deterministic garbage rows and detects pushed-off blocks', () => {
    const full = (1 << 10) - 1;
    const board = BitBoard.fromRows(10, [1, 2, 0, 0], 4);
    const insertion = board.insertGarbage([3, 4]);

    expect(Array.from(insertion.board.rows)).toEqual([full ^ (1 << 3), full ^ (1 << 4), 1, 2]);
    expect(insertion.toppedOut).toBe(false);

    const topOccupied = BitBoard.fromRows(10, [0, 0, 0, 1], 4);
    expect(topOccupied.insertGarbage([2]).toppedOut).toBe(true);
  });
});
