import type { BitBoard } from './board.js';
import { HeuristicEvaluator, type PositionEvaluator } from './evaluator.js';
import { SHAPES, type Piece } from './tetrominoes.js';
import type { MoveOutcome, Placement, PlannerSettings, RankedMove, SearchState } from './types.js';

interface PieceChoice {
  piece: Piece;
  hold: Piece | null;
  queue: readonly Piece[];
  useHold: boolean;
}

interface SearchNode {
  first: MoveOutcome;
  leafValue: number;
  pathReward: number;
  principalVariation: readonly Placement[];
  state: SearchState;
}

interface OutcomeBatch {
  complete: boolean;
  outcomes: readonly MoveOutcome[];
}

export interface BeamSearchDependencies {
  now?: () => number;
}

export class BeamSearch {
  private readonly now: () => number;

  constructor(
    private readonly evaluator: PositionEvaluator = new HeuristicEvaluator(),
    dependencies: BeamSearchDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => performance.now());
  }

  choose(
    state: SearchState,
    settings: PlannerSettings,
    deadline = Number.POSITIVE_INFINITY,
  ): RankedMove | undefined {
    const stateValues = new Map<string, number>();
    const valueFor = (candidate: SearchState): number => {
      const key = searchStateKey(candidate);
      const cached = stateValues.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const value = this.evaluator.stateValue(candidate);
      stateValues.set(key, value);
      return value;
    };
    const initial = generateOutcomeBatch(state, deadline, this.now);
    if (initial.outcomes.length === 0) {
      return undefined;
    }

    const initialNodes: SearchNode[] = [];
    for (const outcome of initial.outcomes) {
      if (initialNodes.length > 0 && this.now() >= deadline) {
        break;
      }
      initialNodes.push({
        first: outcome,
        leafValue: valueFor(outcome.state),
        pathReward: this.evaluator.moveValue(state, outcome),
        principalVariation: [outcome.placement],
        state: outcome.state,
      });
    }
    if (initialNodes.length === 0) {
      return undefined;
    }

    let beam: SearchNode[] = initialNodes;
    beam = this.trimBeam(this.deduplicate(beam), settings.beamWidth);

    for (let depth = 1; depth < settings.lookahead && this.now() < deadline; depth += 1) {
      const nextBeam: SearchNode[] = [];
      let depthComplete = true;
      for (const node of beam) {
        if (this.now() >= deadline) {
          depthComplete = false;
          break;
        }

        const outcomes = generateOutcomeBatch(node.state, deadline, this.now);
        if (!outcomes.complete) {
          depthComplete = false;
          break;
        }
        for (const outcome of outcomes.outcomes) {
          if (this.now() >= deadline) {
            depthComplete = false;
            break;
          }
          nextBeam.push({
            first: node.first,
            leafValue: valueFor(outcome.state),
            pathReward: node.pathReward + this.evaluator.moveValue(node.state, outcome),
            principalVariation: [...node.principalVariation, outcome.placement],
            state: outcome.state,
          });
        }
        if (!depthComplete) {
          break;
        }
      }

      if (!depthComplete || nextBeam.length === 0) {
        break;
      }
      beam = this.trimBeam(this.deduplicate(nextBeam), settings.beamWidth);
    }

    const best = this.trimBeam(beam, 1)[0];
    return best
      ? {
          outcome: best.first,
          score: this.rankingScore(best),
          principalVariation: best.principalVariation,
        }
      : undefined;
  }

  /**
   * Scores an already engine-evaluated live move. Future plies use the lightweight
   * deterministic simulator, so only the protocol-sensitive first move is evaluated
   * by the pinned local engine model.
   */
  scoreValidatedMove(
    before: SearchState,
    outcome: MoveOutcome,
    settings: PlannerSettings,
    deadline: number,
  ): number {
    const immediateReward = this.evaluator.moveValue(before, outcome);
    const leafValue = this.evaluator.stateValue(outcome.state);
    if (settings.lookahead <= 1 || this.now() >= deadline) {
      return immediateReward + leafValue;
    }

    const continuation = this.choose(
      outcome.state,
      { ...settings, lookahead: settings.lookahead - 1 },
      deadline,
    );
    return immediateReward + (continuation?.score ?? leafValue);
  }

  private trimBeam(nodes: readonly SearchNode[], width: number): SearchNode[] {
    return [...nodes]
      .sort((left, right) => this.rankingScore(right) - this.rankingScore(left))
      .slice(0, width);
  }

  private rankingScore(node: SearchNode): number {
    return node.pathReward + node.leafValue;
  }

  /**
   * Different hold/placement paths can converge on exactly the same tactical
   * state. Retain only the highest-scoring path before consuming beam width on
   * duplicate continuations.
   */
  private deduplicate(nodes: readonly SearchNode[]): SearchNode[] {
    const unique = new Map<string, SearchNode>();
    for (const node of nodes) {
      const key = searchStateKey(node.state);
      const existing = unique.get(key);
      if (!existing || node.pathReward > existing.pathReward) {
        unique.set(key, node);
      }
    }
    return [...unique.values()];
  }
}

