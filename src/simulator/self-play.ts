import { BitBoard } from '../ai/board.js';
import type { PositionEvaluator } from '../ai/evaluator.js';
import { BeamSearch } from '../ai/search.js';
import { PIECES, type Piece } from '../ai/tetrominoes.js';
import type { MoveOutcome, PlannerSettings, SearchState } from '../ai/types.js';

export interface SelfPlayOptions {
  seed: number;
  pieces: number;
  planner: PlannerSettings;
  decisionBudgetMs: number;
  evaluator?: PositionEvaluator;
}

export interface SimulationStep {
  before: SearchState;
  outcome: MoveOutcome;
  score: number;
  elapsedMs: number;
}

export interface SimulationResult {
  steps: readonly SimulationStep[];
  toppedOut: boolean;
  timedOut: boolean;
  totalAttack: number;
}

export function runSelfPlay(options: SelfPlayOptions): SimulationResult {
  const nextPiece = createBagGenerator(options.seed);
  const search = new BeamSearch(options.evaluator);
  let state = withQueue(
    {
      board: new BitBoard(),
      playHeight: 20,
      current: nextPiece(),
      queue: [],
      hold: null,
      canHold: true,
      combo: -1,
      b2b: -1,
      pendingGarbage: 0,
    },
    nextPiece,
  );

  const steps: SimulationStep[] = [];
  let totalAttack = 0;
  for (let piece = 0; piece < options.pieces; piece += 1) {
    const before = state;
    const startedAt = performance.now();
    const chosen = search.choose(before, options.planner, startedAt + options.decisionBudgetMs);
    const elapsedMs = performance.now() - startedAt;
    if (!chosen) {
      const timedOut = elapsedMs >= options.decisionBudgetMs;
      return {
        steps,
        toppedOut: !timedOut,
        timedOut,
        totalAttack,
      };
    }

    steps.push({
      before,
      outcome: chosen.outcome,
      score: chosen.score,
      elapsedMs,
    });
    totalAttack += chosen.outcome.attack;
    state = withQueue(chosen.outcome.state, nextPiece);
  }

  return { steps, toppedOut: false, timedOut: false, totalAttack };
}

function withQueue(state: SearchState, nextPiece: () => Piece, minimumQueue = 12): SearchState {
  const queue = [...state.queue];
  while (queue.length < minimumQueue) {
    queue.push(nextPiece());
  }
  return { ...state, queue };
}

export function createBagGenerator(seed: number): () => Piece {
  let state = seed >>> 0;
  let bag: Piece[] = [];

  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };

  return (): Piece => {
    if (bag.length === 0) {
      bag = [...PIECES];
      for (let index = bag.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        const current = bag[index];
        const swapped = bag[swapIndex];
        if (!current || !swapped) {
          throw new Error('Seven-bag shuffle produced an invalid index.');
        }
        bag[index] = swapped;
        bag[swapIndex] = current;
      }
    }
    const piece = bag.pop();
    if (!piece) {
      throw new Error('Seven-bag generator unexpectedly ran out of pieces.');
    }
    return piece;
  };
}
