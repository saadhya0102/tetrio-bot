import type { Engine } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';

import { BeamSearch } from '../ai/search.js';
import type { PositionEvaluator } from '../ai/evaluator.js';
import type { PlannerSettings } from '../ai/types.js';
import { LiveMoveEnumerator } from '../tetrio/live-enumerator.js';
import { searchStateFromEngine } from '../tetrio/state.js';
import { avoidTankingCandidates, tacticalAdjustment } from '../tetrio/tactics.js';

export interface EngineMatchPolicy {
  id: string;
  revision: string;
  choose(engine: Engine): readonly Game.Tick.Keypress[] | undefined;
}

export interface BeamEngineMatchPolicyOptions {
  evaluator?: PositionEvaluator;
  id: string;
  planner: PlannerSettings;
  revision?: string;
}

/**
 * Deterministic offline policy adapter. It uses replay-validated root moves,
 * fixed logical work, and an infinite planning deadline so match results never
 * depend on host wall-clock speed.
 */
export function createBeamEngineMatchPolicy(
  options: BeamEngineMatchPolicyOptions,
): EngineMatchPolicy {
  const enumerator = new LiveMoveEnumerator();
  const search = new BeamSearch(options.evaluator);
  return {
    choose(engine) {
      const before = searchStateFromEngine(engine);
      const candidates = avoidTankingCandidates(
        enumerator.enumerate(engine, Number.POSITIVE_INFINITY),
      );
      const planner =
        engine.garbageQueue.queue.length > 0
          ? { ...options.planner, lookahead: 1 }
          : options.planner;
      const selected = [...candidates]
        .map((candidate) => ({
          candidate,
          score:
            search.scoreValidatedMove(
              before,
              candidate.outcome,
              planner,
              Number.POSITIVE_INFINITY,
            ) + tacticalAdjustment(candidate),
        }))
        .sort((left, right) => {
          const scoreDelta = right.score - left.score;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }
          const leftKey = candidateKey(left.candidate);
          const rightKey = candidateKey(right.candidate);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        })[0]?.candidate;
      return selected?.frames;
    },
    id: options.id,
    revision: options.revision ?? 'beam-replay-v1',
  };
}

function candidateKey(candidate: { frames: readonly Game.Tick.Keypress[] }): string {
  return JSON.stringify(candidate.frames);
}
