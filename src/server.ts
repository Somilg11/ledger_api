import app from './app';
import { config } from './shared/config/app.config';
import { connectDatabase, disconnectDatabase } from './infrastructure/database/mongodb/connection';
import { getRedisClient, disconnectRedis } from './infrastructure/cache/redis.client';

async function initialize() {
  await connectDatabase();
  await getRedisClient().ping();
  // eslint-disable-next-line no-console
  console.log('MongoDB and Redis connections ready');
}

async function main() {
  try {
    await initialize();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Initialization failed:', err);
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Ledger API listening on port ${config.port} (${config.env})`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down gracefully`);

    // Stop accepting new requests first, then release the data connections so
    // no transaction is cut off mid-flight.
    const forced = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error('Forcing shutdown after timeout');
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
    // eslint-disable-next-line no-console
    console.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception:', err);
    void shutdown('uncaughtException');
  });
}

void main();
