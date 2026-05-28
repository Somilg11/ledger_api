import { LedgerModel, ILedgerEntry } from '../models/ledger.model';

export class LedgerRepository {
  async create(entry: Partial<ILedgerEntry>) {
    const doc = new LedgerModel(entry as any);
    return await doc.save();
  }

  async createMany(entries: Partial<ILedgerEntry>[], session?: any) {
    if (session) {
      return await LedgerModel.insertMany(entries, { session });
    }
    return await LedgerModel.insertMany(entries);
  }

  async findByAccount(accountId: string, limit = 50, skip = 0) {
    return await LedgerModel.find({ accountId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec();
  }

  async findByTransaction(transactionId: string) {
    return await LedgerModel.find({ transactionId }).exec();
  }
}
