import { runSelfPlay } from '../simulator/self-play.js';

const pieces = parsePositiveInteger(process.argv[2], 250);
const result = runSelfPlay({
  seed: 0x51a7e,
  pieces,
  planner: {
    beamWidth: 12,
    lookahead: 3,
  },
  decisionBudgetMs: 12,
});

const elapsed = result.steps.reduce((total, step) => total + step.elapsedMs, 0);
const averageDecision = result.steps.length > 0 ? elapsed / result.steps.length : 0;
const last = result.steps.at(-1);

console.log(`Simulated ${result.steps.length}/${pieces} pieces.`);
console.log(`Result: ${result.timedOut ? 'planning timeout' : result.toppedOut ? 'top out' : 'completed'}`);
console.log(`Estimated attack: ${result.totalAttack}`);
console.log(`Average decision time: ${averageDecision.toFixed(2)}ms`);
if (last) {
  console.log(
    `Final field: height ${last.outcome.state.board.features().maxHeight}, ` +
      `holes ${last.outcome.state.board.features().holes}`,
  );
}

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
