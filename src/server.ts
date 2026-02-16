import app from './app';
import { connectDatabase } from './infrastructure/database/mongodb/connection';
import { getRedisClient } from './infrastructure/cache/redis.client';

const port = Number(process.env.PORT) || 3000;

// Initialize connections
async function initialize() {
  try {
    await connectDatabase();
    getRedisClient(); // Initialize Redis connection
    // eslint-disable-next-line no-console
    console.log('All connections initialized');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Initialization error:', err);
    process.exit(1);
  }
}

initialize().then(() => {
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Ledger API listening on port ${port}`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('HTTP server closed.');
      process.exit(0);
    });

    // Force shutdown if not closed in time
    setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error('Forcing shutdown after timeout.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
});
