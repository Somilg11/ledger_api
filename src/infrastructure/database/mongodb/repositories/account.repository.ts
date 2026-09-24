import mongoose, { ClientSession } from 'mongoose';
import { AccountModel, IAccount } from '../models/account.model';

export class AccountRepository {
  async create(data: Partial<IAccount>): Promise<IAccount> {
    return AccountModel.create(data);
  }

  async findById(id: string, session?: ClientSession): Promise<IAccount | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return AccountModel.findById(id)
      .session(session ?? null)
      .exec();
  }

  async findByAccountNumber(accountNumber: string): Promise<IAccount | null> {
    return AccountModel.findOne({ accountNumber }).exec();
  }

  async findByUserId(userId: string, limit = 50, skip = 0): Promise<IAccount[]> {
    if (!mongoose.Types.ObjectId.isValid(userId)) return [];
    return AccountModel.find({ userId }).sort({ createdAt: -1 }).limit(limit).skip(skip).exec();
  }

  /**
   * Only a strict allow-list of fields is updatable. Balances are never
   * writable through this path - they move exclusively through ledger
   * transactions.
   */
  async updateMutableFields(
    id: string,
    data: { status?: IAccount['status']; metadata?: Record<string, unknown> }
  ): Promise<IAccount | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const update: Record<string, unknown> = {};
    if (data.status !== undefined) update.status = data.status;
    if (data.metadata !== undefined) update.metadata = data.metadata;
    if (Object.keys(update).length === 0) return AccountModel.findById(id).exec();
    return AccountModel.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true }).exec();
  }

  async countByUser(userId: string): Promise<number> {
    if (!mongoose.Types.ObjectId.isValid(userId)) return 0;
    return AccountModel.countDocuments({ userId }).exec();
  }
}
