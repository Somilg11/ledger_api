import app from './app';
import { logger } from './shared/logger';
import { config } from './shared/config/app.config';
import { connectDatabase, disconnectDatabase } from './infrastructure/database/mongodb/connection';
import { getRedisClient, disconnectRedis } from './infrastructure/cache/redis.client';

async function initialize() {
  await connectDatabase();
  await getRedisClient().ping();
  logger.info('MongoDB and Redis connections ready');
}

async function main() {
  try {
    await initialize();
  } catch (err) {
    logger.fatal({ err }, 'initialization failed');
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'ledger API listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');

    // Stop accepting new requests first, then release the data connections so
    // no transaction is cut off mid-flight.
    const forced = setTimeout(() => {
      logger.error('forcing shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forced.unref();

    server.close(async () => {
      try {
        await disconnectDatabase();
        await disconnectRedis();
      } finally {
        clearTimeout(forced);
        process.exit(0);
      }
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // A crash with an unreleased Mongo session is worse than a clean restart.
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

void main();
