import type { Engine } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';

import { BeamSearch } from '../ai/search.js';
import type { LiveMoveCandidate, PlannerSettings } from '../ai/types.js';
import { FrameReachability, type FrameReachabilityResult } from './frame-reachability.js';
import { LiveMoveEnumerator } from './live-enumerator.js';
import { searchStateFromEngine } from './state.js';
import { avoidTankingCandidates, tacticalAdjustment } from './tactics.js';

export interface ControllerSettings extends PlannerSettings {
  pps: number;
  timeBudgetMs: number;
  debug: boolean;
}

interface CandidateEnumerator {
  enumerate(engine: Engine, deadline: number): readonly LiveMoveCandidate[];
}

interface CandidateReachability {
  enumerate(
    engine: Engine,
    settings: Parameters<FrameReachability['enumerate']>[1],
  ): FrameReachabilityResult;
}

export interface ControllerDependencies {
  enumerator?: CandidateEnumerator;
  reachability?: CandidateReachability;
  search?: BeamSearch;
}

const MINIMUM_FAST_CANDIDATES = 6;
const MAXIMUM_ROOT_CANDIDATES = 12;
const MINIMUM_REACHABILITY_BUDGET_MS = 2;
const MAXIMUM_IMMEDIATE_CANDIDATES = 16;
const RETURN_GUARD_MS = 1.25;

/**
 * Converts a strategic placement into legal Triangle key frames. It only plans
 * from server-synchronized engine state and never sends arbitrary Ribbon data.
 */
export class TetrioController {
  private readonly enumerator: CandidateEnumerator;
  private readonly reachability: CandidateReachability;
  private readonly search: BeamSearch;
  private nextDecisionFrame = 0;
  private plannedForPiece = -1;

  constructor(
    private readonly settings: ControllerSettings,
    dependencies: ControllerDependencies = {},
  ) {
    this.enumerator = dependencies.enumerator ?? new LiveMoveEnumerator();
    this.reachability = dependencies.reachability ?? new FrameReachability();
    this.search = dependencies.search ?? new BeamSearch();
  }

  start(engine: Engine): void {
    if (!engine.misc.allowed.hardDrop) {
      throw new Error('TetrioController requires rooms with hard drop enabled.');
    }
    this.nextDecisionFrame = engine.frame;
    this.plannedForPiece = -1;
  }

  tick({ engine }: Game.Tick.In): Game.Tick.Out {
    if (!engine.misc.allowed.hardDrop) {
      return {};
    }
    if (engine.falling.safeLock !== 0) {
      return {};
    }
    if (engine.stats.pieces === this.plannedForPiece || engine.frame < this.nextDecisionFrame) {
      return {};
    }

    const startedAt = performance.now();
    const deadline = startedAt + Math.max(0, this.settings.timeBudgetMs - RETURN_GUARD_MS);
    const enumerationDeadline = Math.min(deadline, startedAt + this.settings.timeBudgetMs * 0.55);
    const before = searchStateFromEngine(engine);
    const candidates = this.candidatePool(
      engine,
      this.enumerator.enumerate(engine, enumerationDeadline),
      deadline,
    );
    const plannerSettings = this.settingsForEngine(engine);
    const selected = this.selectCandidate(before, candidates, deadline, plannerSettings);

    if (!selected) {
      if (this.settings.debug) {
        console.warn('No replay-validated candidate was found; retrying on the next tick.');
      }
      return {};
    }

    this.plannedForPiece = engine.stats.pieces;
    this.nextDecisionFrame = Math.max(
      engine.frame + 1,
      Math.ceil(((engine.stats.pieces + 1) / this.settings.pps) * 60),
    );

    if (this.settings.debug) {
      const elapsed = Math.round((performance.now() - startedAt) * 10) / 10;
      console.debug(
        `move=${selected.actions.join(',')} lines=${selected.outcome.lines} ` +
          `attack=${selected.outcome.attack}/${selected.facts.rawAttack} ` +
          `cancel=${selected.facts.cancelled} tank=${selected.facts.garbageAdded} search=${elapsed}ms`,
      );
    }
    return { keys: [...selected.frames] };
  }

