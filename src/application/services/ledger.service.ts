
import { LedgerRepository } from '../../infrastructure/database/mongodb/repositories/ledger.repository';

export class LedgerService {
  constructor(private repo = new LedgerRepository()) {}

  async recordEntries(entries: Array<any>, session?: any) {
    // entries: [{ transactionId, accountId, entryType, amount, currency, balanceAfter?, metadata? }]
    // Use bulk insert when possible for performance
    return await this.repo.createMany(entries, session);
  }

  async getByAccount(accountId: string, limit = 50, skip = 0) {
    return await this.repo.findByAccount(accountId, limit, skip);
  }

  async getByTransaction(transactionId: string) {
    return await this.repo.findByTransaction(transactionId);
  }
}
