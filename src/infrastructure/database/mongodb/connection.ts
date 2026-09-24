import mongoose from 'mongoose';
import { config } from '../../../shared/config/app.config';
import { logger } from '../../../shared/logger';

export async function connectDatabase(): Promise<void> {
  // Reject unknown fields instead of silently dropping them - a typo in a
  // query filter must not turn into "match everything".
  mongoose.set('strictQuery', true);
  mongoose.set('sanitizeFilter', true);

  await mongoose.connect(config.mongoUri, {
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    // Money writes must survive a primary failover before they are acknowledged.
    writeConcern: { w: 'majority', journal: true },
    retryWrites: true,
  });

  // Building indexes at boot keeps the unique constraints (account number,
  // idempotency key, email) in force from the first request.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).createIndexes()));

  logger.info('connected to MongoDB');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
