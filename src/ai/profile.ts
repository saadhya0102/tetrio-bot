import type { EvaluationProfile, EvaluationWeights } from './evaluator.js';

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

/**
 * Clones profile data so tuning experiments never mutate the evaluator's
 * imported defaults by reference.
 */
export function cloneEvaluationProfile(profile: EvaluationProfile): EvaluationProfile {
  return {
    pressure: { ...profile.pressure },
    downstack: { ...profile.downstack },
    survival: { ...profile.survival },
  };
}

/**
 * Validates a JSON-compatible evaluation profile before an offline tournament
 * uses it. Unknown fields are ignored; every known weight is required.
 */
export function parseEvaluationProfile(value: unknown): EvaluationProfile {
  const profile = asRecord(value, 'Evaluation profile');
  const parsed = {} as Record<(typeof MODES)[number], EvaluationWeights>;

  for (const mode of MODES) {
    const rawWeights = asRecord(profile[mode], `Evaluation profile.${mode}`);
    const weights = {} as Record<keyof EvaluationWeights, number>;
    for (const key of WEIGHT_KEYS) {
      const weight = rawWeights[key];
      if (typeof weight !== 'number' || !Number.isFinite(weight)) {
        throw new TypeError(`Evaluation profile.${mode}.${key} must be a finite number.`);
      }
      weights[key] = weight;
    }
    parsed[mode] = weights;
  }

  return {
    pressure: parsed.pressure,
    downstack: parsed.downstack,
    survival: parsed.survival,
  };
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}
