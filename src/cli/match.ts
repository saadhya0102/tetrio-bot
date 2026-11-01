import { LOCAL_MATCH_PROTOCOL, runPairedMatch, type MatchPolicy } from '../simulator/match.js';

const turns = parsePositiveInteger(process.argv[2], 200);
const baseline: MatchPolicy = {
  id: 'baseline',
  planner: {
    beamWidth: 12,
    lookahead: 3,
  },
};
const result = runPairedMatch({
  baseline,
  candidate: {
    ...baseline,
    id: 'candidate',
  },
  seed: 0x4d415443,
  turns,
});

console.log(
  `Paired local matches: ${result.first.turnsPlayed} and ${result.second.turnsPlayed} turns.`,
);
console.log(
  `Candidate/baseline/draw: ${result.candidateWins}/${result.baselineWins}/${result.draws}`,
);
console.log(`Trace digest: ${result.traceDigest}`);
console.log(
  `${LOCAL_MATCH_PROTOCOL} is an explicitly approximate local screening harness; use it for reproducible ablations, not server-parity claims.`,
);

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) {
    throw new Error('Pass a positive integer no greater than 10000.');
  }
  return parsed;
}
