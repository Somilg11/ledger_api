/**
 * Promotes a user to ADMIN.
 *   npm run build && node dist/../scripts/... is awkward, so run it with:
 *   npx ts-node scripts/promote-admin.ts user@example.com
 */
import mongoose from 'mongoose';
import { config } from '../src/shared/config/app.config';
import { UserModel } from '../src/infrastructure/database/mongodb/models/user.model';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: ts-node scripts/promote-admin.ts <email>');
    process.exit(1);
  }

  await mongoose.connect(config.mongoUri);
  const user = await UserModel.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    { $addToSet: { roles: 'ADMIN' }, $inc: { tokenVersion: 1 } },
    { new: true }
  ).exec();

  if (!user) {
    console.error(`No user found for ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${user.email} now holds roles: ${user.roles.join(', ')}`);
    console.log('Existing sessions were invalidated - log in again to receive the new roles.');
  }

  await mongoose.disconnect();
}

void main();
