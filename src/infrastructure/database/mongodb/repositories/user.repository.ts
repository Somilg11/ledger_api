import { UserModel, IUser } from '../models/user.model';

export class UserRepository {
  async create(payload: Partial<IUser>) {
    return UserModel.create(payload);
  }

  /** Normal reads never include the password hash (schema has select:false). */
  async findByEmail(email: string) {
    return UserModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  /** Only the login path needs the hash, and it asks for it explicitly. */
  async findByEmailWithSecret(email: string) {
    return UserModel.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash').exec();
  }

  async findById(id: string) {
    return UserModel.findById(id).exec();
  }

  async recordFailedLogin(id: string, maxAttempts: number, lockSeconds: number) {
    const user = await UserModel.findByIdAndUpdate(
      id,
      { $inc: { failedLoginAttempts: 1 } },
      { new: true }
    ).exec();

    if (user && user.failedLoginAttempts >= maxAttempts) {
      user.lockedUntil = new Date(Date.now() + lockSeconds * 1000);
      user.failedLoginAttempts = 0;
      await user.save();
    }
    return user;
  }

  async clearLoginFailures(id: string) {
    return UserModel.findByIdAndUpdate(id, { failedLoginAttempts: 0, lockedUntil: null }).exec();
  }

  async bumpTokenVersion(id: string) {
    return UserModel.findByIdAndUpdate(id, { $inc: { tokenVersion: 1 } }, { new: true }).exec();
  }
}
