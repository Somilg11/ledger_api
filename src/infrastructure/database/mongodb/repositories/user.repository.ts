import { UserModel, IUser } from '../models/user.model';

export class UserRepository {
  async create(payload: Partial<IUser>) {
    return UserModel.create(payload as any);
  }

  async findByEmail(email: string) {
    return UserModel.findOne({ email }).lean();
  }

  async findById(id: string) {
    return UserModel.findById(id).lean();
  }
}
