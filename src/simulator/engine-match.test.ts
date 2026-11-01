import type { Engine } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { describe, expect, it } from 'vitest';

import { ENGINE_MATCH_PROTOCOL } from './engine-match-profile.js';
import { runEngineMatch, runPairedEngineMatch } from './engine-match.js';
import { createBeamEngineMatchPolicy, type EngineMatchPolicy } from './engine-match-policy.js';

function hardDropFrames(engine: Engine): readonly Game.Tick.Keypress[] {
  return [
    {
      data: { key: 'hardDrop', subframe: 0 },
      frame: engine.frame,
      type: 'keydown',
    },
    {
      data: { key: 'hardDrop', subframe: 0 },
      frame: engine.frame,
      type: 'keyup',
    },
  ];
}

function hardDropPolicy(id = 'hard-drop'): EngineMatchPolicy {
  return {
    choose: hardDropFrames,
    id,
    revision: 'v1',
  };
}

describe('Triangle engine matchup harness', () => {
  it('replays a seeded frame battle with the same digest', () => {
    const policy = hardDropPolicy();
    const options = {
      left: policy,
      maxFrames: 5,
      right: policy,
      seed: 0x51a7e,
    };

    const first = runEngineMatch(options);
    const second = runEngineMatch(options);

    expect(second).toEqual(first);
    expect(first.protocol).toBe(ENGINE_MATCH_PROTOCOL);
    expect(first.valid).toBe(true);
    expect(first.left.pieces + first.right.pieces).toBe(10);
    expect(first.traceDigest).toHaveLength(64);
  });

  it('routes delayed local-engine garbage under a deterministic policy', () => {
    const policy = createBeamEngineMatchPolicy({
      id: 'beam',
      planner: {
        beamWidth: 4,
        lookahead: 1,
      },
    });
    const result = runEngineMatch({
      left: policy,
      maxFrames: 20,
      right: policy,
      seed: 123,
    });

    expect(result.valid).toBe(true);
    expect(result.left.attacksSent + result.right.attacksSent).toBeGreaterThan(0);
    expect(result.left.attacksDelivered + result.right.attacksDelivered).toBeGreaterThan(0);
  });

  it('rejects a policy that mutates the synchronized engine', () => {
    const mutating: EngineMatchPolicy = {
      choose(engine) {
        engine.moveLeft();
        return hardDropFrames(engine);
      },
      id: 'mutating',
      revision: 'v1',
    };
    const safe = hardDropPolicy('safe');

    const result = runEngineMatch({
      left: mutating,
      maxFrames: 5,
      right: safe,
      seed: 99,
    });

    expect(result.valid).toBe(false);
    expect(result.terminalReason).toBe('invalid-policy');
    expect(result.left.invalidReason).toBe('Policy mutated the engine.');
  });

  it('rejects plans outside the controller subframe contract', () => {
    const invalidTiming: EngineMatchPolicy = {
      choose(engine) {
        return [
          {
            data: { key: 'hardDrop', subframe: 1 },
            frame: engine.frame,
            type: 'keydown',
          },
        ];
      },
      id: 'invalid-timing',
      revision: 'v1',
    };

    const result = runEngineMatch({
      left: invalidTiming,
      maxFrames: 5,
      right: hardDropPolicy('safe'),
      seed: 100,
    });

    expect(result.valid).toBe(false);
    expect(result.left.invalidReason).toBe('Policy returned no valid frame plan.');
  });

  it('swaps policies over identical physical-seat streams', () => {
    const policy = hardDropPolicy();
    const result = runPairedEngineMatch({
      baseline: policy,
      candidate: { ...policy, id: 'candidate' },
      maxFrames: 5,
      seed: 42,
    });

    expect(result.valid).toBe(true);
    expect(result.candidateWins + result.baselineWins + result.draws).toBe(2);
    expect(result.protocol).toBe(ENGINE_MATCH_PROTOCOL);
    expect(result.traceDigest).toHaveLength(64);
  });
});
