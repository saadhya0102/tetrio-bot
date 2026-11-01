import type { Engine } from '@haelp/teto/engine';

import { BitBoard } from '../ai/board.js';
import { isPiece, type Piece } from '../ai/tetrominoes.js';
import type { LiveGarbageState, SearchState } from '../ai/types.js';

export function searchStateFromEngine(engine: Engine): SearchState {
  const rows = engine.board.state.map((row) =>
    row.reduce((mask, tile, x) => mask | (tile === null ? 0 : 1 << x), 0),
  );
  const current = toPiece(engine.falling.symbol);

  return {
    board: BitBoard.fromRows(engine.board.width, rows, engine.board.fullHeight),
    playHeight: engine.board.height,
    current,
    queue: Array.from(engine.queue, toPiece),
    hold: engine.held ? toPiece(engine.held) : null,
    canHold: !engine.holdLocked,
    combo: engine.stats.combo,
    b2b: engine.stats.b2b,
    pendingGarbage: garbageStateFromEngine(engine).pending,
  };
}

/**
 * Captures the local engine's queued-garbage timing without collapsing it to a
 * scalar. Triangle's active-garbage behavior is still a local model, but root
 * candidates can use these exact before/after facts instead of guessing.
 */
export function garbageStateFromEngine(engine: Engine): LiveGarbageState {
  const queue = engine.garbageQueue.queue;
  const speed = engine.garbageQueue.options.garbage.speed;
  let active = 0;
  let confirmed = 0;
  let earliestTankFrame: number | null = null;
  let pending = 0;

  for (const entry of queue) {
    const tankFrame = entry.frame + speed;
    pending += entry.amount;
    if (entry.confirmed) {
      confirmed += entry.amount;
    }
    if (tankFrame <= engine.frame) {
      active += entry.amount;
    }
    earliestTankFrame =
      earliestTankFrame === null ? tankFrame : Math.min(earliestTankFrame, tankFrame);
  }

  return { active, confirmed, earliestTankFrame, pending };
}

function toPiece(value: string): Piece {
  if (!isPiece(value)) {
    throw new Error(`The current room uses unsupported piece type "${value}".`);
  }
  return value;
}
