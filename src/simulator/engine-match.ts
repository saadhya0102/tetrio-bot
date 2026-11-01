import { createHash } from 'node:crypto';

import { Engine } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';

import { searchStateFromEngine } from '../tetrio/state.js';
import {
  createEngineMatchOptions,
  DEFAULT_ENGINE_MATCH_PROFILE,
  ENGINE_MATCH_PROTOCOL,
  PINNED_TETO_VERSION,
  type EngineMatchProfile,
} from './engine-match-profile.js';
import type { EngineMatchPolicy } from './engine-match-policy.js';

export type EngineMatchSide = 'left' | 'right';
export type EngineMatchWinner = EngineMatchSide | 'draw';

export interface EngineMatchOptions {
  left: EngineMatchPolicy;
  maxFrames: number;
  profile?: EngineMatchProfile;
  right: EngineMatchPolicy;
  seed: number;
}

export interface EngineMatchSeatResult {
  attacksDelivered: number;
  attacksSent: number;
  cancelledAttack: number;
  frames: number;
  invalidReason?: string;
  locks: number;
  pieces: number;
  peakHeight: number;
  peakHoles: number;
  peakPendingGarbage: number;
  rawAttack: number;
  tankedGarbage: number;
  toppedOut: boolean;
}

export interface EngineMatchResult {
  complete: boolean;
  eventCount: number;
  left: EngineMatchSeatResult;
  protocol: typeof ENGINE_MATCH_PROTOCOL;
  right: EngineMatchSeatResult;
  terminalReason: 'frame-limit' | 'invalid-policy' | 'topout';
  traceDigest: string;
  valid: boolean;
  winner: EngineMatchWinner;
}

export interface PairedEngineMatchOptions {
  baseline: EngineMatchPolicy;
  candidate: EngineMatchPolicy;
  maxFrames: number;
  profile?: EngineMatchProfile;
  seed: number;
}

export interface PairedEngineMatchResult {
  baselineWins: number;
  candidateWins: number;
  draws: number;
  first: EngineMatchResult;
  protocol: typeof ENGINE_MATCH_PROTOCOL;
  second: EngineMatchResult;
  traceDigest: string;
  valid: boolean;
}

interface AttackPacket {
  amount: number;
  createdFrame: number;
  deliverFrame: number;
  id: number;
  source: EngineMatchSide;
  target: EngineMatchSide;
}

interface SeatRuntime {
  engine: Engine;
  planFinalFrame: number;
  plannedFrames: readonly Game.Tick.Keypress[];
  plannedForPiece: number;
  policy: EngineMatchPolicy;
  result: EngineMatchSeatResult;
}

interface TraceChain {
  digest: string;
  events: number;
  push(event: unknown): void;
}

/**
 * Deterministic Engine-per-seat battle coordinator. Each seat uses Triangle
 * for board, hold, rotation, cancellation, and tanking; only packet delivery
 * between seats is an explicit local approximation. It is intentionally
 * separate from the fast BitBoard screening harness.
 */
