import { buildApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { startDueDateScanner } from './jobs/dueDateScanner';
import { startCarryOver } from './jobs/carryOver';
import { startTelegramBot } from './jobs/telegramBot';
import { startReleaseNotes } from './jobs/releaseNotes';

async function main(): Promise<void> {
  const app = await buildApp();

  const stopScanner = startDueDateScanner();
  const stopCarryOver = startCarryOver();
  const stopTelegram = startTelegramBot();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopScanner();
    stopCarryOver();
    stopTelegram();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    // After a deploy: what the update brought, to everyone's notifications.
    startReleaseNotes();
  } catch (error) {
    app.log.error(error, 'failed to start');
    process.exit(1);
  }
}

void main();
