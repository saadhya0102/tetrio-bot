import { createHash } from 'node:crypto';

import { BitBoard } from '../ai/board.js';
import type { PositionEvaluator } from '../ai/evaluator.js';
import { BeamSearch } from '../ai/search.js';
import type { Piece } from '../ai/tetrominoes.js';
import type { MoveOutcome, PlannerSettings, SearchState } from '../ai/types.js';
import { createBagGenerator } from './self-play.js';

export const LOCAL_MATCH_PROTOCOL = 'offline-approx-v1';

export type MatchSide = 'left' | 'right';
export type MatchWinner = MatchSide | 'draw';

export interface MatchPolicy {
  evaluator?: PositionEvaluator;
  id: string;
  planner: PlannerSettings;
  /**
   * A finite budget exercises timeouts, but is intentionally unsuitable for
   * reproducible profile promotion. Omit it for deterministic evaluation.
   */
  decisionBudgetMs?: number;
}

export interface MatchRules {
  attackDelayTurns: number;
  maxGarbagePerTank: number;
  queueDepth: number;
}

export const DEFAULT_MATCH_RULES: MatchRules = {
  attackDelayTurns: 1,
  maxGarbagePerTank: 8,
  queueDepth: 12,
};

export interface MatchOptions {
  left: MatchPolicy;
  leftQueueSeed?: number;
  right: MatchPolicy;
  rightQueueSeed?: number;
  rules?: Partial<MatchRules>;
  seed: number;
  turns: number;
}

export interface MatchPlayerResult {
  attacksCancelled: number;
  attacksSent: number;
  garbageTanked: number;
  linesCleared: number;
  pieces: number;
  timedOut: boolean;
  toppedOut: boolean;
}

export interface MatchTurnTrace {
  attackCancelled: number;
  attackSent: number;
  deliveredGarbage: number;
  garbageTanked: number;
  outcome: Pick<MoveOutcome, 'attack' | 'lines' | 'perfectClear' | 'spin'> | undefined;
  pendingGarbage: number;
  placement: MoveOutcome['placement'] | undefined;
  stateKey: string;
  timedOut: boolean;
  toppedOut: boolean;
}

export interface MatchTraceEntry {
  left: MatchTurnTrace;
  right: MatchTurnTrace;
  turn: number;
}

export interface MatchResult {
  complete: boolean;
  left: MatchPlayerResult;
  protocol: typeof LOCAL_MATCH_PROTOCOL;
  right: MatchPlayerResult;
  rules: MatchRules;
  trace: readonly MatchTraceEntry[];
  traceDigest: string;
  turnsPlayed: number;
  winner: MatchWinner;
}

export interface PairedMatchOptions {
  baseline: MatchPolicy;
  candidate: MatchPolicy;
  rules?: Partial<MatchRules>;
  seed: number;
  turns: number;
}

export interface PairedMatchResult {
  baselineWins: number;
  candidateWins: number;
  draws: number;
  first: MatchResult;
  second: MatchResult;
  traceDigest: string;
}

interface AttackPacket {
  deliveryTurn: number;
  holes: readonly number[];
}

interface Player {
  activeGarbage: number[];
  nextPiece: () => Piece;
  policy: MatchPolicy;
  search: BeamSearch;
  state: SearchState;
  stats: MatchPlayerResult;
}

interface TurnResult {
  attackSent: number;
  trace: MatchTurnTrace;
}

/**
 * Runs a deterministic, symmetric local battle model. It deliberately models
 * only a bounded approximation: delayed attacks become cancellable pending
 * garbage, and uncleared pending garbage tanks after a no-clear placement.
 * It is suitable for relative offline ablations, not server-parity claims.
 */
export function runMatch(options: MatchOptions): MatchResult {
  validateMatchOptions(options);
  const rules = normalizeRules(options.rules);
  const leftQueueSeed = options.leftQueueSeed ?? deriveSeed(options.seed, 0x4c454654);
  const rightQueueSeed = options.rightQueueSeed ?? deriveSeed(options.seed, 0x52494748);
  const left = createPlayer(options.left, leftQueueSeed, rules.queueDepth);
  const right = createPlayer(options.right, rightQueueSeed, rules.queueDepth);
  const incoming: Record<MatchSide, AttackPacket[]> = { left: [], right: [] };
  const randomHole = createRandom(deriveSeed(options.seed, 0x47415242));
  const trace: MatchTraceEntry[] = [];

  for (let turn = 0; turn < options.turns; turn += 1) {
    const leftDelivered = deliverGarbage(left, incoming.left, turn);
    const rightDelivered = deliverGarbage(right, incoming.right, turn);
    const leftResult = takeTurn(left, leftDelivered, rules);
    const rightResult = takeTurn(right, rightDelivered, rules);

    scheduleAttack(
      incoming.right,
      leftResult.attackSent,
      turn + rules.attackDelayTurns,
      randomHole,
    );
    scheduleAttack(
      incoming.left,
      rightResult.attackSent,
      turn + rules.attackDelayTurns,
      randomHole,
    );
    trace.push({ left: leftResult.trace, right: rightResult.trace, turn });

    const winner = winnerFor(left, right);
    if (winner !== undefined) {
      return finishMatch(winner, true, turn + 1, left, right, rules, trace);
    }
  }

  return finishMatch('draw', false, options.turns, left, right, rules, trace);
}

