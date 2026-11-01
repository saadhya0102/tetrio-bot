import { createHash } from 'node:crypto';

import {
  DEFAULT_EVALUATION_PROFILE,
  HeuristicEvaluator,
  type EvaluationProfile,
  type EvaluationWeights,
} from '../ai/evaluator.js';
import { cloneEvaluationProfile } from '../ai/profile.js';
import { runPairedMatch, type MatchPolicy } from '../simulator/match.js';
import { optimizeSeparableCmaEs, type SeparableCmaEsResult } from './separable-cma-es.js';

const MODES = ['pressure', 'downstack', 'survival'] as const;
const WEIGHT_KEYS = [
  'aggregateHeight',
  'attack',
  'b2b',
  'bumpiness',
  'clear',
  'columnTransitions',
  'combo',
  'coveredHoles',
  'dangerHeight',
  'deepestWell',
  'holes',
  'perfectClear',
  'rowTransitions',
  'spin',
] as const satisfies readonly (keyof EvaluationWeights)[];

export interface ProfileTournamentScore {
  baselineWins: number;
  candidateWins: number;
  draws: number;
  games: number;
  score: number;
  traceDigest: string;
}

export interface ProfileTuningOptions {
  baselineProfile?: EvaluationProfile;
  generations: number;
  heldOutSeeds: readonly number[];
  initialSigma?: number;
  maximumMultiplier?: number;
  minimumMultiplier?: number;
  planner: MatchPolicy['planner'];
  populationSize?: number;
  screeningScore?: number;
  seed: number;
  trainingSeeds: readonly number[];
  turns: number;
}

export interface ProfileTuningResult {
  bestProfile: EvaluationProfile;
  heldOut: ProfileTournamentScore;
  optimization: SeparableCmaEsResult;
  passedScreening: boolean;
  training: ProfileTournamentScore;
}

interface WeightCoordinate {
  key: keyof EvaluationWeights;
  mode: (typeof MODES)[number];
}

/**
 * Tunes nonzero heuristic weights with deterministic, bounded separable CMA-ES
 * and returns a held-out paired-match result. It intentionally does not write
 * the profile or deploy it; callers must make any promotion explicit.
 */
export function tuneEvaluationProfile(options: ProfileTuningOptions): ProfileTuningResult {
  validateTuningOptions(options);
  const baseline = cloneEvaluationProfile(options.baselineProfile ?? DEFAULT_EVALUATION_PROFILE);
  const coordinates = coordinatesFor(baseline);
  const minimumMultiplier = options.minimumMultiplier ?? 0.4;
  const maximumMultiplier = options.maximumMultiplier ?? 1.8;
  if (
    !Number.isFinite(minimumMultiplier) ||
    !Number.isFinite(maximumMultiplier) ||
    minimumMultiplier < 0 ||
    minimumMultiplier >= maximumMultiplier
  ) {
    throw new RangeError(
      'Multiplier bounds must be finite, non-negative, and strictly increasing.',
    );
  }

  const scoreProfile = (
    profile: EvaluationProfile,
    seeds: readonly number[],
  ): ProfileTournamentScore =>
    evaluateProfile(profile, baseline, seeds, options.planner, options.turns);
  const optimization = optimizeSeparableCmaEs(
    {
      bounds: {
        lower: new Array<number>(coordinates.length).fill(minimumMultiplier),
        upper: new Array<number>(coordinates.length).fill(maximumMultiplier),
      },
      generations: options.generations,
      initialMean: new Array<number>(coordinates.length).fill(1),
      initialSigma: options.initialSigma ?? 0.16,
      seed: options.seed,
      ...(options.populationSize === undefined ? {} : { populationSize: options.populationSize }),
    },
    (multipliers) =>
      scoreProfile(
        profileFromMultipliers(baseline, coordinates, multipliers),
        options.trainingSeeds,
      ).score,
  );
  const bestProfile = profileFromMultipliers(baseline, coordinates, optimization.bestValues);
  const training = scoreProfile(bestProfile, options.trainingSeeds);
  const heldOut = scoreProfile(bestProfile, options.heldOutSeeds);
  const screeningScore = options.screeningScore ?? 0.55;

  return {
    bestProfile,
    heldOut,
    optimization,
    passedScreening:
      heldOut.score >= screeningScore && heldOut.candidateWins > heldOut.baselineWins,
    training,
  };
}

export function evaluateProfile(
  candidateProfile: EvaluationProfile,
  baselineProfile: EvaluationProfile,
  seeds: readonly number[],
  planner: MatchPolicy['planner'],
  turns: number,
): ProfileTournamentScore {
  if (seeds.length === 0) {
    throw new RangeError('At least one tournament seed is required.');
  }

  const baseline: MatchPolicy = {
    evaluator: new HeuristicEvaluator(baselineProfile),
    id: 'baseline',
    planner,
  };
  const candidate: MatchPolicy = {
    evaluator: new HeuristicEvaluator(candidateProfile),
    id: 'candidate',
    planner,
  };
  let baselineWins = 0;
  let candidateWins = 0;
  let draws = 0;
  const digests: string[] = [];

  for (const seed of seeds) {
    const result = runPairedMatch({ baseline, candidate, seed, turns });
    baselineWins += result.baselineWins;
    candidateWins += result.candidateWins;
    draws += result.draws;
    digests.push(result.traceDigest);
  }

  const games = baselineWins + candidateWins + draws;
  return {
    baselineWins,
    candidateWins,
    draws,
    games,
    score: (candidateWins + draws * 0.5) / Math.max(games, 1),
    traceDigest: createHash('sha256').update(digests.join('|')).digest('hex'),
  };
}

function coordinatesFor(profile: EvaluationProfile): WeightCoordinate[] {
  const coordinates: WeightCoordinate[] = [];
  for (const mode of MODES) {
    const weights = profile[mode];
    for (const key of WEIGHT_KEYS) {
      if (weights[key] !== 0) {
        coordinates.push({ key, mode });
      }
    }
  }
  return coordinates;
}

function profileFromMultipliers(
  baseline: EvaluationProfile,
  coordinates: readonly WeightCoordinate[],
  multipliers: readonly number[],
): EvaluationProfile {
  if (coordinates.length !== multipliers.length) {
    throw new RangeError('Each tunable coordinate needs one multiplier.');
  }
  const profile = cloneEvaluationProfile(baseline);
  for (let index = 0; index < coordinates.length; index += 1) {
    const coordinate = valueAt(coordinates, index);
    const multiplier = valueAt(multipliers, index);
    profile[coordinate.mode][coordinate.key] *= multiplier;
  }
  return profile;
}

function validateTuningOptions(options: ProfileTuningOptions): void {
  if (!Number.isInteger(options.generations) || options.generations < 1) {
    throw new RangeError('generations must be an integer of at least one.');
  }
  if (!Number.isInteger(options.turns) || options.turns < 1 || options.turns > 10_000) {
    throw new RangeError('turns must be an integer from one through 10000.');
  }
  if (options.trainingSeeds.length === 0 || options.heldOutSeeds.length === 0) {
    throw new RangeError('Training and held-out seed sets must both be non-empty.');
  }
}

function valueAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`Array index ${index} is outside the available values.`);
  }
  return value;
}
