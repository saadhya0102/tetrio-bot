import 'dotenv/config';

export interface BotConfig {
  token: string;
  roomId?: string;
  pps: number;
  lookahead: number;
  beamWidth: number;
  timeBudgetMs: number;
  debug: boolean;
  userAgent: string;
}

const DEFAULTS = {
  pps: 3.8,
  lookahead: 3,
  beamWidth: 12,
  timeBudgetMs: 12,
} as const;

const STAFF_APPROVAL_ACKNOWLEDGEMENT = 'I_HAVE_WRITTEN_TETRIO_STAFF_APPROVAL';

function parseBoundedNumber(
  rawValue: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}.`);
  }

  return parsed;
}

function parseBoolean(rawValue: string | undefined): boolean {
  return rawValue === '1' || rawValue?.toLowerCase() === 'true';
}

export function loadBotConfig(environment: NodeJS.ProcessEnv = process.env): BotConfig {
  const token = environment.TETRIO_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'TETRIO_BOT_TOKEN is required. Add a token for an officially approved TETR.IO bot account to .env.',
    );
  }
  if (environment.TETRIO_STAFF_APPROVAL !== STAFF_APPROVAL_ACKNOWLEDGEMENT) {
    throw new Error(
      `Written TETR.IO staff approval is required before live play. After receiving it, set TETRIO_STAFF_APPROVAL=${STAFF_APPROVAL_ACKNOWLEDGEMENT} in .env.`,
    );
  }

  const roomId = environment.TETRIO_ROOM_ID?.trim();
  return {
    token,
    ...(roomId ? { roomId } : {}),
    pps: parseBoundedNumber(environment.TETRIO_BOT_PPS, 'TETRIO_BOT_PPS', DEFAULTS.pps, 0.5, 10),
    lookahead: Math.floor(
      parseBoundedNumber(environment.AI_LOOKAHEAD, 'AI_LOOKAHEAD', DEFAULTS.lookahead, 1, 5),
    ),
    beamWidth: Math.floor(
      parseBoundedNumber(environment.AI_BEAM_WIDTH, 'AI_BEAM_WIDTH', DEFAULTS.beamWidth, 2, 64),
    ),
    timeBudgetMs: parseBoundedNumber(
      environment.AI_TIME_BUDGET_MS,
      'AI_TIME_BUDGET_MS',
      DEFAULTS.timeBudgetMs,
      2,
      15,
    ),
    debug: parseBoolean(environment.BOT_DEBUG),
    userAgent: 'tetrio-competitive-bot/0.1 (authorized-bot-account-only)',
  };
}
