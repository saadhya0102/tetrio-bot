import { Engine, Mino } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { describe, expect, it, vi } from 'vitest';

import type { LiveMoveCandidate, PlannerSettings, SearchState } from '../ai/types.js';
import { LiveMoveEnumerator } from './live-enumerator.js';
import { TetrioController, type ControllerSettings } from './controller.js';
import { searchStateFromEngine } from './state.js';
import { testEngineOptions } from './test-fixture.js';

interface ControllerTestAccess {
  selectCandidate(
    before: SearchState,
    candidates: readonly LiveMoveCandidate[],
    deadline: number,
    plannerSettings: PlannerSettings,
  ): LiveMoveCandidate | undefined;
  candidatePool(
    engine: Engine,
    fastCandidates: readonly LiveMoveCandidate[],
    deadline: number,
  ): readonly LiveMoveCandidate[];
  settingsForEngine(engine: Engine): PlannerSettings;
}

const settings: ControllerSettings = {
  beamWidth: 12,
  debug: false,
  lookahead: 3,
  pps: 3.8,
  timeBudgetMs: 12,
};

describe('TetrioController candidate selection', () => {
  it('returns the first replay-validated candidate when no scoring time remains', () => {
    const engine = new Engine(testEngineOptions());
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < engine.board.width; x += 1) {
        if (x !== 4) {
          engine.board.add([{ mino: Mino.J, connections: 0 }, x, y]);
        }
      }
    }
    engine.initiatePiece(Mino.I);

    const before = searchStateFromEngine(engine);
    const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);
    const first = candidates[0];
    const controller = new TetrioController(settings);
    const selected = (controller as unknown as ControllerTestAccess).selectCandidate(
      before,
      candidates,
      performance.now() - 1,
      settings,
    );

    expect(first).toBeDefined();
    expect(selected).toBe(first);
  });

  it('uses exact-root-only planning for non-SRS rooms', () => {
    const options = testEngineOptions();
    options.kickTable = 'NRS';
    const engine = new Engine(options);
    const controller = new TetrioController(settings);

    const plannerSettings = (controller as unknown as ControllerTestAccess).settingsForEngine(
      engine,
    );

    expect(plannerSettings.lookahead).toBe(1);
  });

  it('uses exact-root-only planning while live garbage is queued', () => {
    const engine = new Engine(testEngineOptions());
    engine.receiveGarbage({
      amount: 2,
      cid: 1,
      confirmed: true,
      frame: 0,
      gameid: 1,
      size: 1,
    });
    const controller = new TetrioController(settings);

    const plannerSettings = (controller as unknown as ControllerTestAccess).settingsForEngine(
      engine,
    );

    expect(plannerSettings.lookahead).toBe(1);
  });

  it('supplements a sparse fast pool without replacing it', () => {
    const engine = new Engine(testEngineOptions());
    const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);
    const first = candidates[0];
    const second = candidates[1];
    if (!first || !second) {
      throw new Error('Expected two replay-validated fixture candidates.');
    }
    const reachability = {
      enumerate: vi.fn(() => ({
        candidates: [second],
        complete: false,
        expanded: 1,
        stopReason: 'deadline' as const,
        transitions: 1,
      })),
    };
    const controller = new TetrioController(settings, { reachability });

    const pool = (controller as unknown as ControllerTestAccess).candidatePool(
      engine,
      [first],
      performance.now() + 100,
    );

    expect(pool).toEqual([first, second]);
    expect(reachability.enumerate).toHaveBeenCalledWith(
      engine,
      expect.objectContaining({
        maxCandidates: 11,
        maxDepth: 4,
        maxNodes: 20,
        maxSoftDrops: 1,
        maxTransitions: 32,
      }),
    );
  });

  it('retains fast candidates when the optional supplement fails', () => {
    const engine = new Engine(testEngineOptions());
    const first = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000)[0];
    if (!first) {
      throw new Error('Expected a replay-validated fixture candidate.');
    }
    const controller = new TetrioController(settings, {
      reachability: {
        enumerate: () => {
          throw new Error('fixture failure');
        },
      },
    });

    const pool = (controller as unknown as ControllerTestAccess).candidatePool(
      engine,
      [first],
      performance.now() + 100,
    );

    expect(pool).toEqual([first]);
  });

  it('never emits an unvalidated emergency hard drop and retries the piece', () => {
    const engine = new Engine(testEngineOptions());
    const enumerate = vi.fn(() => []);
    const controller = new TetrioController(settings, {
      enumerator: { enumerate },
      reachability: {
        enumerate: () => ({
          candidates: [],
          complete: false,
          expanded: 0,
          stopReason: 'deadline',
          transitions: 0,
        }),
      },
    });

    expect(controller.tick({ engine } as Game.Tick.In)).toEqual({});
    expect(controller.tick({ engine } as Game.Tick.In)).toEqual({});
    expect(enumerate).toHaveBeenCalledTimes(2);
  });
});
