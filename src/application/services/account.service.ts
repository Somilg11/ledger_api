import { ClientSession } from 'mongoose';
import { AccountRepository } from '../../infrastructure/database/mongodb/repositories/account.repository';
import { LedgerRepository } from '../../infrastructure/database/mongodb/repositories/ledger.repository';
import {
  AccountModel,
  IAccount,
  AccountType,
  AccountStatus,
} from '../../infrastructure/database/mongodb/models/account.model';
import { generateAccountNumber } from '../../shared/utils/accountNumber';
import { assertSupportedCurrency } from '../../shared/utils/money';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../../shared/errors';
import { AuditService } from './audit.service';

export interface Actor {
  id: string;
  roles: string[];
  email?: string;
  /** Read fresh from the database on every request by the auth middleware. */
  emailVerified?: boolean;
  /** Request context, carried so audit entries can name the exact request. */
  requestId?: string;
  ip?: string;
}

export function isAdmin(actor: Actor): boolean {
  return actor.roles.includes('ADMIN');
}

const ACCOUNT_TYPES: AccountType[] = ['SAVINGS', 'CURRENT', 'WALLET'];
const MAX_ACCOUNTS_PER_USER = 10;

export class AccountService {
  constructor(
    private repo: AccountRepository = new AccountRepository(),
    private ledgerRepo: LedgerRepository = new LedgerRepository(),
    private audit: AuditService = new AuditService()
  ) {}

  /**
   * Opens an account. The opening balance is always zero - money can only
   * enter the system through a ledgered deposit, never through account
   * creation.
   */
  async createAccount(actor: Actor, input: { userId?: string; accountType: string; currency?: string }) {
    // Only an admin may open an account on behalf of someone else.
    const ownerId =
      input.userId && input.userId !== actor.id
        ? isAdmin(actor)
          ? input.userId
          : (() => {
              throw new ForbiddenError('Cannot open an account for another user');
            })()
        : actor.id;

    const accountType = String(input.accountType || '').toUpperCase() as AccountType;
    if (!ACCOUNT_TYPES.includes(accountType)) {
      throw new ValidationError(`accountType must be one of: ${ACCOUNT_TYPES.join(', ')}`);
    }

    const currency = assertSupportedCurrency(input.currency ?? 'INR');

    if ((await this.repo.countByUser(ownerId)) >= MAX_ACCOUNTS_PER_USER) {
      throw new ConflictError(`A user may hold at most ${MAX_ACCOUNTS_PER_USER} accounts`);
    }

    // Retry on the unique-index collision rather than pre-checking, so two
    // simultaneous opens can never be handed the same number.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.repo.create({
          userId: ownerId as unknown as IAccount['userId'],
          accountNumber: generateAccountNumber(),
          accountType,
          currency,
          balance: 0,
          availableBalance: 0,
          status: 'ACTIVE',
        });
      } catch (err: unknown) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
    throw new ConflictError('Could not allocate an account number, please retry');
  }

  /** Loads an account and enforces "owner or admin" in one place. */
  async getAuthorizedAccount(actor: Actor, accountId: string, session?: ClientSession): Promise<IAccount> {
    const account = await this.repo.findById(accountId, session);
    if (!account) throw new NotFoundError('Account not found');
    if (String(account.userId) !== actor.id && !isAdmin(actor)) {
      // Same error as a missing account: a different message would tell an
      // attacker which account ids exist.
      throw new NotFoundError('Account not found');
    }
    return account;
  }

  async getAccountById(actor: Actor, accountId: string) {
    return this.getAuthorizedAccount(actor, accountId);
  }

  async listAccounts(actor: Actor, userId: string, limit: number, skip: number) {
    if (userId !== actor.id && !isAdmin(actor)) {
      throw new ForbiddenError('Cannot list accounts of another user');
    }
    return this.repo.findByUserId(userId, limit, skip);
  }

  async getBalance(actor: Actor, accountId: string) {
    const account = await this.getAuthorizedAccount(actor, accountId);
    const ledger = await this.ledgerRepo.computeBalance(accountId);

    return {
      accountId: String(account._id),
      accountNumber: account.accountNumber,
      currency: account.currency,
      balance: account.balance,
      availableBalance: account.availableBalance,
      ledgerBalance: ledger.balance,
      totalDebits: ledger.debits,
      totalCredits: ledger.credits,
      // If these ever disagree the cached balance drifted from the journal,
      // which is the single most important alarm in a ledger system.
      reconciled: account.balance === ledger.balance,
    };
  }

  async updateStatus(actor: Actor, accountId: string, status: AccountStatus) {
    const account = await this.getAuthorizedAccount(actor, accountId);

    if (account.isSystem) throw new ForbiddenError('System accounts cannot be modified');
    if (account.status === 'CLOSED') throw new ConflictError('Account is already closed');
    // Unfreezing is a bank-side action; a user who got frozen for fraud must
    // not be able to unfreeze themselves.
    if (account.status === 'FROZEN' && status === 'ACTIVE' && !isAdmin(actor)) {
      throw new ForbiddenError('Only an administrator can unfreeze an account');
    }
    if (status === 'CLOSED' && account.balance !== 0) {
      throw new ConflictError('Account must have a zero balance before it can be closed');
    }

    const updated = await this.repo.updateMutableFields(accountId, { status });

    // Only staff actions are audited. A user freezing their own account is
    // ordinary self-service; an operator doing it to someone else is not.
    const actingOnSomeoneElse = String(account.userId) !== actor.id;
    if (isAdmin(actor) && actingOnSomeoneElse) {
      const action =
        status === 'FROZEN' ? 'ACCOUNT_FROZEN' : status === 'CLOSED' ? 'ACCOUNT_CLOSED' : 'ACCOUNT_UNFROZEN';

      void this.audit.record(actor, {
        action,
        targetType: 'ACCOUNT',
        targetId: account._id,
        subjectUserId: account.userId ? String(account.userId) : undefined,
        metadata: { accountNumber: account.accountNumber, from: account.status, to: status },
      });
    }

    return updated;
  }

  async updateMetadata(actor: Actor, accountId: string, metadata: Record<string, unknown>) {
    const account = await this.getAuthorizedAccount(actor, accountId);
    if (account.isSystem) throw new ForbiddenError('System accounts cannot be modified');
    return this.repo.updateMutableFields(accountId, { metadata });
  }

  /**
   * The bank-side contra account for a currency. Deposits debit it and
   * withdrawals credit it, so total debits always equal total credits.
   */
  async getOrCreateSystemAccount(currency: string, session?: ClientSession): Promise<IAccount> {
    const accountNumber = `SYSTEM-${currency}`;
    const existing = await AccountModel.findOne({ accountNumber })
      .session(session ?? null)
      .exec();
    if (existing) return existing;

    try {
      const [created] = await AccountModel.create(
        [
          {
            accountNumber,
            accountType: 'CURRENT',
            currency,
            balance: 0,
            availableBalance: 0,
            status: 'ACTIVE',
            isSystem: true,
          },
        ],
        { session }
      );
      return created;
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        const raced = await AccountModel.findOne({ accountNumber })
          .session(session ?? null)
          .exec();
        if (raced) return raced;
      }
      throw err;
    }
  }
}
