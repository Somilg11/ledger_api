import mongoose from 'mongoose';
import { AccountModel, IAccount } from '../models/account.model';
import { Account } from '../../../../domain/entities/Account.entity';

export class AccountRepository {
  async create(account: Account): Promise<IAccount> {
    const acc = new AccountModel(account as any);
    return await acc.save();
  }

  async findById(id: string): Promise<IAccount | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return await AccountModel.findById(id).exec();
  }

  async findByUserId(userId: string): Promise<IAccount[]> {
    if (!mongoose.Types.ObjectId.isValid(userId)) return [];
    return await AccountModel.find({ userId }).exec();
  }

  async update(id: string, data: Partial<Account>): Promise<IAccount | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return await AccountModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async delete(id: string): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(id)) return false;
    const result = await AccountModel.findByIdAndDelete(id).exec();
    return result !== null;
  }
}
