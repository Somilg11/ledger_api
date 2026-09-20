import mongoose, { ClientSession, Types } from 'mongoose';
import { TransactionModel, ITransaction, TransactionType } from '../../infrastructure/database/mongodb/models/transaction.model';
import { AccountModel, IAccount } from '../../infrastructure/database/mongodb/models/account.model';
import { LedgerService } from './ledger.service';
import { AccountService, Actor, isAdmin } from './account.service';
import { assertValidAmount, assertSupportedCurrency } from '../../shared/utils/money';
import { config } from '../../shared/config/app.config';
import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  InsufficientFundsError,
} from '../../shared/errors';

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  idempotencyKey?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

export interface CashInput {
  accountId: string;
  amount: number;
  idempotencyKey?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Self-service deposits exist so a demo/simulation front end can fund a wallet.
 * In production only an administrator (or a settlement webhook) may create
 * money, so this defaults to off there.
 */
const allowSelfDeposit = process.env.ALLOW_SELF_DEPOSIT
  ? process.env.ALLOW_SELF_DEPOSIT === 'true'
  : !config.isProduction;

export class TransactionService {
  constructor(
    private ledger: LedgerService = new LedgerService(),
    private accounts: AccountService = new AccountService()
  ) {}

  /**
   * Idempotency keys are namespaced per user. A global key space would let one
   * client replay another client's key and be handed their cached response.
   */
  private scopedKey(actor: Actor, key?: string): string | undefined {
    if (!key) return undefined;
    if (key.length > 128) throw new ValidationError('X-Idempotency-Key must be at most 128 characters');
    return `${actor.id}:${key}`;
  }

  private async findByIdempotencyKey(key: string): Promise<ITransaction | null> {
    return TransactionModel.findOne({ idempotencyKey: key }).exec();
  }

  private assertUsable(account: IAccount, role: 'source' | 'destination') {
    if (account.status === 'CLOSED') {
      throw new ConflictError(`The ${role} account is closed`);
    }
    if (account.status === 'FROZEN') {
      throw new ConflictError(`The ${role} account is frozen`);
    }
  }

  /**
   * Runs the money movement inside a MongoDB multi-document transaction so the
   * two balance updates, the transaction record and the journal entries either
   * all land or none do. Requires a replica set (see docker-compose.yml).
   */
  private async inTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /** Debits an account only if it can cover the amount - race-safe by construction. */
  private async debit(accountId: Types.ObjectId | string, amount: number, session: ClientSession, allowNegative = false) {
    const filter: Record<string, unknown> = { _id: accountId };
    if (!allowNegative) {
      // The balance condition lives in the update filter, so two concurrent
      // debits cannot both read "enough funds" and both succeed.
      // mongoose.trusted() marks this operator as our own, so the global
      // sanitizeFilter (which defends against injected operators) does not
      // rewrite it into an equality match.
      filter.availableBalance = mongoose.trusted({ $gte: amount });
    }

    return AccountModel.findOneAndUpdate(
      filter,
      { $inc: { balance: -amount, availableBalance: -amount } },
      { new: true, session }
    ).exec();
  }

  private async credit(accountId: Types.ObjectId | string, amount: number, session: ClientSession) {
    return AccountModel.findOneAndUpdate(
      { _id: accountId },
      { $inc: { balance: amount, availableBalance: amount } },
      { new: true, session }
    ).exec();
  }

