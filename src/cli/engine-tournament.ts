import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { HeuristicEvaluator } from '../ai/evaluator.js';
import { parseEvaluationProfile } from '../ai/profile.js';
import { ENGINE_MATCH_PROTOCOL } from '../simulator/engine-match-profile.js';
import { runPairedEngineMatch } from '../simulator/engine-match.js';
import { createBeamEngineMatchPolicy } from '../simulator/engine-match-policy.js';

const profilePath = process.argv[2];
if (!profilePath) {
  throw new Error('Usage: npm run engine:tournament -- <candidate-profile.json> [seeds] [frames]');
}

const seedCount = parsePositiveInteger(process.argv[3], 2, 'seeds');
const maxFrames = parsePositiveInteger(process.argv[4], 60, 'frames');
const candidateProfile = parseEvaluationProfile(JSON.parse(readFileSync(profilePath, 'utf8')));
const baseline = createBeamEngineMatchPolicy({
  evaluator: new HeuristicEvaluator(),
  id: 'baseline',
  planner: {
    beamWidth: 6,
    lookahead: 2,
  },
});
const candidate = createBeamEngineMatchPolicy({
  evaluator: new HeuristicEvaluator(candidateProfile),
  id: 'candidate',
  planner: {
    beamWidth: 6,
    lookahead: 2,
  },
});

let baselineWins = 0;
let candidateWins = 0;
let draws = 0;
let invalidPairs = 0;
const digests: string[] = [];
for (let index = 0; index < seedCount; index += 1) {
  const result = runPairedEngineMatch({
    baseline,
    candidate,
    maxFrames,
    seed: 0x454e4754 + index,
  });
  baselineWins += result.baselineWins;
  candidateWins += result.candidateWins;
  draws += result.draws;
  invalidPairs += Number(!result.valid);
  digests.push(result.traceDigest);
}

const games = baselineWins + candidateWins + draws;
console.log(`Protocol: ${ENGINE_MATCH_PROTOCOL}`);
console.log(`Paired games: ${games} across ${seedCount} seeds.`);
console.log(`Candidate/baseline/draw: ${candidateWins}/${baselineWins}/${draws}`);
console.log(`Invalid pairs: ${invalidPairs}`);
console.log(`Candidate score: ${(candidateWins + draws * 0.5) / Math.max(games, 1)}`);
console.log(`Tournament digest: ${createHash('sha256').update(digests.join('|')).digest('hex')}`);
console.log(
  'Triangle models each seat locally; cross-seat packet delivery remains an explicit approximation. Validate finalists in approved rooms.',
);

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new Error(`${name} must be a positive integer no greater than 100000.`);
  }
  return parsed;
}
