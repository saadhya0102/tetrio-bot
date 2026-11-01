import { describe, expect, it, vi } from 'vitest';

import { openApprovedBotClient } from './connection.js';

describe('openApprovedBotClient', () => {
  it('never opens a gameplay client when preflight rejects the credential', async () => {
    const connect = vi.fn();
    const preflight = vi.fn().mockRejectedValue(new Error('not a bot'));

    await expect(
      openApprovedBotClient({
        token: 'normal-account-token',
        userAgent: 'test-bot',
        connect,
        preflight,
      }),
    ).rejects.toThrow('not a bot');

    expect(connect).not.toHaveBeenCalled();
  });

  it('destroys a connected client whose identity differs from preflight', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue({
      user: {
        id: 'different-id',
        role: 'bot',
      },
      destroy,
    });

    await expect(
      openApprovedBotClient({
        token: 'bot-token',
        userAgent: 'test-bot',
        connect,
        preflight: async () => ({
          id: 'expected-id',
          username: 'approved-bot',
          role: 'bot',
        }),
      }),
    ).rejects.toThrow('does not match the preflighted bot identity');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