export function searchStateKey(state: SearchState): string {
  return [
    state.board.width,
    state.board.height,
    state.board.key(),
    state.playHeight,
    state.current,
    state.queue.join(''),
    state.hold ?? '-',
    state.canHold ? 1 : 0,
    state.combo,
    state.b2b,
    state.pendingGarbage,
    state.knownGarbageHoles?.join(',') ?? '-',
    state.garbageTankCap ?? '-',
  ].join('|');
}

export function generateOutcomes(
  state: SearchState,
  deadline = Number.POSITIVE_INFINITY,
): MoveOutcome[] {
  return [...generateOutcomeBatch(state, deadline, () => performance.now()).outcomes];
}

function generateOutcomeBatch(
  state: SearchState,
  deadline: number,
  now: () => number,
): OutcomeBatch {
  if (state.board.hasOccupiedAtOrAbove(state.playHeight)) {
    return { complete: true, outcomes: [] };
  }

  const outcomes: MoveOutcome[] = [];
  for (const choice of choicesFor(state)) {
    if (now() >= deadline) {
      return { complete: false, outcomes };
    }
    const shapes = SHAPES[choice.piece];
    for (let rotation = 0; rotation < shapes.length; rotation += 1) {
      if (now() >= deadline) {
        return { complete: false, outcomes };
      }
      const shape = shapes[rotation];
      if (!shape) {
        continue;
      }
      for (let x = 0; x <= state.board.width - shape.width; x += 1) {
        if (now() >= deadline) {
          return { complete: false, outcomes };
        }
        const placement = state.board.hardDrop(shape, x, state.playHeight);
        if (!placement) {
          continue;
        }

        const after = spawnNext(choice, placement.board, state.playHeight);
        if (!after) {
          continue;
        }

        const difficult = placement.lines >= 4;
        const nextB2b =
          placement.lines === 0 ? state.b2b : difficult ? Math.max(0, state.b2b + 1) : -1;
        const nextCombo = placement.lines > 0 ? Math.max(0, state.combo + 1) : -1;
        const attack = estimateAttack(placement.lines, nextB2b, nextCombo);
        const garbage = applyKnownGarbage(state, placement.board, placement.lines, attack);
        if (!garbage) {
          continue;
        }
        const afterSpawn = spawnNext(choice, garbage.board, state.playHeight);
        if (!afterSpawn) {
          continue;
        }

        const nextState: SearchState = {
          ...afterSpawn,
          combo: nextCombo,
          b2b: nextB2b,
          pendingGarbage: garbage.pendingGarbage,
          ...(garbage.knownGarbageHoles ? { knownGarbageHoles: garbage.knownGarbageHoles } : {}),
          ...(state.garbageTankCap === undefined ? {} : { garbageTankCap: state.garbageTankCap }),
        };

        outcomes.push({
          placement: {
            piece: choice.piece,
            rotation,
            x,
            useHold: choice.useHold,
          },
          state: nextState,
          lines: placement.lines,
          attack,
          perfectClear: garbage.board.occupiedCount === 0,
          spin: 'none',
        });
      }
    }
  }
  return { complete: true, outcomes };
}

function choicesFor(state: SearchState): readonly PieceChoice[] {
  const choices: PieceChoice[] = [
    {
      piece: state.current,
      hold: state.hold,
      queue: state.queue,
      useHold: false,
    },
  ];

  if (!state.canHold) {
    return choices;
  }

  if (state.hold) {
    choices.push({
      piece: state.hold,
      hold: state.current,
      queue: state.queue,
      useHold: true,
    });
  } else {
    const [piece, ...queue] = state.queue;
    if (piece) {
      choices.push({
        piece,
        hold: state.current,
        queue,
        useHold: true,
      });
    }
  }

  return choices;
}

function spawnNext(
  choice: PieceChoice,
  board: BitBoard,
  playHeight: number,
): Omit<SearchState, 'combo' | 'b2b' | 'pendingGarbage'> | undefined {
  const [current, ...queue] = choice.queue;
  if (!current) {
    return undefined;
  }

  return {
    board,
    playHeight,
    current,
    queue,
    hold: choice.hold,
    canHold: true,
  };
}

function estimateAttack(lines: number, b2b: number, combo: number): number {
  const base = [0, 0, 1, 2, 4][lines] ?? 0;
  const b2bBonus = lines >= 4 && b2b > 0 ? 1 : 0;
  const comboBonus = combo >= 1 ? Math.min(4, Math.floor((combo + 1) / 2)) : 0;
  return base + b2bBonus + comboBonus;
}
