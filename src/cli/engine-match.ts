import { ENGINE_MATCH_PROTOCOL } from '../simulator/engine-match-profile.js';
import { runPairedEngineMatch } from '../simulator/engine-match.js';
import { createBeamEngineMatchPolicy } from '../simulator/engine-match-policy.js';

const maxFrames = parsePositiveInteger(process.argv[2], 60);
const baseline = createBeamEngineMatchPolicy({
  id: 'baseline',
  planner: {
    beamWidth: 6,
    lookahead: 2,
  },
});
const result = runPairedEngineMatch({
  baseline,
  candidate: createBeamEngineMatchPolicy({
    id: 'candidate',
    planner: {
      beamWidth: 6,
      lookahead: 2,
    },
  }),
  maxFrames,
  seed: 0x454e474d,
});

console.log(`Protocol: ${ENGINE_MATCH_PROTOCOL}`);
console.log(`Paired frame matches: ${result.first.left.frames} and ${result.second.left.frames}.`);
console.log(
  `Candidate/baseline/draw: ${result.candidateWins}/${result.baselineWins}/${result.draws}`,
);
console.log(`Valid runs: ${String(result.valid)}`);
console.log(`Trace digest: ${result.traceDigest}`);
console.log(
  'Cross-seat packet delivery is an explicit local approximation. Validate candidates in approved rooms before making server-strength claims.',
);

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new Error('Pass a positive integer no greater than 100000.');
  }
  return parsed;
}
