import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { runSelfPlay } from '../simulator/self-play.js';

const requestedSamples = parsePositiveInteger(process.argv[2], 2_000);
const lines: string[] = [];
let seed = 0xdecafbad;

while (lines.length < requestedSamples) {
  const result = runSelfPlay({
    seed,
    pieces: Math.min(250, requestedSamples - lines.length),
    planner: {
      beamWidth: 12,
      lookahead: 3,
    },
    decisionBudgetMs: 12,
  });

  for (const step of result.steps) {
    const { before, outcome, score } = step;
    lines.push(
      JSON.stringify({
        board: Array.from(before.board.rows),
        width: before.board.width,
        current: before.current,
        queue: before.queue.slice(0, 8),
        hold: before.hold,
        combo: before.combo,
        b2b: before.b2b,
        pendingGarbage: before.pendingGarbage,
        label: {
          placement: outcome.placement,
          lines: outcome.lines,
          attack: outcome.attack,
          spin: outcome.spin,
          value: score,
        },
      }),
    );
    if (lines.length >= requestedSamples) {
      break;
    }
  }

  seed = (seed + 0x9e3779b9) >>> 0;
  if (result.steps.length === 0) {
    throw new Error('The self-play generator produced no decisions.');
  }
}

const outputPath = resolve(
  process.cwd(),
  'data',
  'training',
  `heuristic-${requestedSamples}-samples.jsonl`,
);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${lines.length} labeled positions to ${outputPath}`);

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