export function runEngineMatch(options: EngineMatchOptions): EngineMatchResult {
  validateOptions(options);
  const profile = options.profile ?? DEFAULT_ENGINE_MATCH_PROFILE;
  if (!Number.isInteger(profile.networkDelayFrames) || profile.networkDelayFrames < 1) {
    throw new RangeError('networkDelayFrames must be an integer of at least one.');
  }

  const sharedQueue = deriveSeed(options.seed, 0x51554555);
  const seedBundle = {
    leftGarbage: deriveSeed(options.seed, 0x4c474152),
    leftQueue:
      profile.queueTopology === 'shared' ? sharedQueue : deriveSeed(options.seed, 0x4c454654),
    rightGarbage: deriveSeed(options.seed, 0x52474152),
    rightQueue:
      profile.queueTopology === 'shared' ? sharedQueue : deriveSeed(options.seed, 0x52494748),
  };
  const left = createSeat('left', options.left, seedBundle.leftQueue, seedBundle.leftGarbage);
  const right = createSeat('right', options.right, seedBundle.rightQueue, seedBundle.rightGarbage);
  const seats: Record<EngineMatchSide, SeatRuntime> = { left, right };
  const trace = createTraceChain({
    leftPolicy: policyIdentity(options.left),
    profile: profile.id,
    protocol: ENGINE_MATCH_PROTOCOL,
    queueTopology: profile.queueTopology,
    rightPolicy: policyIdentity(options.right),
    seed: options.seed,
    seedBundle,
    tetoVersion: PINNED_TETO_VERSION,
  });
  const packets: AttackPacket[] = [];
  let nextPacketId = 1;

  for (let frame = 0; frame < options.maxFrames; frame += 1) {
    const due = packets.filter((packet) => packet.deliverFrame === frame).sort(comparePackets);
    if (due.length > 0) {
      for (const packet of due) {
        const target = seats[packet.target];
        target.engine.receiveGarbage({
          amount: packet.amount,
          cid: packet.id,
          confirmed: true,
          frame: target.engine.frame,
          gameid: gameId(packet.source),
          size: 1,
        });
        target.result.attacksDelivered += packet.amount;
        target.result.peakPendingGarbage = Math.max(
          target.result.peakPendingGarbage,
          target.engine.garbageQueue.size,
        );
        trace.push({
          amount: packet.amount,
          frame,
          id: packet.id,
          source: packet.source,
          target: packet.target,
          type: 'delivery',
        });
      }
    }
    const pending = packets.filter((packet) => packet.deliverFrame > frame);
    packets.splice(0, packets.length, ...pending);

    const invalid = ensurePlans(frame, left, right, trace);
    if (invalid) {
      return finish('draw', false, 'invalid-policy', left, right, trace);
    }

    const leftTick = tickSeat(left);
    const rightTick = tickSeat(right);
    nextPacketId = scheduleAttacks(
      frame,
      profile.networkDelayFrames,
      leftTick.garbage.sent,
      'left',
      packets,
      left,
      trace,
      nextPacketId,
    );
    nextPacketId = scheduleAttacks(
      frame,
      profile.networkDelayFrames,
      rightTick.garbage.sent,
      'right',
      packets,
      right,
      trace,
      nextPacketId,
    );
    traceLockIfNeeded(frame, 'left', left, leftTick, trace);
    traceLockIfNeeded(frame, 'right', right, rightTick, trace);

    const winner = winnerFor(left, right);
    if (winner !== undefined) {
      return finish(winner, true, 'topout', left, right, trace);
    }
  }

  return finish('draw', false, 'frame-limit', left, right, trace);
}

/**
 * Runs physical-seat-identical engine matches with candidate and baseline
 * swapped, so each policy receives every queue and garbage stream once.
 */
export function runPairedEngineMatch(options: PairedEngineMatchOptions): PairedEngineMatchResult {
  const first = runEngineMatch({
    left: options.candidate,
    maxFrames: options.maxFrames,
    right: options.baseline,
    seed: options.seed,
    ...(options.profile ? { profile: options.profile } : {}),
  });
  const second = runEngineMatch({
    left: options.baseline,
    maxFrames: options.maxFrames,
    right: options.candidate,
    seed: options.seed,
    ...(options.profile ? { profile: options.profile } : {}),
  });
  const outcomes = [
    candidateOutcome(first.winner, 'left'),
    candidateOutcome(second.winner, 'right'),
  ];

  return {
    baselineWins: outcomes.filter((outcome) => outcome === 'baseline').length,
    candidateWins: outcomes.filter((outcome) => outcome === 'candidate').length,
    draws: outcomes.filter((outcome) => outcome === 'draw').length,
    first,
    protocol: ENGINE_MATCH_PROTOCOL,
    second,
    traceDigest: hash(
      canonicalJson({
        first: first.traceDigest,
        protocol: ENGINE_MATCH_PROTOCOL,
        second: second.traceDigest,
      }),
    ),
    valid: first.valid && second.valid,
  };
}

