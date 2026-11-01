import { Engine, Mino } from '@haelp/teto/engine';
import { describe, expect, it } from 'vitest';

import { normalizeKeyFrames, replayKeyFramesFromSnapshot } from './frame-replay.js';
import { FrameReachability } from './frame-reachability.js';
import { LiveMoveEnumerator } from './live-enumerator.js';
import { searchStateFromEngine } from './state.js';
import { testEngineOptions } from './test-fixture.js';

describe('LiveMoveEnumerator', () => {
  it('finds legal moves in an isolated engine without mutating gameplay state', () => {
    const engine = new Engine(testEngineOptions());
    const originalBoard = JSON.stringify(engine.board.state);
    const originalPiece = engine.falling.symbol;
    const originalPiecesPlaced = engine.stats.pieces;
    const originalSnapshot = JSON.stringify(engine.snapshot());

    const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.actions).toEqual(['hardDrop']);
    expect(
      candidates.some(
        (candidate) =>
          candidate.actions.length === 2 &&
          candidate.actions[0] === 'hold' &&
          candidate.actions[1] === 'hardDrop',
      ),
    ).toBe(true);
    expect(JSON.stringify(engine.board.state)).toBe(originalBoard);
    expect(engine.falling.symbol).toBe(originalPiece);
    expect(engine.stats.pieces).toBe(originalPiecesPlaced);
    expect(JSON.stringify(engine.snapshot())).toBe(originalSnapshot);

    for (const candidate of candidates) {
      const replay = replayKeyFramesFromSnapshot(engine, engine.snapshot(), candidate.frames);
      expect(replay.stats.pieces).toBe(1);
      expect(candidate.facts.rawAttack).toBeGreaterThanOrEqual(candidate.outcome.attack);
      expect(candidate.facts.cancelled).toBe(candidate.facts.rawAttack - candidate.outcome.attack);
      expect(candidate.facts.garbageAdded).toBeGreaterThanOrEqual(0);

      const replayed = searchStateFromEngine(replay);
      expect(replayed.board.key()).toBe(candidate.outcome.state.board.key());
      expect(replayed.current).toBe(candidate.outcome.state.current);
      expect(replayed.hold).toBe(candidate.outcome.state.hold);
      expect(replayed.queue).toEqual(candidate.outcome.state.queue);
    }
  });

  it('does not emit 180-degree inputs when the room disables them', () => {
    const options = testEngineOptions();
    options.misc.allowed.spin180 = false;
    const engine = new Engine(options);

    const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => !candidate.actions.includes('rotate180'))).toBe(true);
  });

  it('does not emit hard-drop plans when the room disables hard drop', () => {
    const options = testEngineOptions();
    options.misc.allowed.hardDrop = false;
    const engine = new Engine(options);

    const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);

    expect(candidates).toEqual([]);
  });

  it('does not predict hard-drop moves while safe lock is active', () => {
    const engine = new Engine(testEngineOptions());
    engine.falling.safeLock = 1;

    const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);

    expect(candidates).toEqual([]);
  });

  it('rejects plans whose scheduled subframe locks the source piece first', () => {
    const options = testEngineOptions();
    options.gravity.value = 1;
    const engine = new Engine(options);
    while (engine.softDrop()) {
      // Move to a valid grounded state through Triangle's own movement API.
    }
    engine.falling.locking = 29.9;
    engine.subframe = 0.5;

    const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);

    expect(candidates).toEqual([]);
  });

  it('records Triangle’s actual locked rotation for non-SRS rules', () => {
    const options = testEngineOptions();
    options.kickTable = 'NRS';
    const engine = new Engine(options);
    engine.initiatePiece(Mino.T);

    const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);
    const noInputRotation = candidates.find(
      (candidate) => candidate.actions.length === 1 && candidate.actions[0] === 'hardDrop',
    );

    expect(noInputRotation).toBeDefined();
    expect(noInputRotation?.outcome.placement.rotation).toBe(engine.falling.rotation);
  });

  it('replays controller frames at their scheduled engine frames', () => {
    const engine = new Engine(testEngineOptions());
    const sourceSnapshot = engine.snapshot();
    const replay = replayKeyFramesFromSnapshot(engine, sourceSnapshot, [
      {
        type: 'keydown',
        frame: 0,
        data: { key: 'moveLeft', subframe: 0 },
      },
      {
        type: 'keyup',
        frame: 0,
        data: { key: 'moveLeft', subframe: 0.1 },
      },
      {
        type: 'keydown',
        frame: 1,
        data: { key: 'hardDrop', subframe: 0 },
      },
      {
        type: 'keyup',
        frame: 1,
        data: { key: 'hardDrop', subframe: 0.1 },
      },
    ]);

    expect(replay.frame).toBe(2);
    expect(replay.stats.pieces).toBe(1);
    expect(JSON.stringify(engine.snapshot())).toBe(JSON.stringify(sourceSnapshot));
  });

  it('carries rounded subframe boundaries into the following engine frame', () => {
    const frames = normalizeKeyFrames([
      {
        type: 'keydown',
        frame: 5,
        data: { key: 'moveLeft', subframe: 1 },
      },
    ]);

    expect(frames).toEqual([
      {
        type: 'keydown',
        frame: 6,
        data: { key: 'moveLeft', subframe: 0 },
      },
    ]);
  });

  it('returns only frame-replayable candidates from bounded input search', () => {
    const engine = new Engine(testEngineOptions());
    const sourceSnapshot = JSON.stringify(engine.snapshot());
    const result = new FrameReachability().enumerate(engine, {
      deadline: performance.now() + 1_000,
      maxCandidates: 32,
      maxDepth: 3,
      maxNodes: 64,
      maxSoftDrops: 1,
      maxTransitions: 256,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(JSON.stringify(engine.snapshot())).toBe(sourceSnapshot);
    for (const candidate of result.candidates) {
      const replay = replayKeyFramesFromSnapshot(engine, engine.snapshot(), candidate.frames);
      const replayed = searchStateFromEngine(replay);
      expect(replayed.board.key()).toBe(candidate.outcome.state.board.key());
      expect(replayed.current).toBe(candidate.outcome.state.current);
      expect(replayed.hold).toBe(candidate.outcome.state.hold);
      expect(replayed.queue).toEqual(candidate.outcome.state.queue);
    }
  });

  it('honors zero bounded-reachability candidate and transition limits', () => {
    const engine = new Engine(testEngineOptions());
    const reachability = new FrameReachability();
    const candidateLimited = reachability.enumerate(engine, {
      deadline: performance.now() + 1_000,
      maxCandidates: 0,
      maxDepth: 3,
      maxNodes: 64,
      maxSoftDrops: 1,
      maxTransitions: 256,
    });
    const transitionLimited = reachability.enumerate(engine, {
      deadline: performance.now() + 1_000,
      maxCandidates: 32,
      maxDepth: 3,
      maxNodes: 64,
      maxSoftDrops: 1,
      maxTransitions: 0,
    });

    expect(candidateLimited).toMatchObject({
      candidates: [],
      complete: false,
      expanded: 0,
      stopReason: 'candidate-limit',
      transitions: 0,
    });
    expect(transitionLimited).toMatchObject({
      candidates: [],
      complete: false,
      expanded: 0,
      stopReason: 'transition-limit',
      transitions: 0,
    });
  });

  it('does not certify timed soft-drop plans for finite-movement rooms', () => {
    const options = testEngineOptions();
    options.misc.movement.infinite = false;
    const engine = new Engine(options);
    const result = new FrameReachability().enumerate(engine, {
      deadline: performance.now() + 1_000,
      maxCandidates: 32,
      maxDepth: 3,
      maxNodes: 64,
      maxSoftDrops: 3,
      maxTransitions: 256,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((candidate) => !candidate.actions.includes('softDrop'))).toBe(
      true,
    );
  });

  it('captures exact cancellation facts for a line-clear candidate', () => {
    const engine = new Engine(testEngineOptions());
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < engine.board.width; x += 1) {
        if (x !== 4) {
          engine.board.add([{ mino: Mino.J, connections: 0 }, x, y]);
        }
      }
    }
    engine.initiatePiece(Mino.I);
    engine.receiveGarbage({
      amount: 6,
      cid: 1,
      confirmed: true,
      frame: 0,
      gameid: 1,
      size: 1,
    });

    const candidates = new LiveMoveEnumerator().enumerate(engine, performance.now() + 1_000);
    const tetris = candidates.find((candidate) => candidate.outcome.lines === 4);

    expect(tetris).toBeDefined();
    expect(tetris?.facts.rawAttack).toBeGreaterThan(0);
    expect(tetris?.facts.cancelled).toBeGreaterThan(0);
    expect(tetris?.facts.cancelled).toBe(
      (tetris?.facts.rawAttack ?? 0) - (tetris?.outcome.attack ?? 0),
    );
    expect(tetris?.facts.garbageAdded).toBe(0);
    expect(tetris?.facts.garbageBefore).toMatchObject({
      active: 6,
      confirmed: 6,
      pending: 6,
    });
    expect(tetris?.facts.garbageAfter.pending).toBe(2);
  });
});
