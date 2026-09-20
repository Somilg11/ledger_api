import mongoose, { ClientSession } from 'mongoose';
import { LedgerModel, ILedgerEntry } from '../models/ledger.model';

export class LedgerRepository {
  async createMany(entries: Partial<ILedgerEntry>[], session?: ClientSession) {
    // ordered:true so a failing entry aborts the whole batch - a half-written
    // double-entry pair would break the ledger invariant.
    return LedgerModel.insertMany(entries, { session: session ?? undefined, ordered: true });
  }

  async findByAccount(accountId: string, limit = 50, skip = 0) {
    if (!mongoose.Types.ObjectId.isValid(accountId)) return [];
    return LedgerModel.find({ accountId }).sort({ createdAt: -1 }).limit(limit).skip(skip).exec();
  }

  async findByTransaction(transactionId: string) {
    if (!mongoose.Types.ObjectId.isValid(transactionId)) return [];
    return LedgerModel.find({ transactionId }).sort({ entryType: 1 }).exec();
  }

  /** Sums debits and credits for one account straight from the journal. */
  async computeBalance(accountId: string): Promise<{ debits: number; credits: number; balance: number }> {
    if (!mongoose.Types.ObjectId.isValid(accountId)) {
      return { debits: 0, credits: 0, balance: 0 };
    }
    const [row] = await LedgerModel.aggregate([
      { $match: { accountId: new mongoose.Types.ObjectId(accountId) } },
      {
        $group: {
          _id: null,
          debits: { $sum: { $cond: [{ $eq: ['$entryType', 'DEBIT'] }, '$amount', 0] } },
          credits: { $sum: { $cond: [{ $eq: ['$entryType', 'CREDIT'] }, '$amount', 0] } },
        },
      },
    ]).exec();

    const debits = row?.debits ?? 0;
    const credits = row?.credits ?? 0;
    return { debits, credits, balance: credits - debits };
  }

  /**
   * System-wide double-entry check: across every transaction the sum of
   * debits must equal the sum of credits.
   */
  async verifyDoubleEntry(): Promise<{ totalDebits: number; totalCredits: number; balanced: boolean }> {
    const [row] = await LedgerModel.aggregate([
      {
        $group: {
          _id: null,
          totalDebits: { $sum: { $cond: [{ $eq: ['$entryType', 'DEBIT'] }, '$amount', 0] } },
          totalCredits: { $sum: { $cond: [{ $eq: ['$entryType', 'CREDIT'] }, '$amount', 0] } },
        },
      },
    ]).exec();

    const totalDebits = row?.totalDebits ?? 0;
    const totalCredits = row?.totalCredits ?? 0;
    return { totalDebits, totalCredits, balanced: totalDebits === totalCredits };
  }
}