function createSeat(
  side: EngineMatchSide,
  policy: EngineMatchPolicy,
  queueSeed: number,
  garbageSeed: number,
): SeatRuntime {
  const engine = new Engine(createEngineMatchOptions(queueSeed, garbageSeed, `offline-${side}`));
  const result: EngineMatchSeatResult = {
    attacksDelivered: 0,
    attacksSent: 0,
    cancelledAttack: 0,
    frames: 0,
    locks: 0,
    peakHeight: 0,
    peakHoles: 0,
    peakPendingGarbage: 0,
    pieces: 0,
    rawAttack: 0,
    tankedGarbage: 0,
    toppedOut: false,
  };
  engine.events.on('falling.lock', (lock) => {
    const rawAttack = lock.rawGarbage.reduce((total, amount) => total + amount, 0);
    const emittedAttack = lock.garbage.reduce((total, amount) => total + amount, 0);
    const tankedGarbage =
      lock.garbageAdded === false
        ? 0
        : lock.garbageAdded.reduce((total, garbage) => total + garbage.amount, 0);
    const features = searchStateFromEngine(engine).board.features();
    result.cancelledAttack += rawAttack - emittedAttack;
    result.locks += 1;
    result.peakHeight = Math.max(result.peakHeight, features.maxHeight);
    result.peakHoles = Math.max(result.peakHoles, features.holes);
    result.rawAttack += rawAttack;
    result.tankedGarbage += tankedGarbage;
    result.toppedOut ||= lock.topout;
  });

  return {
    engine,
    planFinalFrame: -1,
    plannedFrames: [],
    plannedForPiece: -1,
    policy,
    result,
  };
}

function ensurePlans(
  frame: number,
  left: SeatRuntime,
  right: SeatRuntime,
  trace: TraceChain,
): boolean {
  for (const [side, seat] of [
    ['left', left],
    ['right', right],
  ] as const) {
    if (seat.engine.toppedOut) {
      continue;
    }
    if (seat.engine.stats.pieces === seat.plannedForPiece) {
      if (seat.planFinalFrame >= 0 && seat.engine.frame > seat.planFinalFrame) {
        seat.result.invalidReason = 'Policy plan ended without locking a piece.';
        return true;
      }
      continue;
    }
    const before = canonicalJson(seat.engine.snapshot());
    let frames: readonly Game.Tick.Keypress[] | undefined;
    try {
      frames = seat.policy.choose(seat.engine);
    } catch (error) {
      seat.result.invalidReason = `Policy threw: ${messageFor(error)}`;
      return true;
    }
    if (before !== canonicalJson(seat.engine.snapshot())) {
      seat.result.invalidReason = 'Policy mutated the engine.';
      return true;
    }
    if (
      !frames ||
      frames.length === 0 ||
      frames.some(
        (input) =>
          !Number.isInteger(input.frame) ||
          input.frame < seat.engine.frame ||
          !Number.isFinite(input.data.subframe) ||
          input.data.subframe < 0 ||
          input.data.subframe >= 1,
      )
    ) {
      seat.result.invalidReason = 'Policy returned no valid frame plan.';
      return true;
    }
    seat.plannedFrames = frames;
    seat.planFinalFrame = Math.max(...frames.map((input) => input.frame));
    seat.plannedForPiece = seat.engine.stats.pieces;
    trace.push({
      frame,
      frames,
      policy: policyIdentity(seat.policy),
      side,
      type: 'decision',
    });
  }
  return false;
}

function tickSeat(seat: SeatRuntime): ReturnType<Engine['tick']> {
  const frame = seat.engine.frame;
  const scheduled = plannedFramesFor(seat, frame);
  const beforePieces = seat.engine.stats.pieces;
  const result = seat.engine.tick(scheduled as unknown as Game.Replay.Frame[]);
  seat.result.frames += 1;
  seat.result.pieces = seat.engine.stats.pieces;
  seat.result.toppedOut ||= seat.engine.toppedOut;
  if (seat.engine.stats.pieces !== beforePieces) {
    seat.planFinalFrame = -1;
    seat.plannedFrames = [];
    seat.plannedForPiece = -1;
  }
  return result;
}

function plannedFramesFor(seat: SeatRuntime, frame: number): readonly Game.Tick.Keypress[] {
  return seat.plannedFrames.filter((input) => input.frame === frame);
}

