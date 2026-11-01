import { Engine } from '@haelp/teto/engine';
import { describe, expect, it } from 'vitest';

import { garbageStateFromEngine, searchStateFromEngine } from './state.js';
import { testEngineOptions } from './test-fixture.js';

describe('engine state adaptation', () => {
  it('preserves queued garbage timing facts at the live root', () => {
    const options = testEngineOptions();
    options.garbage.garbage.speed = 2;
    const engine = new Engine(options);
    engine.frame = 2;
    engine.receiveGarbage(
      {
        amount: 2,
        cid: 1,
        confirmed: false,
        frame: 5,
        gameid: 1,
        size: 1,
      },
      {
        amount: 3,
        cid: 2,
        confirmed: true,
        frame: 0,
        gameid: 1,
        size: 1,
      },
    );

    expect(garbageStateFromEngine(engine)).toEqual({
      active: 3,
      confirmed: 3,
      earliestTankFrame: 2,
      pending: 5,
    });
    expect(searchStateFromEngine(engine).pendingGarbage).toBe(5);
  });
});
