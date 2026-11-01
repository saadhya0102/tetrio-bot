import { Engine, Mino } from '@haelp/teto/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { replayKeyFramesFromSnapshot } from './frame-replay.js';
import { LiveMoveEnumerator } from './live-enumerator.js';
import { searchStateFromEngine } from './state.js';
import { testEngineOptions } from './test-fixture.js';

const lowStackFixture = fc.record({
  cells: fc.array(
    fc.record({
      x: fc.integer({ min: 0, max: 9 }),
      y: fc.integer({ min: 0, max: 7 }),
    }),
    { maxLength: 28 },
  ),
  holdEnabled: fc.boolean(),
  piece: fc.constantFrom(Mino.I, Mino.J, Mino.L, Mino.O, Mino.S, Mino.T, Mino.Z),
  spin180Enabled: fc.boolean(),
});

describe('LiveMoveEnumerator properties', () => {
  it('preserves source state and emits only exact frame-replayable moves', () => {
    fc.assert(
      fc.property(lowStackFixture, (fixture) => {
        const options = testEngineOptions();
        options.misc.allowed.hold = fixture.holdEnabled;
        options.misc.allowed.spin180 = fixture.spin180Enabled;
        const engine = new Engine(options);
        for (const cell of fixture.cells) {
          engine.board.add([{ mino: Mino.J, connections: 0 }, cell.x, cell.y]);
        }
        engine.initiatePiece(fixture.piece);

        const source = JSON.stringify(engine.snapshot());
        const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);

        expect(candidates.length).toBeGreaterThan(0);
        expect(JSON.stringify(engine.snapshot())).toBe(source);

        for (const candidate of candidates) {
          expect(candidate.facts.rawAttack).toBeGreaterThanOrEqual(candidate.outcome.attack);
          expect(candidate.facts.cancelled).toBe(
            candidate.facts.rawAttack - candidate.outcome.attack,
          );
          expect(candidate.facts.garbageAdded).toBeGreaterThanOrEqual(0);
          if (!fixture.spin180Enabled) {
            expect(candidate.actions).not.toContain('rotate180');
          }
          if (!fixture.holdEnabled) {
            expect(candidate.actions).not.toContain('hold');
          }

          const replay = replayKeyFramesFromSnapshot(engine, engine.snapshot(), candidate.frames);
          const replayed = searchStateFromEngine(replay);
          expect(replay.stats.pieces).toBe(engine.stats.pieces + 1);
          expect(replayed.board.key()).toBe(candidate.outcome.state.board.key());
          expect(replayed.current).toBe(candidate.outcome.state.current);
          expect(replayed.queue).toEqual(candidate.outcome.state.queue);
          expect(replayed.hold).toBe(candidate.outcome.state.hold);
          expect(replayed.canHold).toBe(candidate.outcome.state.canHold);
          expect(replayed.combo).toBe(candidate.outcome.state.combo);
          expect(replayed.b2b).toBe(candidate.outcome.state.b2b);
          expect(replayed.pendingGarbage).toBe(candidate.outcome.state.pendingGarbage);
          expect(replayed.playHeight).toBe(candidate.outcome.state.playHeight);
        }
      }),
      {
        numRuns: 75,
        seed: 20_260_813,
        verbose: 2,
      },
    );
  }, 15_000);
});
