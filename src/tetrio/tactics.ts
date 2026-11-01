import type { LiveMoveCandidate } from '../ai/types.js';

export interface TacticalProfile {
  cancellationCap: number;
  cancellationReward: number;
  garbageAddedPenalty: number;
  urgentCancellationReward: number;
  urgentGarbageAddedPenalty: number;
  urgentPendingGarbage: number;
}

export const DEFAULT_TACTICAL_PROFILE: TacticalProfile = {
  cancellationCap: 4,
  cancellationReward: 1.25,
  garbageAddedPenalty: 2.5,
  urgentCancellationReward: 5.5,
  urgentGarbageAddedPenalty: 8,
  urgentPendingGarbage: 4,
};

/**
 * When a local engine replay proves a candidate avoids an imminent tank, do not
 * let a speculative continuation score select one that does tank instead.
 */
export function avoidTankingCandidates(
  candidates: readonly LiveMoveCandidate[],
): readonly LiveMoveCandidate[] {
  const pendingGarbage = candidates[0]?.facts.garbageBefore.pending ?? 0;
  const canAvoidTank =
    pendingGarbage > 0 && candidates.some((candidate) => candidate.facts.garbageAdded === 0);
  return canAvoidTank
    ? candidates.filter((candidate) => candidate.facts.garbageAdded === 0)
    : candidates;
}

export function tacticalAdjustment(
  candidate: LiveMoveCandidate,
  profile: TacticalProfile = DEFAULT_TACTICAL_PROFILE,
): number {
  const pendingGarbage = candidate.facts.garbageBefore.pending;
  if (pendingGarbage <= 0) {
    return 0;
  }

  const urgent = pendingGarbage >= profile.urgentPendingGarbage;
  const cancelled = Math.min(candidate.facts.cancelled, profile.cancellationCap);
  return (
    cancelled * (urgent ? profile.urgentCancellationReward : profile.cancellationReward) -
    candidate.facts.garbageAdded *
      (urgent ? profile.urgentGarbageAddedPenalty : profile.garbageAddedPenalty)
  );
}
