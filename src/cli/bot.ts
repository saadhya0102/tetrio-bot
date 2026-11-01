import { Client } from '@haelp/teto';

import { loadBotConfig } from '../config.js';
import { openApprovedBotClient } from '../tetrio/connection.js';
import { TetrioController } from '../tetrio/controller.js';

async function main(): Promise<void> {
  const config = loadBotConfig();
  const client = await openApprovedBotClient({
    token: config.token,
    userAgent: config.userAgent,
    connect: () =>
      Client.create({
        token: config.token,
        userAgent: config.userAgent,
        game: {
          handling: {
            arr: 0,
            cancel: false,
            das: 5,
            dcd: 0,
            safelock: false,
            may20g: true,
            sdf: 41,
            irs: 'tap',
            ihs: 'tap',
          },
        },
      }),
  });

  try {
    const controller = new TetrioController({
      pps: config.pps,
      lookahead: config.lookahead,
      beamWidth: config.beamWidth,
      timeBudgetMs: config.timeBudgetMs,
      debug: config.debug,
    });

    client.on('client.game.round.start', ([setTick, engine]) => {
      if (!engine.misc.allowed.hardDrop) {
        console.error('This room disables hard drop, which this bot does not support.');
        setTick(() => ({}));
        const leaveRoom = client.room?.leave();
        if (leaveRoom) {
          void leaveRoom.catch((error: unknown) => {
            console.error(`Could not leave unsupported room: ${stringifyError(error)}`);
          });
        }
        return;
      }
      controller.start(engine);
      if (client.game?.self?.canTarget) {
        client.game.self.target = { strategy: 'even' };
      }
      setTick(controller.tick.bind(controller));
    });

    client.on('client.game.round.end', (winnerId) => {
      console.log(winnerId ? `Round ended. Winner: ${winnerId}` : 'Round ended in a draw.');
    });

    client.on('client.error', (message) => {
      console.error(`TETR.IO error: ${message}`);
    });

    const room = config.roomId
      ? await client.rooms.join(config.roomId)
      : await client.rooms.create('private');
    if (room.public) {
      throw new Error(
        `Refusing to play in public room ${room.id}. This bot is restricted to approved private rooms.`,
      );
    }
    if (!room.allowBots) {
      throw new Error(`Room ${room.id} does not allow bot accounts.`);
    }
    if (room.options.allow_harddrop === false) {
      throw new Error(`Room ${room.id} disables hard drop, which this bot does not support.`);
    }

    console.log(`Bot connected as ${client.user.username}.`);
    console.log(`Room: ${room.id}`);
    console.log(`Join link: https://tetr.io/#r:${room.id}`);
    console.log('The bot is ready. Start a round from the room lobby. Press Ctrl+C to stop.');

    await waitForShutdown(client);
  } finally {
    await client.destroy();
  }
}

async function waitForShutdown(client: Client): Promise<void> {
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    client.once('client.dead', () => resolve());
  });
}

void main().catch((error: unknown) => {
  console.error(`Bot startup failed: ${stringifyError(error)}`);
  process.exitCode = 1;
});

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
