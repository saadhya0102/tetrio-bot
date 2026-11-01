import { describe, expect, it } from 'vitest';

import { loadBotConfig } from './config.js';

const STAFF_APPROVAL = 'I_HAVE_WRITTEN_TETRIO_STAFF_APPROVAL';

describe('loadBotConfig', () => {
  it('requires a bot token', () => {
    expect(() => loadBotConfig({})).toThrow('TETRIO_BOT_TOKEN is required');
  });

  it('uses conservative defaults and accepts an optional room', () => {
    const config = loadBotConfig({
      TETRIO_BOT_TOKEN: 'approved-bot-token',
      TETRIO_STAFF_APPROVAL: STAFF_APPROVAL,
      TETRIO_ROOM_ID: 'private-room',
    });

    expect(config.roomId).toBe('private-room');
    expect(config.pps).toBe(3.8);
    expect(config.lookahead).toBe(3);
    expect(config.timeBudgetMs).toBe(12);
  });

  it('rejects invalid tuning values before connecting', () => {
    expect(() =>
      loadBotConfig({
        TETRIO_BOT_TOKEN: 'approved-bot-token',
        TETRIO_STAFF_APPROVAL: STAFF_APPROVAL,
        AI_BEAM_WIDTH: '999',
      }),
    ).toThrow('AI_BEAM_WIDTH must be a number between 2 and 64');
  });

  it('caps live planning to a single frame budget', () => {
    expect(() =>
      loadBotConfig({
        TETRIO_BOT_TOKEN: 'approved-bot-token',
        TETRIO_STAFF_APPROVAL: STAFF_APPROVAL,
        AI_TIME_BUDGET_MS: '16',
      }),
    ).toThrow('AI_TIME_BUDGET_MS must be a number between 2 and 15');
  });

  it('requires an acknowledgement of written staff approval', () => {
    expect(() =>
      loadBotConfig({
        TETRIO_BOT_TOKEN: 'approved-bot-token',
      }),
    ).toThrow('Written TETR.IO staff approval is required');
  });
});
