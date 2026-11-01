import type { Engine, EngineSnapshot } from '@haelp/teto/engine';

import { isPiece, type Piece } from '../ai/tetrominoes.js';
import type { InputAction, LiveGarbageState, LiveMoveCandidate, MoveOutcome } from '../ai/types.js';
import {
  FrameActionReplayer,
  type BotActionReplay,
  type FrameLockCapture,
} from './frame-replay.js';
import { garbageStateFromEngine, searchStateFromEngine } from './state.js';

export interface FrameReachabilitySettings {
  deadline: number;
  maxCandidates: number;
  maxDepth: number;
  maxNodes: number;
  maxSoftDrops: number;
  maxTransitions: number;
}

export interface FrameReachabilityResult {
  candidates: readonly LiveMoveCandidate[];
  complete: boolean;
  expanded: number;
  stopReason: 'candidate-limit' | 'complete' | 'deadline' | 'node-limit' | 'transition-limit';
  transitions: number;
}

interface ReachNode {
  actions: readonly InputAction[];
  softDrops: number;
}

type ReplayResult = BotActionReplay;
type LockCapture = FrameLockCapture;

/**
 * A correctness-first, bounded input graph search. It replays every candidate
 * through Triangle key frames rather than treating a geometric landing as an
 * executable move. It is intentionally kept separate from the latency-critical
 * live enumerator until its profile-specific cost is benchmarked.
 */
export class FrameReachability {
  enumerate(engine: Engine, settings: FrameReachabilitySettings): FrameReachabilityResult {
    if (!engine.misc.allowed.hardDrop || engine.falling.safeLock !== 0) {
      return {
        candidates: [],
        complete: true,
        expanded: 0,
        stopReason: 'complete',
        transitions: 0,
      };
    }
    if (settings.maxCandidates <= 0) {
      return {
        candidates: [],
        complete: false,
        expanded: 0,
        stopReason: 'candidate-limit',
        transitions: 0,
      };
    }
    if (settings.maxTransitions <= 0) {
      return {
        candidates: [],
        complete: false,
        expanded: 0,
        stopReason: 'transition-limit',
        transitions: 0,
      };
    }

    const sourceSnapshot = structuredClone(engine.snapshot());
    const sourcePieces = engine.stats.pieces;
    const garbageBefore = garbageStateFromEngine(engine);
    const replayer = new FrameActionReplayer(engine, sourceSnapshot);
    const actions = availableActions(engine);
    const candidates = new Map<string, LiveMoveCandidate>();
    const pending: ReachNode[] = [{ actions: [], softDrops: 0 }];
    const visited = new Set<string>([snapshotKey(sourceSnapshot)]);
    let expanded = 0;
    let transitions = 0;
    let stopReason: FrameReachabilityResult['stopReason'] = 'complete';

    while (pending.length > 0) {
      if (performance.now() >= settings.deadline) {
        stopReason = 'deadline';
        break;
      }
      if (expanded >= settings.maxNodes) {
        stopReason = 'node-limit';
        break;
      }

      const node = pending.shift();
      if (!node) {
        break;
      }
      expanded += 1;

      if (transitions >= settings.maxTransitions) {
        stopReason = 'transition-limit';
        break;
      }
      const terminalActions: InputAction[] = [...node.actions, 'hardDrop'];
      const terminal = replayPlan(replayer, terminalActions);
      transitions += 1;
      if (terminal.locks.length === 1) {
        const capture = terminal.locks[0];
        if (capture && !capture.lock.topout && terminal.engine.stats.pieces === sourcePieces + 1) {
          const candidate = candidateFromReplay(terminal, terminalActions, capture, garbageBefore);
          const signature = candidateSignature(candidate);
          const existing = candidates.get(signature);
          if (!existing || candidateValue(candidate) > candidateValue(existing)) {
            candidates.set(signature, candidate);
          }
        }
      }

      if (candidates.size >= settings.maxCandidates) {
        stopReason = 'candidate-limit';
        break;
      }
      if (node.actions.length >= settings.maxDepth) {
        continue;
      }

      for (const action of actions) {
        if (performance.now() >= settings.deadline) {
          stopReason = 'deadline';
          break;
        }
        if (transitions >= settings.maxTransitions) {
          stopReason = 'transition-limit';
          break;
        }
        if (action === 'softDrop' && node.softDrops >= settings.maxSoftDrops) {
          continue;
        }

        const nextActions: InputAction[] = [...node.actions, action];
        const replay = replayPlan(replayer, nextActions);
        transitions += 1;
        if (replay.locks.length > 0 || replay.engine.stats.pieces !== sourcePieces) {
          continue;
        }

        const key = snapshotKey(replay.engine.snapshot());
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);
        pending.push({
          actions: nextActions,
          softDrops: node.softDrops + Number(action === 'softDrop'),
        });
      }

      if (stopReason !== 'complete') {
        break;
      }
    }

    return {
      candidates: [...candidates.values()],
      complete: stopReason === 'complete' && pending.length === 0,
      expanded,
      stopReason,
      transitions,
    };
  }
}

function availableActions(engine: Engine): readonly InputAction[] {
  const actions: InputAction[] = ['moveLeft', 'moveRight', 'rotateCW', 'rotateCCW'];
  // A soft-drop key spans a subframe. In finite-movement rooms it can trigger a
  // gravity lock before the terminal hard drop, so leave those timed paths to a
  // future scheduler-aware search instead of certifying them here.
  if (engine.misc.movement.infinite) {
    actions.push('softDrop');
  }
  if (engine.misc.allowed.spin180) {
    actions.push('rotate180');
  }
  if (engine.misc.allowed.hold && !engine.holdLocked) {
    actions.push('hold');
  }
  return actions;
}

function replayPlan(replayer: FrameActionReplayer, actions: readonly InputAction[]): ReplayResult {
  return replayer.replay(actions);
}

function candidateFromReplay(
  replay: ReplayResult,
  actions: readonly InputAction[],
  capture: LockCapture,
  garbageBefore: LiveGarbageState,
): LiveMoveCandidate {
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
    spin: capture.lock.spin,
  };

  return {
    actions,
    frames: replay.frames,
    facts: {
      cancelled: Math.max(0, rawAttack - attack),
      garbageAfter: garbageStateFromEngine(replay.engine),
      garbageBefore,
      garbageAdded,
      rawAttack,
    },
    outcome,
  };
}

function candidateSignature(candidate: LiveMoveCandidate): string {
  const { outcome } = candidate;
  return [
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
}

function candidateValue(candidate: LiveMoveCandidate): number {
  const { outcome } = candidate;
  return (
    outcome.attack * 20 +
    outcome.lines * 2 +
    (outcome.spin === 'normal' ? 3 : 0) -
    candidate.actions.length * 0.01 +
    candidate.facts.cancelled * 5 -
    candidate.facts.garbageAdded * 8
  );
}

function snapshotKey(snapshot: EngineSnapshot): string {
  return JSON.stringify(snapshot);
}

function toPiece(value: string): Piece {
  if (!isPiece(value)) {
    throw new Error(`The room returned an unsupported piece type "${value}".`);
  }
  return value;
}
