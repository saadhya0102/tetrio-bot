import type { Engine, EngineSnapshot } from '@haelp/teto/engine';

import { isPiece, type Piece } from '../ai/tetrominoes.js';
import type { InputAction, LiveGarbageState, LiveMoveCandidate, MoveOutcome } from '../ai/types.js';
import { FrameActionReplayer } from './frame-replay.js';
import { garbageStateFromEngine, searchStateFromEngine } from './state.js';

interface EnumerationRoot {
  garbageBefore: LiveGarbageState;
  pieces: number;
  replayer: FrameActionReplayer;
  snapshot: EngineSnapshot;
}

/**
 * Uses detached Triangle states to discover first-ply action paths, then replays
 * every emitted key plan from the synchronized source snapshot. Candidate
 * legality, placement facts, SRS kicks, line clears, garbage cancellation, and
 * T-spin scoring therefore reflect the pinned local engine model rather than a
 * direct-API approximation.
 */
export class LiveMoveEnumerator {
  enumerate(engine: Engine, deadline: number): readonly LiveMoveCandidate[] {
    if (!engine.misc.allowed.hardDrop || engine.falling.safeLock !== 0) {
      return [];
    }

    const snapshot = copySnapshot(engine.snapshot());
    const root: EnumerationRoot = {
      garbageBefore: garbageStateFromEngine(engine),
      pieces: engine.stats.pieces,
      replayer: new FrameActionReplayer(engine, snapshot),
      snapshot,
    };
    const sandbox = engine.clone();
    sandbox.fromSnapshot(copySnapshot(root.snapshot));
    const candidates = new Map<string, LiveMoveCandidate>();

    // Seed the pool with exact replay-validated anchors before spending the
    // remaining deadline on broader geometry. They provide a safe fallback and
    // ensure hold is not starved by the main no-hold exploration order.
    this.recordCandidate(sandbox, [], deadline, candidates, root);
    sandbox.fromSnapshot(copySnapshot(root.snapshot));
    if (!sandbox.holdLocked && sandbox.hold()) {
      this.recordCandidate(sandbox, ['hold'], deadline, candidates, root);
    }

    for (const useHold of [false, true]) {
      if (performance.now() >= deadline) {
        break;
      }

      sandbox.fromSnapshot(copySnapshot(root.snapshot));
      const prefix: InputAction[] = [];
      if (useHold) {
        if (sandbox.holdLocked || !sandbox.hold()) {
          continue;
        }
        prefix.push('hold');
      }

      const heldSnapshot = copySnapshot(sandbox.snapshot());
      const heldPieceIsT = heldSnapshot.falling.symbol === 't';
      for (let rotationCount = 0; rotationCount < 4; rotationCount += 1) {
        if (performance.now() >= deadline) {
          break;
        }

        sandbox.fromSnapshot(copySnapshot(heldSnapshot));
        const rotationActions = [...prefix];
        let rotationWorked = true;
        for (let rotation = 0; rotation < rotationCount; rotation += 1) {
          if (!sandbox.rotateCW()) {
            rotationWorked = false;
            break;
          }
          rotationActions.push('rotateCW');
        }
        if (!rotationWorked) {
          continue;
        }

        const rotatedSnapshot = copySnapshot(sandbox.snapshot());
        this.enumerateDisplacements(
          sandbox,
          rotatedSnapshot,
          rotationActions,
          deadline,
          candidates,
          root,
        );
      }

      for (const alternativeRotation of ['rotateCCW', 'rotate180'] as const) {
        if (performance.now() >= deadline) {
          break;
        }
        if (alternativeRotation === 'rotate180' && !sandbox.misc.allowed.spin180) {
          continue;
        }
        sandbox.fromSnapshot(copySnapshot(heldSnapshot));
        const rotated =
          alternativeRotation === 'rotateCCW' ? sandbox.rotateCCW() : sandbox.rotate180();
        if (!rotated) {
          continue;
        }
        this.enumerateDisplacements(
          sandbox,
          sandbox.snapshot(),
          [...prefix, alternativeRotation],
          deadline,
          candidates,
          root,
        );
      }

      // Moving first and rotating last preserves T-spin state in the engine.
      // Limit this additional branch to T pieces so normal move selection keeps
      // its predictable time budget.
      if (heldPieceIsT) {
        for (let rotationCount = 1; rotationCount < 4; rotationCount += 1) {
          if (performance.now() >= deadline) {
            break;
          }
          this.tryShiftThenRotate(
            sandbox,
            heldSnapshot,
            prefix,
            rotationCount,
            0,
            'moveLeft',
            deadline,
            candidates,
            root,
          );
          let canMoveLeft = true;
          let canMoveRight = true;
          for (let distance = 1; distance <= sandbox.board.width; distance += 1) {
            if (canMoveLeft) {
              canMoveLeft = this.tryShiftThenRotate(
                sandbox,
                heldSnapshot,
                prefix,
                rotationCount,
                distance,
                'moveLeft',
                deadline,
                candidates,
                root,
              );
            }
            if (canMoveRight) {
              canMoveRight = this.tryShiftThenRotate(
                sandbox,
                heldSnapshot,
                prefix,
                rotationCount,
                distance,
                'moveRight',
                deadline,
                candidates,
                root,
              );
            }
            if (!canMoveLeft && !canMoveRight) {
              break;
            }
          }
        }
      }
    }

    return [...candidates.values()];
  }

