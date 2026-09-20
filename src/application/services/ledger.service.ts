import { ClientSession } from 'mongoose';
import { LedgerRepository } from '../../infrastructure/database/mongodb/repositories/ledger.repository';
import { ILedgerEntry } from '../../infrastructure/database/mongodb/models/ledger.model';
import { ValidationError } from '../../shared/errors';

export class LedgerService {
  constructor(private repo: LedgerRepository = new LedgerRepository()) {}

  /**
   * Writes a balanced set of journal entries.
   * The debit/credit totals are checked before the insert, so an unbalanced
   * pair can never reach the journal in the first place.
   */
  async recordEntries(entries: Partial<ILedgerEntry>[], session?: ClientSession) {
    const debits = entries
      .filter((e) => e.entryType === 'DEBIT')
      .reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const credits = entries
      .filter((e) => e.entryType === 'CREDIT')
      .reduce((sum, e) => sum + (e.amount ?? 0), 0);

    if (debits !== credits) {
      throw new ValidationError('Unbalanced ledger entries: debits must equal credits', { debits, credits });
    }

    return this.repo.createMany(entries, session);
  }

  async getByAccount(accountId: string, limit = 50, skip = 0) {
    return this.repo.findByAccount(accountId, limit, skip);
  }

  async getByTransaction(transactionId: string) {
    return this.repo.findByTransaction(transactionId);
  }

  async computeBalance(accountId: string) {
    return this.repo.computeBalance(accountId);
  }

  async verifyDoubleEntry() {
    return this.repo.verifyDoubleEntry();
  }
}