function scheduleAttacks(
  frame: number,
  networkDelayFrames: number,
  amounts: readonly number[],
  source: EngineMatchSide,
  packets: AttackPacket[],
  seat: SeatRuntime,
  trace: TraceChain,
  nextPacketId: number,
): number {
  const target: EngineMatchSide = source === 'left' ? 'right' : 'left';
  for (const amount of amounts) {
    if (amount <= 0) {
      continue;
    }
    const packet: AttackPacket = {
      amount,
      createdFrame: frame,
      deliverFrame: frame + networkDelayFrames,
      id: nextPacketId,
      source,
      target,
    };
    packets.push(packet);
    seat.result.attacksSent += amount;
    trace.push({ ...packet, type: 'packet' });
    nextPacketId += 1;
  }
  return nextPacketId;
}

function traceLockIfNeeded(
  frame: number,
  side: EngineMatchSide,
  seat: SeatRuntime,
  tick: ReturnType<Engine['tick']>,
  trace: TraceChain,
): void {
  if (tick.lastLock !== frame) {
    return;
  }
  trace.push({
    frame,
    pieces: seat.engine.stats.pieces,
    side,
    snapshot: fingerprint(seat.engine),
    type: 'lock',
  });
}

function winnerFor(left: SeatRuntime, right: SeatRuntime): EngineMatchWinner | undefined {
  const leftToppedOut = left.engine.toppedOut || left.result.toppedOut;
  const rightToppedOut = right.engine.toppedOut || right.result.toppedOut;
  if (!leftToppedOut && !rightToppedOut) {
    return undefined;
  }
  if (leftToppedOut && rightToppedOut) {
    return 'draw';
  }
  return leftToppedOut ? 'right' : 'left';
}

function candidateOutcome(
  winner: EngineMatchWinner,
  candidateSide: EngineMatchSide,
): 'baseline' | 'candidate' | 'draw' {
  if (winner === 'draw') {
    return 'draw';
  }
  return winner === candidateSide ? 'candidate' : 'baseline';
}

function finish(
  winner: EngineMatchWinner,
  complete: boolean,
  terminalReason: EngineMatchResult['terminalReason'],
  left: SeatRuntime,
  right: SeatRuntime,
  trace: TraceChain,
): EngineMatchResult {
  const valid = !left.result.invalidReason && !right.result.invalidReason;
  return {
    complete,
    eventCount: trace.events,
    left: left.result,
    protocol: ENGINE_MATCH_PROTOCOL,
    right: right.result,
    terminalReason,
    traceDigest: trace.digest,
    valid,
    winner,
  };
}

function createTraceChain(header: unknown): TraceChain {
  let digest = hash(canonicalJson(header));
  let events = 0;
  return {
    get digest() {
      return digest;
    },
    get events() {
      return events;
    },
    push(event) {
      digest = hash(`${digest}\n${canonicalJson(event)}`);
      events += 1;
    },
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Trace data cannot contain a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError(`Trace data cannot contain ${typeof value}.`);
}

function comparePackets(left: AttackPacket, right: AttackPacket): number {
  const sourceOrder = left.source === right.source ? 0 : left.source === 'left' ? -1 : 1;
  return (
    left.deliverFrame - right.deliverFrame ||
    left.createdFrame - right.createdFrame ||
    sourceOrder ||
    left.id - right.id
  );
}

function deriveSeed(seed: number, salt: number): number {
  let mixed = (seed ^ salt) >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function fingerprint(engine: Engine): string {
  return hash(canonicalJson(engine.snapshot()));
}

function gameId(side: EngineMatchSide): number {
  return side === 'left' ? 1 : 2;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function policyIdentity(policy: EngineMatchPolicy): string {
  return `${policy.id}@${policy.revision}`;
}

function validateOptions(options: EngineMatchOptions): void {
  if (
    !Number.isInteger(options.maxFrames) ||
    options.maxFrames < 1 ||
    options.maxFrames > 100_000
  ) {
    throw new RangeError('maxFrames must be an integer from one through 100000.');
  }
  if (
    options.profile &&
    options.profile.queueTopology !== 'shared' &&
    options.profile.queueTopology !== 'split'
  ) {
    throw new RangeError('queueTopology must be shared or split.');
  }
}
