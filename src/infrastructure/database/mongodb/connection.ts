import mongoose from 'mongoose';
import { config } from '../../../shared/config/app.config';

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri, {
      // useNewUrlParser and useUnifiedTopology removed in newer mongoose types
    } as mongoose.ConnectOptions);
    // eslint-disable-next-line no-console
    console.log('Connected to MongoDB');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MongoDB connection error', err);
    throw err;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
