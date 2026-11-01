import type { BitBoard, BoardFeatures } from './board.js';
import type { MoveOutcome, SearchState } from './types.js';

export type StrategicMode = 'pressure' | 'downstack' | 'survival';

/**
 * The seam for a later learned value/policy model. A model can replace the
 * heuristic without changing live validation, controls, or search mechanics.
 */
export interface PositionEvaluator {
  stateValue(state: SearchState): number;
  /**
   * Immediate transition reward only. BeamSearch adds the terminal state value
   * exactly once when ranking a full principal variation.
   */
  moveValue(before: SearchState, outcome: MoveOutcome): number;
}

export interface EvaluationWeights {
  aggregateHeight: number;
  attack: number;
  b2b: number;
  bumpiness: number;
  clear: number;
  columnTransitions: number;
  combo: number;
  coveredHoles: number;
  dangerHeight: number;
  deepestWell: number;
  holes: number;
  perfectClear: number;
  rowTransitions: number;
  spin: number;
}

export interface EvaluationProfile {
  pressure: EvaluationWeights;
  downstack: EvaluationWeights;
  survival: EvaluationWeights;
}

const PRESSURE_WEIGHTS: EvaluationWeights = {
  aggregateHeight: 0.28,
  attack: 6.6,
  b2b: 1.35,
  bumpiness: 0.62,
  clear: 1.45,
  columnTransitions: 0.1,
  combo: 0.9,
  coveredHoles: 3.2,
  dangerHeight: 5.7,
  deepestWell: 0.26,
  holes: 8.5,
  perfectClear: 19,
  rowTransitions: 0.16,
  spin: 3.2,
};

const DOWNSTACK_WEIGHTS: EvaluationWeights = {
  ...PRESSURE_WEIGHTS,
  aggregateHeight: 0.4,
  attack: 3.7,
  bumpiness: 0.84,
  clear: 3.7,
  coveredHoles: 5.6,
  dangerHeight: 8.2,
  deepestWell: 0.08,
  holes: 13,
  rowTransitions: 0.32,
  spin: 1.25,
};

const SURVIVAL_WEIGHTS: EvaluationWeights = {
  ...DOWNSTACK_WEIGHTS,
  aggregateHeight: 0.58,
  attack: 2.3,
  b2b: 0.45,
  bumpiness: 1.08,
  clear: 4.8,
  coveredHoles: 8.5,
  dangerHeight: 12.5,
  deepestWell: 0,
  holes: 18,
  rowTransitions: 0.44,
  spin: 0.6,
};

export const DEFAULT_EVALUATION_PROFILE: EvaluationProfile = {
  pressure: PRESSURE_WEIGHTS,
  downstack: DOWNSTACK_WEIGHTS,
  survival: SURVIVAL_WEIGHTS,
};

/**
 * A transparent value function intended to be replaced or blended with a learned
 * value model later. It intentionally favors survivable, low-hole fields over
 * short-lived attack spikes.
 */
export class HeuristicEvaluator implements PositionEvaluator {
  private readonly featureCache = new WeakMap<BitBoard, BoardFeatures>();

  constructor(private readonly profile: EvaluationProfile = DEFAULT_EVALUATION_PROFILE) {}

  modeFor(state: SearchState): StrategicMode {
    const features = this.featuresFor(state.board);
    if (features.maxHeight >= state.board.height - 8 || features.holes >= 6) {
      return 'survival';
    }
    if (state.pendingGarbage >= 4 || features.holes >= 2 || features.maxHeight >= 15) {
      return 'downstack';
    }
    return 'pressure';
  }

  stateValue(state: SearchState): number {
    const features = this.featuresFor(state.board);
    const weights = this.weightsFor(this.modeFor(state));
    return this.structureValue(features, state, weights);
  }

  moveValue(before: SearchState, outcome: MoveOutcome): number {
    const mode = this.modeFor(before);
    const weights = this.weightsFor(mode);
    const comboReward = outcome.state.combo > 0 ? Math.min(outcome.state.combo, 8) : 0;
    const b2bReward = outcome.lines >= 4 ? Math.max(outcome.state.b2b, 0) : 0;
    const spinValue = outcome.spin === 'normal' ? 1 : outcome.spin === 'mini' ? 0.45 : 0;

    return (
      outcome.attack * weights.attack +
      outcome.lines * weights.clear +
      comboReward * weights.combo +
      b2bReward * weights.b2b +
      spinValue * weights.spin +
      (outcome.perfectClear ? weights.perfectClear : 0)
    );
  }

  private structureValue(
    features: BoardFeatures,
    state: SearchState,
    weights: EvaluationWeights,
  ): number {
    const dangerStart = Math.max(10, state.board.height - 20);
    const excessHeight = Math.max(0, features.maxHeight - dangerStart);
    const wellPenalty = features.deepestWell > 4 ? features.deepestWell - 4 : 0;

    return (
      -features.aggregateHeight * weights.aggregateHeight -
      features.holes * weights.holes -
      features.coveredHoles * weights.coveredHoles -
      features.bumpiness * weights.bumpiness -
      features.rowTransitions * weights.rowTransitions -
      features.columnTransitions * weights.columnTransitions -
      excessHeight ** 2 * weights.dangerHeight -
      wellPenalty * weights.deepestWell +
      Math.min(features.deepestWell, 4) * weights.deepestWell * 0.6
    );
  }

  private weightsFor(mode: StrategicMode): EvaluationWeights {
    switch (mode) {
      case 'downstack':
        return this.profile.downstack;
      case 'survival':
        return this.profile.survival;
      default:
        return this.profile.pressure;
    }
  }

  private featuresFor(board: BitBoard): BoardFeatures {
    const cached = this.featureCache.get(board);
    if (cached) {
      return cached;
    }
    const features = board.features();
    this.featureCache.set(board, features);
    return features;
  }
}
