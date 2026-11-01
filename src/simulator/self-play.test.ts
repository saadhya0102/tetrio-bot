import { describe, expect, it } from 'vitest';

import { runSelfPlay } from './self-play.js';

describe('runSelfPlay', () => {
  it('reports an exhausted decision budget separately from a top out', () => {
    const result = runSelfPlay({
      seed: 1,
      pieces: 1,
      planner: {
        beamWidth: 2,
        lookahead: 1,
      },
      decisionBudgetMs: 0,
    });

    expect(result.timedOut).toBe(true);
    expect(result.toppedOut).toBe(false);
  });
});
