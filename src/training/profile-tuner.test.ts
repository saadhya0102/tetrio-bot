import { describe, expect, it } from 'vitest';

import { DEFAULT_EVALUATION_PROFILE } from '../ai/evaluator.js';
import { tuneEvaluationProfile } from './profile-tuner.js';

describe('profile tuner', () => {
  it('runs a reproducible train/held-out split without mutating defaults', () => {
    const options = {
      generations: 1,
      heldOutSeeds: [0x2222],
      planner: {
        beamWidth: 4,
        lookahead: 1,
      },
      populationSize: 2,
      seed: 0xc0ffee,
      trainingSeeds: [0x1111],
      turns: 10,
    };

    const first = tuneEvaluationProfile(options);
    const second = tuneEvaluationProfile(options);

    expect(second).toEqual(first);
    expect(first.training.games).toBe(2);
    expect(first.heldOut.games).toBe(2);
    expect(first.optimization.evaluations).toBe(3);
    expect(first.bestProfile).not.toBe(DEFAULT_EVALUATION_PROFILE);
    expect(DEFAULT_EVALUATION_PROFILE.pressure.attack).toBe(6.6);
  });
});
