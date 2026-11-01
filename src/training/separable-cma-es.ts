export interface NumericBounds {
  lower: readonly number[];
  upper: readonly number[];
}

export interface SeparableCmaEsOptions {
  bounds: NumericBounds;
  generations: number;
  initialMean: readonly number[];
  initialSigma: number;
  parentCount?: number;
  populationSize?: number;
  seed: number;
}

export interface CmaEsGeneration {
  bestScore: number;
  generation: number;
  mean: readonly number[];
  sigma: number;
}

export interface SeparableCmaEsResult {
  bestScore: number;
  bestValues: readonly number[];
  evaluations: number;
  generations: readonly CmaEsGeneration[];
}

interface Candidate {
  score: number;
  values: number[];
  z: number[];
}

/**
 * A deterministic, diagonal-covariance CMA-ES maximizer. It is deliberately
 * separable so profile tuning remains practical without a large linear-algebra
 * dependency. The caller owns all evaluation semantics and held-out gates.
 */
export function optimizeSeparableCmaEs(
  options: SeparableCmaEsOptions,
  evaluate: (values: readonly number[]) => number,
): SeparableCmaEsResult {
  validateOptions(options);
  const dimensions = options.initialMean.length;
  const populationSize = options.populationSize ?? 4 + Math.floor(3 * Math.log(dimensions));
  const parentCount = options.parentCount ?? Math.floor(populationSize / 2);
  if (!Number.isInteger(populationSize) || populationSize < 2) {
    throw new RangeError('populationSize must be an integer of at least two.');
  }
  if (!Number.isInteger(parentCount) || parentCount < 1 || parentCount > populationSize) {
    throw new RangeError('parentCount must be an integer from one through populationSize.');
  }

  const weights = recombinationWeights(parentCount);
  const effectiveParents = 1 / weights.reduce((sum, weight) => sum + weight ** 2, 0);
  const n = dimensions;
  const cSigma = (effectiveParents + 2) / (n + effectiveParents + 5);
  const dSigma = 1 + cSigma + 2 * Math.max(0, Math.sqrt((effectiveParents - 1) / (n + 1)) - 1);
  const cC = (4 + effectiveParents / n) / (n + 4 + (2 * effectiveParents) / n);
  const c1 = 2 / ((n + 1.3) ** 2 + effectiveParents);
  const cMu = Math.min(
    1 - c1,
    (2 * (effectiveParents - 2 + 1 / effectiveParents)) / ((n + 2) ** 2 + effectiveParents),
  );
  const expectedNorm = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n ** 2));
  const random = createRandom(options.seed);
  let mean = [...options.initialMean];
  let sigma = options.initialSigma;
  let variance = new Array<number>(n).fill(1);
  const pathSigma = new Array<number>(n).fill(0);
  const pathCovariance = new Array<number>(n).fill(0);
  let evaluations = 0;
  let bestValues = [...mean];
  let bestScore = checkedScore(evaluate(bestValues));
  evaluations += 1;
  const generations: CmaEsGeneration[] = [];

  for (let generation = 0; generation < options.generations; generation += 1) {
    const previousMean = mean;
    const previousVariance = variance;
    const candidates: Candidate[] = [];
    for (let index = 0; index < populationSize; index += 1) {
      const z = new Array<number>(n);
      const values = new Array<number>(n);
      for (let dimension = 0; dimension < n; dimension += 1) {
        const sample = random.normal();
        z[dimension] = sample;
        const lower = valueAt(options.bounds.lower, dimension);
        const upper = valueAt(options.bounds.upper, dimension);
        const raw =
          valueAt(previousMean, dimension) +
          sigma * Math.sqrt(valueAt(previousVariance, dimension)) * sample;
        values[dimension] = clamp(raw, lower, upper);
      }
      const score = checkedScore(evaluate(values));
      evaluations += 1;
      candidates.push({ score, values, z });
      if (score > bestScore) {
        bestScore = score;
        bestValues = [...values];
      }
    }
    candidates.sort((left, right) => right.score - left.score);
    const parents = candidates.slice(0, parentCount);
    if (parents.length !== parentCount) {
      throw new Error('CMA-ES could not select the requested parent count.');
    }

    const weightedStep = new Array<number>(n).fill(0);
    mean = new Array<number>(n).fill(0);
    for (let parentIndex = 0; parentIndex < parents.length; parentIndex += 1) {
      const parent = valueAt(parents, parentIndex);
      const weight = valueAt(weights, parentIndex);
      for (let dimension = 0; dimension < n; dimension += 1) {
        const value = valueAt(parent.values, dimension);
        mean[dimension] = valueAt(mean, dimension) + weight * value;
        weightedStep[dimension] =
          valueAt(weightedStep, dimension) +
          weight *
            ((value - valueAt(previousMean, dimension)) /
              (sigma * Math.sqrt(valueAt(previousVariance, dimension))));
      }
    }

    const sigmaScale = Math.sqrt(cSigma * (2 - cSigma) * effectiveParents);
    for (let dimension = 0; dimension < n; dimension += 1) {
      pathSigma[dimension] =
        (1 - cSigma) * valueAt(pathSigma, dimension) +
        sigmaScale * valueAt(weightedStep, dimension);
    }
    const pathNorm = euclideanNorm(pathSigma);
    const hSigma =
      pathNorm / Math.sqrt(1 - (1 - cSigma) ** (2 * (generation + 1))) / expectedNorm <
      1.4 + 2 / (n + 1)
        ? 1
        : 0;
    const covarianceScale = hSigma * Math.sqrt(cC * (2 - cC) * effectiveParents);
    for (let dimension = 0; dimension < n; dimension += 1) {
      pathCovariance[dimension] =
        (1 - cC) * valueAt(pathCovariance, dimension) +
        covarianceScale *
          Math.sqrt(valueAt(previousVariance, dimension)) *
          valueAt(weightedStep, dimension);
    }

    variance = new Array<number>(n);
    for (let dimension = 0; dimension < n; dimension += 1) {
      let rankMu = 0;
      for (let parentIndex = 0; parentIndex < parents.length; parentIndex += 1) {
        const parent = valueAt(parents, parentIndex);
        const normalized =
          (valueAt(parent.values, dimension) - valueAt(previousMean, dimension)) / sigma;
        rankMu += valueAt(weights, parentIndex) * normalized ** 2;
      }
      variance[dimension] = Math.max(
        1e-12,
        (1 - c1 - cMu) * valueAt(previousVariance, dimension) +
          c1 * valueAt(pathCovariance, dimension) ** 2 +
          cMu * rankMu,
      );
    }
    sigma *= Math.exp((cSigma / dSigma) * (pathNorm / expectedNorm - 1));
    sigma = clamp(sigma, options.initialSigma * 0.02, options.initialSigma * 20);
    generations.push({
      bestScore: valueAt(parents, 0).score,
      generation,
      mean: [...mean],
      sigma,
    });
  }

  return {
    bestScore,
    bestValues,
    evaluations,
    generations,
  };
}

