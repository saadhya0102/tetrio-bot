import { runSelfPlay } from '../simulator/self-play.js';

const result = runSelfPlay({
  seed: 0xb07b07,
  pieces: 180,
  planner: {
    beamWidth: 12,
    lookahead: 3,
  },
  decisionBudgetMs: 12,
});

const timings = result.steps.map((step) => step.elapsedMs).sort((left, right) => left - right);
const average =
  timings.reduce((total, duration) => total + duration, 0) / Math.max(timings.length, 1);

console.log(`Decisions: ${timings.length}`);
console.log(`Average: ${average.toFixed(2)}ms`);
console.log(`p50: ${percentile(timings, 0.5).toFixed(2)}ms`);
console.log(`p95: ${percentile(timings, 0.95).toFixed(2)}ms`);
console.log(`Estimated attack: ${result.totalAttack}`);
console.log(`Completed: ${String(!result.toppedOut && !result.timedOut)}`);

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}
