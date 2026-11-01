import type { EngineInitializeParams } from '@haelp/teto/engine';

export const ENGINE_MATCH_PROTOCOL = 'triangle-engine-approx-v1';
export const PINNED_TETO_VERSION = '4.2.7';

export interface EngineMatchProfile {
  id: string;
  networkDelayFrames: number;
  queueTopology: 'shared' | 'split';
}

export const DEFAULT_ENGINE_MATCH_PROFILE: EngineMatchProfile = {
  id: 'triangle-zero-gravity-srs-v1',
  networkDelayFrames: 1,
  queueTopology: 'shared',
};

/**
 * Creates a pinned, deterministic per-seat engine profile for offline
 * differential evaluation. Cross-seat delivery is owned by engine-match.ts,
 * never Triangle's incomplete multiplayer/IGE transport.
 */
export function createEngineMatchOptions(
  queueSeed: number,
  garbageSeed: number,
  username: string,
): EngineInitializeParams {
  return {
    b2b: {
      chaining: true,
      charging: false,
    },
    board: {
      buffer: 20,
      height: 20,
      width: 10,
    },
    garbage: {
      boardWidth: 10,
      bombs: false,
      cap: {
        absolute: 8,
        increase: 0,
        marginTime: 0,
        max: 8,
        value: 8,
      },
      garbage: {
        holeSize: 1,
        speed: 0,
      },
      messiness: {
        center: false,
        change: 0,
        nosame: false,
        timeout: 0,
        within: 0,
      },
      multiplier: {
        increase: 0,
        marginTime: 0,
        value: 1,
      },
      openerPhase: 0,
      rounding: 'down',
      seed: garbageSeed,
      specialBonus: false,
    },
    gravity: {
      increase: 0,
      marginTime: 0,
      value: 0,
    },
    handling: {
      arr: 0,
      cancel: false,
      das: 5,
      dcd: 0,
      ihs: 'tap',
      irs: 'tap',
      may20g: true,
      safelock: false,
      sdf: 41,
    },
    kickTable: 'SRS',
    misc: {
      allowed: {
        hardDrop: true,
        hold: true,
        retry: false,
        spin180: true,
        undo: false,
      },
      date: new Date('2026-01-01T00:00:00.000Z'),
      infiniteHold: false,
      movement: {
        infinite: true,
        lockResets: 15,
        lockTime: 30,
        may20G: true,
      },
      stride: false,
      username,
    },
    options: {
      clutch: false,
      comboTable: 'multiplier',
      garbageBlocking: 'combo blocking',
      garbageTargetBonus: 'none',
      spinBonuses: 'T-spins',
      stock: 0,
    },
    pc: false,
    queue: {
      minLength: 31,
      seed: queueSeed,
      type: '7-bag',
    },
  };
}