function validateOptions(options: SeparableCmaEsOptions): void {
  const dimensions = options.initialMean.length;
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new RangeError('initialMean must have at least one value.');
  }
  if (options.bounds.lower.length !== dimensions || options.bounds.upper.length !== dimensions) {
    throw new RangeError('Each bounds array must match initialMean length.');
  }
  if (!Number.isInteger(options.generations) || options.generations < 1) {
    throw new RangeError('generations must be an integer of at least one.');
  }
  if (!Number.isFinite(options.initialSigma) || options.initialSigma <= 0) {
    throw new RangeError('initialSigma must be a positive finite number.');
  }
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    const lower = valueAt(options.bounds.lower, dimension);
    const upper = valueAt(options.bounds.upper, dimension);
    const mean = valueAt(options.initialMean, dimension);
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
      throw new RangeError(`Invalid bounds at dimension ${dimension}.`);
    }
    if (!Number.isFinite(mean) || mean < lower || mean > upper) {
      throw new RangeError(`initialMean at dimension ${dimension} is outside its bounds.`);
    }
  }
}

function recombinationWeights(parentCount: number): number[] {
  const raw = new Array<number>(parentCount);
  let total = 0;
  for (let index = 0; index < parentCount; index += 1) {
    const weight = Math.log(parentCount + 0.5) - Math.log(index + 1);
    raw[index] = weight;
    total += weight;
  }
  return raw.map((weight) => weight / total);
}

function createRandom(seed: number): { normal: () => number } {
  let state = seed >>> 0;
  let spare: number | undefined;

  const nextUnit = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };

  return {
    normal: () => {
      if (spare !== undefined) {
        const value = spare;
        spare = undefined;
        return value;
      }
      const magnitude = Math.sqrt(-2 * Math.log(Math.max(nextUnit(), Number.MIN_VALUE)));
      const angle = 2 * Math.PI * nextUnit();
      spare = magnitude * Math.sin(angle);
      return magnitude * Math.cos(angle);
    },
  };
}

function checkedScore(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError('CMA-ES objective must return a finite score.');
  }
  return value;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function euclideanNorm(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0));
}

function valueAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`Array index ${index} is outside the available values.`);
  }
  return value;
}