/**
 * Runs the same queue seeds twice with candidate and baseline policy seats
 * reversed. This removes first-seat and garbage-RNG placement bias from a
 * simple screening gate.
 */
export function runPairedMatch(options: PairedMatchOptions): PairedMatchResult {
  const leftQueueSeed = deriveSeed(options.seed, 0x4c454654);
  const rightQueueSeed = deriveSeed(options.seed, 0x52494748);
  const first = runMatch({
    left: options.candidate,
    leftQueueSeed,
    right: options.baseline,
    rightQueueSeed,
    seed: options.seed,
    turns: options.turns,
    ...(options.rules ? { rules: options.rules } : {}),
  });
  const second = runMatch({
    left: options.baseline,
    leftQueueSeed,
    right: options.candidate,
    rightQueueSeed,
    seed: options.seed,
    turns: options.turns,
    ...(options.rules ? { rules: options.rules } : {}),
  });
  const firstCandidateResult = winnerForCandidate(first.winner, 'left');
  const secondCandidateResult = winnerForCandidate(second.winner, 'right');
  const results = [firstCandidateResult, secondCandidateResult];

  return {
    baselineWins: results.filter((result) => result === 'baseline').length,
    candidateWins: results.filter((result) => result === 'candidate').length,
    draws: results.filter((result) => result === 'draw').length,
    first,
    second,
    traceDigest: digest({
      first: first.traceDigest,
      protocol: LOCAL_MATCH_PROTOCOL,
      second: second.traceDigest,
    }),
  };
}

function createPlayer(policy: MatchPolicy, seed: number, queueDepth: number): Player {
  const nextPiece = createBagGenerator(seed);
  const state = withQueue(
    {
      b2b: -1,
      board: new BitBoard(),
      canHold: true,
      combo: -1,
      current: nextPiece(),
      hold: null,
      pendingGarbage: 0,
      playHeight: 20,
      queue: [],
    },
    nextPiece,
    queueDepth,
  );

  return {
    activeGarbage: [],
    nextPiece,
    policy,
    search: new BeamSearch(policy.evaluator),
    state,
    stats: {
      attacksCancelled: 0,
      attacksSent: 0,
      garbageTanked: 0,
      linesCleared: 0,
      pieces: 0,
      timedOut: false,
      toppedOut: false,
    },
  };
}

function deliverGarbage(player: Player, packets: AttackPacket[], turn: number): number {
  const due = packets.filter((packet) => packet.deliveryTurn <= turn);
  if (due.length === 0) {
    return 0;
  }

  const pending = packets.filter((packet) => packet.deliveryTurn > turn);
  packets.splice(0, packets.length, ...pending);
  const holes = due.flatMap((packet) => packet.holes);
  player.activeGarbage.push(...holes);
  player.state = {
    ...player.state,
    pendingGarbage: player.state.pendingGarbage + holes.length,
  };
  return holes.length;
}

function takeTurn(player: Player, deliveredGarbage: number, rules: MatchRules): TurnResult {
  const before = player.state;
  const startedAt = performance.now();
  const deadline =
    player.policy.decisionBudgetMs === undefined
      ? Number.POSITIVE_INFINITY
      : startedAt + player.policy.decisionBudgetMs;
  const chosen = player.search.choose(before, player.policy.planner, deadline);
  if (!chosen) {
    const timedOut = performance.now() >= deadline;
    player.stats.timedOut ||= timedOut;
    player.stats.toppedOut ||= !timedOut;
    return {
      attackSent: 0,
      trace: traceFor(player, deliveredGarbage, 0, 0, 0, undefined),
    };
  }

  const outcome = chosen.outcome;
  const attackCancelled = Math.min(before.pendingGarbage, outcome.attack);
  const attackSent = outcome.attack - attackCancelled;
  if (attackCancelled > 0) {
    player.activeGarbage.splice(0, attackCancelled);
  }
  player.stats.attacksCancelled += attackCancelled;
  player.stats.attacksSent += attackSent;
  player.stats.linesCleared += outcome.lines;
  player.stats.pieces += 1;

  let state = withQueue(outcome.state, player.nextPiece, rules.queueDepth);
  let garbageTanked = 0;
  if (outcome.lines === 0 && state.pendingGarbage > 0) {
    garbageTanked = Math.min(state.pendingGarbage, rules.maxGarbagePerTank);
    const holes = player.activeGarbage.splice(0, garbageTanked);
    const insertion = state.board.insertGarbage(holes);
    state = {
      ...state,
      board: insertion.board,
      pendingGarbage: state.pendingGarbage - garbageTanked,
    };
    player.stats.garbageTanked += garbageTanked;
    player.stats.toppedOut ||= insertion.toppedOut;
  }
  player.state = state;

  return {
    attackSent,
    trace: traceFor(player, deliveredGarbage, attackCancelled, attackSent, garbageTanked, outcome),
  };
}

