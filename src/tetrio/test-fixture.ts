import type { EngineInitializeParams } from '@haelp/teto/engine';

/**
 * A deterministic, zero-gravity engine profile for oracle and property tests.
 * It deliberately avoids live room configuration and network state.
 */
export function testEngineOptions(): EngineInitializeParams {
  return {
    queue: {
      seed: 12345,
      type: '7-bag',
      minLength: 31,
    },
    board: {
      width: 10,
      height: 20,
      buffer: 20,
    },
    kickTable: 'SRS',
    options: {
      spinBonuses: 'T-spins',
      comboTable: 'multiplier',
      garbageTargetBonus: 'none',
      clutch: false,
      garbageBlocking: 'combo blocking',
      stock: 0,
    },
    gravity: {
      value: 0,
      increase: 0,
      marginTime: 0,
    },
    garbage: {
      cap: {
        value: 8,
        marginTime: 0,
        increase: 0,
        absolute: 8,
        max: 8,
      },
      messiness: {
        change: 0,
        within: 0,
        nosame: false,
        timeout: 0,
        center: false,
      },
      garbage: {
        speed: 0,
        holeSize: 1,
      },
      multiplier: {
        value: 1,
        increase: 0,
        marginTime: 0,
      },
      bombs: false,
      seed: 12345,
      boardWidth: 10,
      rounding: 'down',
      openerPhase: 0,
      specialBonus: false,
    },
    pc: false,
    b2b: {
      chaining: true,
      charging: false,
    },
    misc: {
      movement: {
        infinite: true,
        lockResets: 15,
        lockTime: 30,
        may20G: true,
      },
      allowed: {
        spin180: true,
        hardDrop: true,
        hold: true,
        undo: false,
        retry: false,
      },
      infiniteHold: false,
      stride: false,
      username: 'test-bot',
      date: new Date('2026-01-01T00:00:00.000Z'),
    },
    handling: {
      arr: 0,
      das: 5,
      dcd: 0,
      sdf: 41,
      safelock: false,
      cancel: false,
      may20g: true,
      irs: 'tap',
      ihs: 'tap',
    },
    multiplayer: {
      opponents: [],
      passthrough: 'full',
    },
  };
}
