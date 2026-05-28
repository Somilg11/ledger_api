import { AccountRepository } from '../../infrastructure/database/mongodb/repositories/account.repository';
import { Account } from '../../domain/entities/Account.entity';

export class AccountService {
  constructor(private repo: AccountRepository) {}

  async createAccount(data: Partial<Account>) {
    const account = new Account(data as Account);
    return await this.repo.create(account);
  }

  async getAccountById(id: string) {
    return await this.repo.findById(id);
  }

  async getAccountsByUser(userId: string) {
    return await this.repo.findByUserId(userId);
  }

  async updateAccount(id: string, data: Partial<Account>) {
    return await this.repo.update(id, data);
  }

  async closeAccount(id: string) {
    // Mark as closed
    return await this.repo.update(id, { status: 'closed' } as any);
  }
}
