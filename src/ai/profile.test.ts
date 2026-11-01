import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEFAULT_EVALUATION_PROFILE } from './evaluator.js';
import { cloneEvaluationProfile, parseEvaluationProfile } from './profile.js';

describe('evaluation profiles', () => {
  it('clones profiles without mutating imported defaults', () => {
    const clone = cloneEvaluationProfile(DEFAULT_EVALUATION_PROFILE);
    clone.pressure.attack = 999;

    expect(DEFAULT_EVALUATION_PROFILE.pressure.attack).not.toBe(999);
  });

  it('accepts complete finite JSON-compatible profiles', () => {
    const parsed = parseEvaluationProfile(JSON.parse(JSON.stringify(DEFAULT_EVALUATION_PROFILE)));

    expect(parsed).toEqual(DEFAULT_EVALUATION_PROFILE);
  });

  it('keeps the shipped default profile fixture synchronized', () => {
    const fixture = JSON.parse(readFileSync('profiles/default.json', 'utf8'));

    expect(parseEvaluationProfile(fixture)).toEqual(DEFAULT_EVALUATION_PROFILE);
  });

  it('rejects profiles with missing or non-finite weights', () => {
    const missing = JSON.parse(JSON.stringify(DEFAULT_EVALUATION_PROFILE)) as Record<
      string,
      unknown
    >;
    delete (missing.pressure as Record<string, unknown>).attack;

    expect(() => parseEvaluationProfile(missing)).toThrow('pressure.attack');
    expect(() =>
      parseEvaluationProfile({
        pressure: {},
        downstack: {},
        survival: {},
      }),
    ).toThrow('pressure.aggregateHeight');
  });
});
