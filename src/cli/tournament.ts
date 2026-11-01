import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { HeuristicEvaluator } from '../ai/evaluator.js';
import { parseEvaluationProfile } from '../ai/profile.js';
import { runPairedMatch, type MatchPolicy } from '../simulator/match.js';

const profilePath = process.argv[2];
if (!profilePath) {
  throw new Error('Usage: npm run tournament -- <candidate-profile.json> [seeds] [turns]');
}

const seedCount = parsePositiveInteger(process.argv[3], 8, 'seeds');
const turns = parsePositiveInteger(process.argv[4], 120, 'turns');
const candidateProfile = parseEvaluationProfile(JSON.parse(readFileSync(profilePath, 'utf8')));
const baseline: MatchPolicy = {
  evaluator: new HeuristicEvaluator(),
  id: 'baseline',
  planner: {
    beamWidth: 6,
    lookahead: 2,
  },
};
const candidate: MatchPolicy = {
  evaluator: new HeuristicEvaluator(candidateProfile),
  id: 'candidate',
  planner: baseline.planner,
};

let baselineWins = 0;
let candidateWins = 0;
let draws = 0;
const digests: string[] = [];
for (let index = 0; index < seedCount; index += 1) {
  const result = runPairedMatch({
    baseline,
    candidate,
    seed: 0x544f5552 + index,
    turns,
  });
  baselineWins += result.baselineWins;
  candidateWins += result.candidateWins;
  draws += result.draws;
  digests.push(result.traceDigest);
}

const total = baselineWins + candidateWins + draws;
console.log(`Paired games: ${total} across ${seedCount} seeds.`);
console.log(`Candidate/baseline/draw: ${candidateWins}/${baselineWins}/${draws}`);
console.log(`Candidate score: ${(candidateWins + draws * 0.5) / Math.max(total, 1)}`);
console.log(`Tournament digest: ${createHash('sha256').update(digests.join('|')).digest('hex')}`);
console.log(
  'This is an approximate local screening gate. Validate any winning profile in approved rooms before deployment.',
);

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) {
    throw new Error(`${name} must be a positive integer no greater than 10000.`);
  }
  return parsed;
}
