import { readFileSync, writeFileSync } from 'node:fs';

import { parseEvaluationProfile } from '../ai/profile.js';
import { tuneEvaluationProfile } from '../training/profile-tuner.js';

const baselinePath = process.argv[2] ?? 'profiles/default.json';
const outputPath = process.argv[3] ?? 'profiles/tuned.json';
const generations = parsePositiveInteger(process.argv[4], 2, 'generations');
const populationSize = parsePositiveInteger(process.argv[5], 6, 'population size');
const turns = parsePositiveInteger(process.argv[6], 40, 'turns');
const baselineProfile = parseEvaluationProfile(JSON.parse(readFileSync(baselinePath, 'utf8')));
const result = tuneEvaluationProfile({
  baselineProfile,
  generations,
  heldOutSeeds: [0x29a6d, 0x3e9b1],
  planner: {
    beamWidth: 6,
    lookahead: 2,
  },
  populationSize,
  seed: 0x434d4145,
  trainingSeeds: [0x11d3a, 0x27f4c],
  turns,
});

writeFileSync(outputPath, `${JSON.stringify(result.bestProfile, null, 2)}\n`, 'utf8');
console.log(`Evaluations: ${result.optimization.evaluations}`);
console.log(
  `Training candidate/baseline/draw: ${result.training.candidateWins}/${result.training.baselineWins}/${result.training.draws}`,
);
console.log(
  `Held-out candidate/baseline/draw: ${result.heldOut.candidateWins}/${result.heldOut.baselineWins}/${result.heldOut.draws}`,
);
console.log(`Held-out score: ${result.heldOut.score}`);
console.log(`Local screening: ${result.passedScreening ? 'PASS' : 'NOT PASSED'}`);
console.log(`Wrote candidate profile: ${outputPath}`);
console.log(
  'This optimizer targets the approximate local harness only. Validate screened profiles in approved rooms before deployment.',
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