  private enumerateDisplacements(
    sandbox: Engine,
    snapshot: ReturnType<Engine['snapshot']>,
    prefix: readonly InputAction[],
    deadline: number,
    candidates: Map<string, LiveMoveCandidate>,
    root: EnumerationRoot,
  ): void {
    this.tryDisplacement(sandbox, snapshot, prefix, 0, 'moveLeft', deadline, candidates, root);
    let canMoveLeft = true;
    let canMoveRight = true;
    for (let distance = 1; distance <= sandbox.board.width; distance += 1) {
      if (canMoveLeft) {
        canMoveLeft = this.tryDisplacement(
          sandbox,
          snapshot,
          prefix,
          distance,
          'moveLeft',
          deadline,
          candidates,
          root,
        );
      }
      if (canMoveRight) {
        canMoveRight = this.tryDisplacement(
          sandbox,
          snapshot,
          prefix,
          distance,
          'moveRight',
          deadline,
          candidates,
          root,
        );
      }
      if (!canMoveLeft && !canMoveRight) {
        break;
      }
    }
  }

  private tryDisplacement(
    sandbox: Engine,
    snapshot: ReturnType<Engine['snapshot']>,
    prefix: readonly InputAction[],
    distance: number,
    direction: 'moveLeft' | 'moveRight',
    deadline: number,
    candidates: Map<string, LiveMoveCandidate>,
    root: EnumerationRoot,
  ): boolean {
    if (performance.now() >= deadline) {
      return false;
    }

    sandbox.fromSnapshot(copySnapshot(snapshot));
    const actions = [...prefix];
    for (let step = 0; step < distance; step += 1) {
      const moved = direction === 'moveLeft' ? sandbox.moveLeft() : sandbox.moveRight();
      if (!moved) {
        return false;
      }
      actions.push(direction);
    }

    this.recordCandidate(sandbox, actions, deadline, candidates, root);
    return true;
  }

  private tryShiftThenRotate(
    sandbox: Engine,
    snapshot: ReturnType<Engine['snapshot']>,
    prefix: readonly InputAction[],
    rotation: number,
    distance: number,
    direction: 'moveLeft' | 'moveRight',
    deadline: number,
    candidates: Map<string, LiveMoveCandidate>,
    root: EnumerationRoot,
  ): boolean {
    if (performance.now() >= deadline) {
      return false;
    }

    sandbox.fromSnapshot(copySnapshot(snapshot));
    const actions = [...prefix];
    for (let step = 0; step < distance; step += 1) {
      const moved = direction === 'moveLeft' ? sandbox.moveLeft() : sandbox.moveRight();
      if (!moved) {
        return false;
      }
      actions.push(direction);
    }
    for (let step = 0; step < rotation; step += 1) {
      if (!sandbox.rotateCW()) {
        return false;
      }
      actions.push('rotateCW');
    }

    this.recordCandidate(sandbox, actions, deadline, candidates, root);
    return true;
  }

