import { preflightApprovedBot, type ApprovedBotIdentity, type PreflightOptions } from './preflight.js';

export interface ConnectedBotClient {
  user: {
    id: string;
    role: string;
  };
  destroy(): Promise<void>;
}

export interface OpenApprovedClientOptions<TClient extends ConnectedBotClient> {
  token: string;
  userAgent: string;
  connect: () => Promise<TClient>;
  preflight?: (options: PreflightOptions) => Promise<ApprovedBotIdentity>;
}

/**
 * Keeps the authorization check structurally ahead of the network connection.
 * Tests inject `connect` to guarantee an unapproved account never opens Ribbon.
 */
export async function openApprovedBotClient<TClient extends ConnectedBotClient>(
  options: OpenApprovedClientOptions<TClient>,
): Promise<TClient> {
  const verify = options.preflight ?? preflightApprovedBot;
  const expectedIdentity = await verify({
    token: options.token,
    userAgent: options.userAgent,
  });
  const client = await options.connect();

  if (client.user.role !== 'bot' || client.user.id !== expectedIdentity.id) {
    await client.destroy();
    throw new Error('Refusing to run: the Ribbon session does not match the preflighted bot identity.');
  }
  return client;
}
