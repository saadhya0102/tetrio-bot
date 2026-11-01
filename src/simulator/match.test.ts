import { describe, expect, it } from 'vitest';

import { LOCAL_MATCH_PROTOCOL, runMatch, runPairedMatch, type MatchPolicy } from './match.js';

const baseline: MatchPolicy = {
  id: 'baseline',
  planner: {
    beamWidth: 6,
    lookahead: 2,
  },
};

describe('deterministic local matchup harness', () => {
  it('replays a seeded two-sided match identically', () => {
    const options = {
      left: baseline,
      right: baseline,
      seed: 0x51a7e,
      turns: 40,
    };

    const first = runMatch(options);
    const second = runMatch(options);

    expect(second).toEqual(first);
    expect(first.trace).toHaveLength(first.turnsPlayed);
    expect(first.traceDigest).toHaveLength(64);
    expect(first.protocol).toBe(LOCAL_MATCH_PROTOCOL);
    expect(first.left.pieces + first.right.pieces).toBeGreaterThan(0);
    expect(first.left.garbageTanked + first.right.garbageTanked).toBeGreaterThan(0);
  });

  it('runs paired seats over the same queue seeds', () => {
    const candidate: MatchPolicy = {
      id: 'candidate',
      planner: {
        beamWidth: 8,
        lookahead: 2,
      },
    };

    const paired = runPairedMatch({
      baseline,
      candidate,
      seed: 0xabc123,
      turns: 30,
    });

    expect(paired.candidateWins + paired.baselineWins + paired.draws).toBe(2);
    expect(paired.first.traceDigest).toHaveLength(64);
    expect(paired.second.traceDigest).toHaveLength(64);
    expect(paired.traceDigest).toHaveLength(64);
  });
});
