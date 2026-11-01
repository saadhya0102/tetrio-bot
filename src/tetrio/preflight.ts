export interface ApprovedBotIdentity {
  id: string;
  username: string;
  role: 'bot';
}

export interface PreflightOptions {
  token: string;
  userAgent: string;
  fetchImplementation?: typeof fetch;
}

interface MeResponse {
  success?: boolean;
  user?: {
    _id?: string;
    username?: string;
    role?: string;
  };
}

/**
 * Verifies the credential through the HTTP API before opening a Ribbon socket.
 * This prevents a normal account token from establishing a main-game session.
 */
export async function preflightApprovedBot(
  options: PreflightOptions,
): Promise<ApprovedBotIdentity> {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const response = await fetchImplementation('https://tetr.io/api/users/me', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${options.token}`,
      'User-Agent': options.userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`Bot-account preflight failed with HTTP ${response.status}.`);
  }

  let payload: MeResponse;
  try {
    payload = (await response.json()) as MeResponse;
  } catch {
    throw new Error('Bot-account preflight returned an invalid response.');
  }

  const user = payload.user;
  if (payload.success !== true || !user || typeof user._id !== 'string' || typeof user.username !== 'string') {
    throw new Error('Bot-account preflight returned an unexpected user profile.');
  }
  if (user.role !== 'bot') {
    throw new Error(
      'Refusing to connect: the supplied credential does not belong to an approved TETR.IO bot account.',
    );
  }

  return {
    id: user._id,
    username: user.username,
    role: 'bot',
  };
}