  private selectCandidate(
    before: ReturnType<typeof searchStateFromEngine>,
    candidates: readonly LiveMoveCandidate[],
    deadline: number,
    plannerSettings: PlannerSettings,
  ): LiveMoveCandidate | undefined {
    const contenders = avoidTankingCandidates(candidates);
    const immediateSettings = { ...plannerSettings, lookahead: 1 };
    const ranked: { candidate: LiveMoveCandidate; score: number }[] = [];
    for (const candidate of contenders.slice(0, MAXIMUM_IMMEDIATE_CANDIDATES)) {
      if (performance.now() >= deadline) {
        break;
      }
      ranked.push({
        candidate,
        score:
          this.search.scoreValidatedMove(before, candidate.outcome, immediateSettings, deadline) +
          tacticalAdjustment(candidate),
      });
    }
    ranked.sort((left, right) => right.score - left.score);
    const fallback = ranked[0]?.candidate ?? contenders[0];

    if (!fallback || plannerSettings.lookahead <= 1 || performance.now() >= deadline) {
      return fallback;
    }

    const refinementCount = Math.min(
      ranked.length,
      Math.max(1, Math.min(plannerSettings.beamWidth, 4)),
    );
    let best = fallback;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < refinementCount; index += 1) {
      const entry = ranked[index];
      if (!entry) {
        break;
      }

      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        break;
      }
      const remainingCandidates = refinementCount - index;
      const candidateDeadline = performance.now() + remainingMs / remainingCandidates;
      const score =
        this.search.scoreValidatedMove(
          before,
          entry.candidate.outcome,
          plannerSettings,
          candidateDeadline,
        ) + tacticalAdjustment(entry.candidate);
      if (score > bestScore) {
        best = entry.candidate;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * Fast enumeration remains the primary source. Only when it yields a sparse
   * root pool do we reserve a small part of the remaining deadline for bounded
   * frame reachability. Its incomplete graph can only add replay-certified
   * paths, never discard a fast candidate or block the emergency fallback.
   */
  private candidatePool(
    engine: Engine,
    fastCandidates: readonly LiveMoveCandidate[],
    deadline: number,
  ): readonly LiveMoveCandidate[] {
    if (fastCandidates.length >= MINIMUM_FAST_CANDIDATES) {
      return fastCandidates;
    }

    const remainingMs = deadline - performance.now();
    if (remainingMs < MINIMUM_REACHABILITY_BUDGET_MS) {
      return fastCandidates;
    }
    const reachabilityDeadline =
      performance.now() + Math.min(remainingMs * 0.35, MINIMUM_REACHABILITY_BUDGET_MS);
    try {
      const supplement = this.reachability.enumerate(engine, {
        deadline: reachabilityDeadline,
        maxCandidates: Math.max(1, MAXIMUM_ROOT_CANDIDATES - fastCandidates.length),
        maxDepth: 4,
        maxNodes: 20,
        maxSoftDrops: 1,
        maxTransitions: 32,
      });
      return mergeCandidatePools(fastCandidates, supplement.candidates);
    } catch (error) {
      if (this.settings.debug) {
        console.warn('Frame reachability supplement failed; retaining fast candidates.', error);
      }
      return fastCandidates;
    }
  }

  /**
   * Root candidates are always evaluated by Triangle. For room features the
   * lightweight continuation model does not represent exactly, retain only the
   * validated first ply instead of pretending to simulate the rule set.
   */
  private settingsForEngine(engine: Engine): PlannerSettings {
    const requiresExactRootOnly =
      engine.board.width !== 10 ||
      engine.board.height !== 20 ||
      engine.kickTableName !== 'SRS' ||
      !engine.misc.allowed.hold ||
      engine.garbageQueue.queue.length > 0 ||
      engine.garbageQueue.options.bombs ||
      engine.gameOptions.comboTable !== 'multiplier' ||
      engine.gameOptions.garbageBlocking !== 'combo blocking' ||
      engine.b2b.charging !== false;

    return requiresExactRootOnly ? { ...this.settings, lookahead: 1 } : this.settings;
  }
}

function mergeCandidatePools(
  primary: readonly LiveMoveCandidate[],
  supplement: readonly LiveMoveCandidate[],
): readonly LiveMoveCandidate[] {
  const candidates: LiveMoveCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of [...primary, ...supplement]) {
    const key = JSON.stringify(candidate.frames);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates;
}