function traceFor(
  player: Player,
  deliveredGarbage: number,
  attackCancelled: number,
  attackSent: number,
  garbageTanked: number,
  outcome: MoveOutcome | undefined,
): MatchTurnTrace {
  return {
    attackCancelled,
    attackSent,
    deliveredGarbage,
    garbageTanked,
    outcome: outcome
      ? {
          attack: outcome.attack,
          lines: outcome.lines,
          perfectClear: outcome.perfectClear,
          spin: outcome.spin,
        }
      : undefined,
    pendingGarbage: player.state.pendingGarbage,
    placement: outcome?.placement,
    stateKey: player.state.board.key(),
    timedOut: player.stats.timedOut,
    toppedOut: player.stats.toppedOut,
  };
}

function scheduleAttack(
  target: AttackPacket[],
  amount: number,
  deliveryTurn: number,
  randomHole: () => number,
): void {
  if (amount <= 0) {
    return;
  }
  const holes = new Array<number>(amount);
  for (let index = 0; index < amount; index += 1) {
    holes[index] = randomHole();
  }
  target.push({ deliveryTurn, holes });
}

function winnerFor(left: Player, right: Player): MatchWinner | undefined {
  const leftLost = left.stats.toppedOut || left.stats.timedOut;
  const rightLost = right.stats.toppedOut || right.stats.timedOut;
  if (!leftLost && !rightLost) {
    return undefined;
  }
  if (leftLost && rightLost) {
    return 'draw';
  }
  return leftLost ? 'right' : 'left';
}

function finishMatch(
  winner: MatchWinner,
  complete: boolean,
  turnsPlayed: number,
  left: Player,
  right: Player,
  rules: MatchRules,
  trace: readonly MatchTraceEntry[],
): MatchResult {
  return {
    complete,
    left: { ...left.stats },
    protocol: LOCAL_MATCH_PROTOCOL,
    right: { ...right.stats },
    rules,
    trace,
    traceDigest: digest({ protocol: LOCAL_MATCH_PROTOCOL, rules, trace }),
    turnsPlayed,
    winner,
  };
}

function winnerForCandidate(
  winner: MatchWinner,
  candidateSide: MatchSide,
): 'baseline' | 'candidate' | 'draw' {
  if (winner === 'draw') {
    return 'draw';
  }
  return winner === candidateSide ? 'candidate' : 'baseline';
}

function withQueue(state: SearchState, nextPiece: () => Piece, minimumQueue: number): SearchState {
  const queue = [...state.queue];
  while (queue.length < minimumQueue) {
    queue.push(nextPiece());
  }
  return { ...state, queue };
}

function normalizeRules(rules: Partial<MatchRules> | undefined): MatchRules {
  const normalized = { ...DEFAULT_MATCH_RULES, ...rules };
  if (!Number.isInteger(normalized.attackDelayTurns) || normalized.attackDelayTurns < 1) {
    throw new RangeError('attackDelayTurns must be an integer of at least one.');
  }
  if (
    !Number.isInteger(normalized.maxGarbagePerTank) ||
    normalized.maxGarbagePerTank < 1 ||
    normalized.maxGarbagePerTank > 40
  ) {
    throw new RangeError('maxGarbagePerTank must be an integer from one through 40.');
  }
  if (
    !Number.isInteger(normalized.queueDepth) ||
    normalized.queueDepth < 1 ||
    normalized.queueDepth > 64
  ) {
    throw new RangeError('queueDepth must be an integer from one through 64.');
  }
  return normalized;
}

function validateMatchOptions(options: MatchOptions): void {
  if (!Number.isInteger(options.turns) || options.turns < 1 || options.turns > 10_000) {
    throw new RangeError('turns must be an integer from one through 10000.');
  }
  if (!options.left.id || !options.right.id) {
    throw new Error('Each match policy needs a non-empty id.');
  }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state >>> 0) % 10;
  };
}

function deriveSeed(seed: number, salt: number): number {
  let mixed = (seed ^ salt) >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
