import type { Engine, EngineSnapshot, LockRes } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { BotWrapper } from '@haelp/teto/utils';

interface OrderedFrame {
  input: Game.Tick.Keypress;
  order: number;
}

export interface FrameLockCapture {
  lock: LockRes;
  mino: LockRes['mino'];
  rotation: number;
  usedHold: boolean;
  x: number;
}

export interface BotActionReplay {
  engine: Engine;
  frames: readonly Game.Tick.Keypress[];
  locks: readonly FrameLockCapture[];
}

/**
 * Reuses one detached engine to replay many plans from the same root. This
 * avoids repeated engine construction in latency-sensitive candidate validation
 * while preserving snapshot isolation for every replay.
 */
export class FrameActionReplayer {
  private readonly sandbox: Engine;
  private readonly snapshot: EngineSnapshot;
  private readonly locks: FrameLockCapture[] = [];
  private beforeLock: Omit<FrameLockCapture, 'lock'> | undefined;
  private usedHold = false;

  constructor(
    private readonly source: Engine,
    snapshot: EngineSnapshot,
  ) {
    this.snapshot = structuredClone(snapshot);
    this.sandbox = source.clone();
    this.sandbox.events.on('falling.new', ({ isHold }) => {
      this.usedHold ||= isHold;
    });
    this.sandbox.events.on('falling.lock.pre', () => {
      this.beforeLock = {
        mino: this.sandbox.falling.symbol,
        rotation: this.sandbox.falling.rotation,
        usedHold: this.usedHold,
        x: this.sandbox.falling.x,
      };
    });
    this.sandbox.events.on('falling.lock', (lock) => {
      if (this.beforeLock) {
        this.locks.push({
          ...this.beforeLock,
          lock: structuredClone(lock),
        });
      }
      this.beforeLock = undefined;
    });
  }

  replay(actions: readonly Game.Key[]): BotActionReplay {
    this.sandbox.fromSnapshot(structuredClone(this.snapshot));
    this.beforeLock = undefined;
    this.locks.length = 0;
    this.usedHold = false;

    const frames = normalizeKeyFrames(BotWrapper.frames(this.source, [...actions]));
    replayKeyFrames(this.sandbox, frames);
    return {
      engine: this.sandbox,
      frames,
      locks: [...this.locks],
    };
  }
}

/**
 * BotWrapper rounds to tenths and can produce subframe 1 at an outer-frame
 * boundary. Carry that event into the following frame so controller output
 * remains within the documented [0, 1) subframe range.
 */
export function normalizeKeyFrames(frames: readonly Game.Tick.Keypress[]): Game.Tick.Keypress[] {
  return frames.map((input) => {
    const absoluteFrame = input.frame + input.data.subframe;
    const frame = Math.floor(absoluteFrame);
    const subframe = Math.round((absoluteFrame - frame) * 10) / 10;
    return {
      ...input,
      frame,
      data: {
        ...input.data,
        subframe,
      },
    };
  });
}

/**
 * Replays controller key frames against a detached engine, preserving the
 * outer-frame schedule and in-frame ordering used by Triangle's live wrapper.
 */
export function replayKeyFrames(engine: Engine, frames: readonly Game.Tick.Keypress[]): void {
  if (frames.length === 0) {
    return;
  }

  const startFrame = engine.frame;
  const byFrame = new Map<number, OrderedFrame[]>();
  let finalFrame = startFrame;

  for (const [order, input] of frames.entries()) {
    validateInputFrame(input, startFrame);
    const scheduled = byFrame.get(input.frame);
    const entry = { input, order };
    if (scheduled) {
      scheduled.push(entry);
    } else {
      byFrame.set(input.frame, [entry]);
    }
    finalFrame = Math.max(finalFrame, input.frame);
  }

  for (let frame = startFrame; frame <= finalFrame; frame += 1) {
    const scheduled = byFrame.get(frame) ?? [];
    scheduled.sort(
      (left, right) =>
        left.input.data.subframe - right.input.data.subframe || left.order - right.order,
    );
    engine.tick(scheduled.map(({ input }) => input) as unknown as Game.Replay.Frame[]);
  }
}

/**
 * Creates a detached engine from an immutable snapshot and replays scheduled
 * controller inputs. The source engine is never mutated.
 */
export function replayKeyFramesFromSnapshot(
  source: Engine,
  snapshot: EngineSnapshot,
  frames: readonly Game.Tick.Keypress[],
): Engine {
  const sandbox = source.clone();
  sandbox.fromSnapshot(structuredClone(snapshot));
  replayKeyFrames(sandbox, frames);
  return sandbox;
}

/**
 * Compiles bot actions from the source engine's current frame/subframe and
 * replays them from an isolated snapshot. Lock captures describe the actual
 * input-driven placement, rather than a direct Engine API approximation.
 */
export function replayBotActionsFromSnapshot(
  source: Engine,
  snapshot: EngineSnapshot,
  actions: readonly Game.Key[],
): BotActionReplay {
  return new FrameActionReplayer(source, snapshot).replay(actions);
}

function validateInputFrame(input: Game.Tick.Keypress, startFrame: number): void {
  if (!Number.isInteger(input.frame) || input.frame < startFrame) {
    throw new RangeError(
      `Input frame ${input.frame} must be an integer at or after ${startFrame}.`,
    );
  }
  if (
    !Number.isFinite(input.data.subframe) ||
    input.data.subframe < 0 ||
    input.data.subframe >= 1
  ) {
    throw new RangeError(`Input subframe ${input.data.subframe} must be in [0, 1).`);
  }
}