  private async persist(
    session: ClientSession,
    data: {
      type: TransactionType;
      amount: number;
      currency: string;
      from?: IAccount | null;
      to?: IAccount | null;
      actorId: string;
      idempotencyKey?: string;
      reference?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    const [txn] = await TransactionModel.create(
      [
        {
          fromAccount: data.from?._id,
          toAccount: data.to?._id,
          amount: data.amount,
          currency: data.currency,
          type: data.type,
          status: 'COMPLETED',
          initiatedBy: new Types.ObjectId(data.actorId),
          idempotencyKey: data.idempotencyKey,
          reference: data.reference,
          metadata: data.metadata,
          completedAt: new Date(),
        },
      ],
      { session }
    );

    const entries = [];
    if (data.from) {
      entries.push({
        transactionId: txn._id,
        accountId: data.from._id,
        entryType: 'DEBIT' as const,
        amount: data.amount,
        currency: data.currency,
        balanceAfter: data.from.balance,
      });
    }
    if (data.to) {
      entries.push({
        transactionId: txn._id,
        accountId: data.to._id,
        entryType: 'CREDIT' as const,
        amount: data.amount,
        currency: data.currency,
        balanceAfter: data.to.balance,
      });
    }

    await this.ledger.recordEntries(entries, session);
    return txn;
  }

  /** Maps a duplicate-key crash on the idempotency index to the original result. */
  private async resolveDuplicate(key: string | undefined, err: unknown): Promise<ITransaction> {
    if (key && (err as { code?: number }).code === 11000) {
      const existing = await this.findByIdempotencyKey(key);
      if (existing) return existing;
    }
    throw err;
  }

  async createTransfer(actor: Actor, input: TransferInput): Promise<ITransaction> {
    const amount = assertValidAmount(input.amount);
    const idempotencyKey = this.scopedKey(actor, input.idempotencyKey);

    if (String(input.fromAccountId) === String(input.toAccountId)) {
      throw new ValidationError('fromAccount and toAccount must be different');
    }

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }

    // Authorisation happens before anything is written: only the owner of the
    // source account (or an admin) may move its money.
    const source = await this.accounts.getAuthorizedAccount(actor, input.fromAccountId);
    if (source.isSystem && !isAdmin(actor)) throw new ForbiddenError('System accounts cannot be used directly');

    const destination = await AccountModel.findById(input.toAccountId).exec();
    if (!destination) throw new NotFoundError('Destination account not found');

    this.assertUsable(source, 'source');
    this.assertUsable(destination, 'destination');

    // Currencies must match: moving 100 paise into a USD account at par would
    // silently create value out of nothing.
    if (source.currency !== destination.currency) {
      throw new ValidationError(
        `Currency mismatch: source is ${source.currency}, destination is ${destination.currency}`
      );
    }

    try {
      return await this.inTransaction(async (session) => {
        const debited = await this.debit(source._id, amount, session);
        if (!debited) throw new InsufficientFundsError('Insufficient available balance');

        const credited = await this.credit(destination._id, amount, session);
        if (!credited) throw new NotFoundError('Destination account not found');

        return this.persist(session, {
          type: 'TRANSFER',
          amount,
          currency: source.currency,
          from: debited,
          to: credited,
          actorId: actor.id,
          idempotencyKey,
          reference: input.reference,
          metadata: input.metadata,
        });
      });
    } catch (err) {
      return this.resolveDuplicate(idempotencyKey, err);
    }
  }

  async deposit(actor: Actor, input: CashInput): Promise<ITransaction> {
    const amount = assertValidAmount(input.amount);
    const idempotencyKey = this.scopedKey(actor, input.idempotencyKey);

    if (!isAdmin(actor) && !allowSelfDeposit) {
      throw new ForbiddenError('Only an administrator can deposit funds');
    }

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }

    const account = await this.accounts.getAuthorizedAccount(actor, input.accountId);
    if (account.isSystem) throw new ForbiddenError('System accounts cannot be used directly');
    this.assertUsable(account, 'destination');

    try {
      return await this.inTransaction(async (session) => {
        // The bank's contra account is debited so the books still balance.
        const system = await this.accounts.getOrCreateSystemAccount(account.currency, session);
        const debited = await this.debit(system._id, amount, session, true);
        const credited = await this.credit(account._id, amount, session);
        if (!credited) throw new NotFoundError('Account not found');

        return this.persist(session, {
          type: 'DEPOSIT',
          amount,
          currency: account.currency,
          from: debited,
          to: credited,
          actorId: actor.id,
          idempotencyKey,
          reference: input.reference,
          metadata: input.metadata,
        });
      });
    } catch (err) {
      return this.resolveDuplicate(idempotencyKey, err);
    }
  }

