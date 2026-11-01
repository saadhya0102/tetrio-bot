import type { BitBoard } from './board.js';
import type { Piece } from './tetrominoes.js';
import type { Game } from '@haelp/teto/types';

export type InputAction =
  | 'moveLeft'
  | 'moveRight'
  | 'rotateCW'
  | 'rotateCCW'
  | 'rotate180'
  | 'softDrop'
  | 'hardDrop'
  | 'hold';

export interface SearchState {
  board: BitBoard;
  /**
   * Highest playable row, exclusive. Rows above this are the TETR.IO spawn
   * buffer and must not be treated as free planning space.
   */
  playHeight: number;
  current: Piece;
  queue: readonly Piece[];
  hold: Piece | null;
  canHold: boolean;
  combo: number;
  b2b: number;
  pendingGarbage: number;
  /**
   * Known hole columns for offline battle search. Live TETR.IO queues do not
   * expose this, so the field is omitted there and continuations stay scalar.
   */
  knownGarbageHoles?: readonly number[];
  garbageTankCap?: number;
}

export interface Placement {
  piece: Piece;
  rotation: number;
  x: number;
  useHold: boolean;
}

export interface MoveOutcome {
  placement: Placement;
  state: SearchState;
  lines: number;
  attack: number;
  perfectClear: boolean;
  spin: 'none' | 'mini' | 'normal';
}

export interface RankedMove {
  outcome: MoveOutcome;
  score: number;
  principalVariation: readonly Placement[];
}

/**
 * Exact first-ply facts captured from the local engine replay. They are kept
 * separate from MoveOutcome because the lightweight continuation simulator does
 * not yet model garbage delivery and cancellation faithfully.
 */
export interface LiveGarbageState {
  active: number;
  confirmed: number;
  earliestTankFrame: number | null;
  pending: number;
}

export interface LiveMoveFacts {
  cancelled: number;
  garbageAfter: LiveGarbageState;
  garbageBefore: LiveGarbageState;
  garbageAdded: number;
  rawAttack: number;
}

export interface LiveMoveCandidate {
  actions: readonly InputAction[];
  /**
   * Canonical key frames compiled from the synchronized root engine state.
   * Future frame-aware reachability can provide plans that cannot be expressed
   * as a simple action list while preserving the same controller contract.
   */
  frames: readonly Game.Tick.Keypress[];
  facts: LiveMoveFacts;
  outcome: MoveOutcome;
}

export interface PlannerSettings {
  beamWidth: number;
  lookahead: number;
}
