import { Engine } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';

import { createEngineMatchOptions } from '../simulator/engine-match-profile.js';
import { TetrioController } from '../tetrio/controller.js';

const decisions = parsePositiveInteger(process.argv[2], 50);
const engine = new Engine(createEngineMatchOptions(0x4c495645, 0x47415242, 'live-benchmark'));
const controller = new TetrioController({
  beamWidth: 12,
  debug: false,
  lookahead: 3,
  pps: 60,
  timeBudgetMs: 12,
});
controller.start(engine);

const timings: number[] = [];
let frames = 0;
while (timings.length < decisions && frames < decisions * 10) {
  const startedAt = performance.now();
  const output = controller.tick({ engine } as Game.Tick.In);
  const elapsed = performance.now() - startedAt;
  if (output.keys && output.keys.length > 0) {
    timings.push(elapsed);
  }
  engine.tick((output.keys ?? []) as unknown as Game.Replay.Frame[]);
  frames += 1;
  if (engine.toppedOut) {
    break;
  }
}

timings.sort((left, right) => left - right);
console.log(`Replay-validated decisions: ${timings.length}/${decisions}`);
console.log(`Average: ${average(timings).toFixed(2)}ms`);
console.log(`p50: ${percentile(timings, 0.5).toFixed(2)}ms`);
console.log(`p95: ${percentile(timings, 0.95).toFixed(2)}ms`);
console.log(`p99: ${percentile(timings, 0.99).toFixed(2)}ms`);
console.log(`Over 12ms: ${timings.filter((duration) => duration > 12).length}`);
console.log(`Stopped by top out: ${String(engine.toppedOut)}`);

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
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

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}