  private recordCandidate(
    sandbox: Engine,
    actions: readonly InputAction[],
    deadline: number,
    candidates: Map<string, LiveMoveCandidate>,
    root: EnumerationRoot,
  ): void {
    if (performance.now() >= deadline || sandbox.falling.safeLock !== 0) {
      return;
    }

    const plannedActions: InputAction[] = [...actions, 'hardDrop'];
    const replay = root.replayer.replay(plannedActions);
    if (replay.locks.length !== 1 || replay.engine.stats.pieces !== root.pieces + 1) {
      return;
    }
    const capture = replay.locks[0];
    if (!capture || capture.lock.topout) {
      return;
    }

    const rawAttack = capture.lock.rawGarbage.reduce((total, garbage) => total + garbage, 0);
    const attack = capture.lock.garbage.reduce((total, garbage) => total + garbage, 0);
    const garbageAdded =
      capture.lock.garbageAdded === false
        ? 0
        : capture.lock.garbageAdded.reduce((total, garbage) => total + garbage.amount, 0);
    const outcome: MoveOutcome = {
      placement: {
        piece: toPiece(capture.mino),
        rotation: capture.rotation,
        x: capture.x,
        useHold: capture.usedHold,
      },
      state: searchStateFromEngine(replay.engine),
      lines: capture.lock.lines,
      attack,
      perfectClear: replay.engine.board.perfectClear,
      spin: normalizeSpin(capture.lock.spin),
    };
    const candidate: LiveMoveCandidate = {
      actions: plannedActions,
      frames: replay.frames,
      facts: {
        cancelled: Math.max(0, rawAttack - attack),
        garbageAfter: garbageStateFromEngine(replay.engine),
        garbageBefore: root.garbageBefore,
        garbageAdded,
        rawAttack,
      },
      outcome,
    };
    const signature = [
      outcome.state.board.key(),
      outcome.state.current,
      outcome.state.hold ?? '-',
      outcome.state.queue.slice(0, 4).join(''),
      outcome.state.combo,
      outcome.state.b2b,
      outcome.state.pendingGarbage,
      outcome.spin,
      candidate.facts.rawAttack,
      candidate.facts.cancelled,
      candidate.facts.garbageAdded,
      candidate.facts.garbageAfter.active,
      candidate.facts.garbageAfter.confirmed,
      candidate.facts.garbageAfter.earliestTankFrame ?? '-',
    ].join('|');
    const existing = candidates.get(signature);
    if (!existing || candidateValue(candidate) > candidateValue(existing)) {
      candidates.set(signature, candidate);
    }
  }
}

function copySnapshot(snapshot: ReturnType<Engine['snapshot']>): ReturnType<Engine['snapshot']> {
  return structuredClone(snapshot);
}

function toPiece(value: string): Piece {
  if (!isPiece(value)) {
    throw new Error(`The room returned an unsupported piece type "${value}".`);
  }
  return value;
}

function normalizeSpin(value: string | null): 'none' | 'mini' | 'normal' {
  if (value === 'mini' || value === 'normal') {
    return value;
  }
  return 'none';
}

function candidateValue(candidate: LiveMoveCandidate): number {
  const { outcome } = candidate;
  return (
    outcome.attack * 20 +
    outcome.lines * 2 +
    (outcome.spin === 'normal' ? 3 : 0) +
    candidate.facts.cancelled * 5 -
    candidate.facts.garbageAdded * 8
  );
}
