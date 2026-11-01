import { describe, expect, it, vi } from 'vitest';

import { preflightApprovedBot } from './preflight.js';

const USER_AGENT = 'test-bot';

describe('preflightApprovedBot', () => {
  it('accepts an approved bot profile before any Ribbon connection is attempted', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          user: {
            _id: 'bot-id',
            username: 'approved-bot',
            role: 'bot',
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      preflightApprovedBot({
        token: 'bot-token',
        userAgent: USER_AGENT,
        fetchImplementation,
      }),
    ).resolves.toEqual({
      id: 'bot-id',
      username: 'approved-bot',
      role: 'bot',
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://tetr.io/api/users/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer bot-token',
        }),
      }),
    );
  });

  it('rejects a normal account before a gameplay client can be created', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          user: {
            _id: 'user-id',
            username: 'normal-user',
            role: 'user',
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      preflightApprovedBot({
        token: 'user-token',
        userAgent: USER_AGENT,
        fetchImplementation,
      }),
    ).rejects.toThrow('does not belong to an approved TETR.IO bot account');
  });
});
