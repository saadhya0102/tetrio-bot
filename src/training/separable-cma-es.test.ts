import { describe, expect, it } from 'vitest';

import { optimizeSeparableCmaEs } from './separable-cma-es.js';

describe('separable CMA-ES', () => {
  it('deterministically improves a bounded smooth objective', () => {
    const options = {
      bounds: {
        lower: [-5, -5],
        upper: [5, 5],
      },
      generations: 20,
      initialMean: [0, 0],
      initialSigma: 1,
      populationSize: 8,
      seed: 0x434d4145,
    };
    const objective = ([x, y]: readonly number[]) => {
      if (x === undefined || y === undefined) {
        throw new Error('Expected two CMA-ES dimensions.');
      }
      return -((x - 1.5) ** 2 + (y + 2) ** 2);
    };

    const first = optimizeSeparableCmaEs(options, objective);
    const second = optimizeSeparableCmaEs(options, objective);

    expect(second).toEqual(first);
    expect(first.bestScore).toBeGreaterThan(-0.05);
    expect(first.evaluations).toBe(161);
  });
});