  async withdraw(actor: Actor, input: CashInput): Promise<ITransaction> {
    const amount = assertValidAmount(input.amount);
    const idempotencyKey = this.scopedKey(actor, input.idempotencyKey);

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }

    const account = await this.accounts.getAuthorizedAccount(actor, input.accountId);
    if (account.isSystem) throw new ForbiddenError('System accounts cannot be used directly');
    this.assertUsable(account, 'source');

    try {
      return await this.inTransaction(async (session) => {
        const debited = await this.debit(account._id, amount, session);
        if (!debited) throw new InsufficientFundsError('Insufficient available balance');

        const system = await this.accounts.getOrCreateSystemAccount(account.currency, session);
        const credited = await this.credit(system._id, amount, session);

        return this.persist(session, {
          type: 'WITHDRAWAL',
          amount,
          currency: account.currency,
          from: debited,
          to: credited,
          actorId: actor.id,
          idempotencyKey,
          reference: input.reference,
          metadata: input.metadata,
        });
      });
    } catch (err) {
      return this.resolveDuplicate(idempotencyKey, err);
    }
  }

  /** A transaction is visible to an admin, its initiator, or either counterparty's owner. */
  async getById(actor: Actor, transactionId: string): Promise<ITransaction> {
    if (!mongoose.Types.ObjectId.isValid(transactionId)) throw new NotFoundError('Transaction not found');

    const txn = await TransactionModel.findById(transactionId).exec();
    if (!txn) throw new NotFoundError('Transaction not found');
    if (isAdmin(actor)) return txn;

    if (String(txn.initiatedBy) === actor.id) return txn;

    const counterparties = [txn.fromAccount, txn.toAccount].filter(
      (id): id is Types.ObjectId => Boolean(id)
    );

    const related = await AccountModel.find({
      _id: mongoose.trusted({ $in: counterparties }),
      userId: new Types.ObjectId(actor.id),
    })
      .select('_id')
      .exec();

    if (related.length === 0) throw new NotFoundError('Transaction not found');
    return txn;
  }

  async listByAccount(actor: Actor, accountId: string, limit: number, skip: number) {
    // Ownership of the account is what authorises reading its statement.
    const account = await this.accounts.getAuthorizedAccount(actor, accountId);

    return TransactionModel.find({
      $or: [{ fromAccount: account._id }, { toAccount: account._id }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec();
  }

  async reverse(actor: Actor, transactionId: string, reason?: string): Promise<ITransaction> {
    if (!isAdmin(actor)) throw new ForbiddenError('Only an administrator can reverse a transaction');

    const original = await TransactionModel.findById(transactionId).exec();
    if (!original) throw new NotFoundError('Transaction not found');
    if (original.status !== 'COMPLETED') throw new ConflictError(`Cannot reverse a ${original.status} transaction`);

    const alreadyReversed = await TransactionModel.findOne({ 'metadata.reversalOf': String(original._id) }).exec();
    if (alreadyReversed) throw new ConflictError('Transaction has already been reversed');

    const currency = assertSupportedCurrency(original.currency);

    return this.inTransaction(async (session) => {
      // A reversal is a new, opposite transaction. The original row and its
      // journal entries are never edited - that is what keeps the audit trail
      // trustworthy.
      const source = original.toAccount
        ? await this.debit(original.toAccount, original.amount, session, true)
        : null;
      const destination = original.fromAccount
        ? await this.credit(original.fromAccount, original.amount, session)
        : null;

      if (!source && !destination) throw new AppError('REVERSAL_FAILED', 'Nothing to reverse', 409);

      const reversal = await this.persist(session, {
        type: original.type,
        amount: original.amount,
        currency,
        from: source,
        to: destination,
        actorId: actor.id,
        reference: `Reversal of ${String(original._id)}`,
        metadata: { reversalOf: String(original._id), reason },
      });

      await TransactionModel.updateOne(
        { _id: original._id },
        { $set: { status: 'REVERSED' } },
        { session }
      ).exec();

      return reversal;
    });
  }
}
