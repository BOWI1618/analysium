import { buildApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { startDueDateScanner } from './jobs/dueDateScanner';
import { startCarryOver } from './jobs/carryOver';
import { startNotificationMailer } from './jobs/notificationMailer';

async function main(): Promise<void> {
  const app = await buildApp();

  const stopScanner = startDueDateScanner();
  const stopCarryOver = startCarryOver();
  const stopMailer = startNotificationMailer();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopScanner();
    stopCarryOver();
    stopMailer();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    app.log.error(error, 'failed to start');
    process.exit(1);
  }
}

void main();
