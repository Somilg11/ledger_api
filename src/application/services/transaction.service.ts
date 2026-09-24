import mongoose, { ClientSession, Types } from 'mongoose';
import {
  TransactionModel,
  ITransaction,
  TransactionType,
} from '../../infrastructure/database/mongodb/models/transaction.model';
import { AccountModel, IAccount } from '../../infrastructure/database/mongodb/models/account.model';
import { LedgerService } from './ledger.service';
import { AccountService, Actor, isAdmin } from './account.service';
import { AuditService } from './audit.service';
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

export interface AuthorizeInput extends TransferInput {
  /** How long the reservation stays capturable. Defaults to 7 days. */
  expiresInSeconds?: number;
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
const DEFAULT_HOLD_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_HOLD_TTL_SECONDS = 30 * 24 * 60 * 60;

const allowSelfDeposit = process.env.ALLOW_SELF_DEPOSIT
  ? process.env.ALLOW_SELF_DEPOSIT === 'true'
  : !config.isProduction;

export class TransactionService {
  constructor(
    private ledger: LedgerService = new LedgerService(),
    private accounts: AccountService = new AccountService(),
    private audit: AuditService = new AuditService()
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

  /**
   * Gate on email verification, when the deployment requires it. Off by
   * default so the simulation works the moment you register; a real bank would
   * turn it on, and the check reads the database-backed flag on the actor
   * rather than anything the client sent.
   */
  private assertVerified(actor: Actor) {
    if (!config.emailVerification.required) return;
    if (isAdmin(actor)) return;
    if (actor.emailVerified) return;

    throw new ForbiddenError('Verify your email address before moving money');
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
  private async debit(
    accountId: Types.ObjectId | string,
    amount: number,
    session: ClientSession,
    allowNegative = false
  ) {
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
    this.assertVerified(actor);
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
    if (source.isSystem && !isAdmin(actor))
      throw new ForbiddenError('System accounts cannot be used directly');

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
    this.assertVerified(actor);
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
    this.assertVerified(actor);
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

    const counterparties = [txn.fromAccount, txn.toAccount].filter((id): id is Types.ObjectId => Boolean(id));

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

  /**
   * Places a hold (an authorisation).
   *
   * This is what `availableBalance` exists for. The money is reserved — it can
   * no longer be spent twice — but it has not moved, so `balance` is untouched
   * and **no ledger entries are written**. Nothing has happened in accounting
   * terms until the hold is captured, and the double-entry invariant is
   * therefore unaffected by an outstanding hold.
   */
  async authorize(actor: Actor, input: AuthorizeInput): Promise<ITransaction> {
    this.assertVerified(actor);
    const amount = assertValidAmount(input.amount);
    const idempotencyKey = this.scopedKey(actor, input.idempotencyKey);

    if (String(input.fromAccountId) === String(input.toAccountId)) {
      throw new ValidationError('fromAccount and toAccount must be different');
    }

    const ttl = input.expiresInSeconds ?? DEFAULT_HOLD_TTL_SECONDS;
    if (!Number.isInteger(ttl) || ttl <= 0 || ttl > MAX_HOLD_TTL_SECONDS) {
      throw new ValidationError(`expiresInSeconds must be an integer between 1 and ${MAX_HOLD_TTL_SECONDS}`);
    }

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }

    const source = await this.accounts.getAuthorizedAccount(actor, input.fromAccountId);
    if (source.isSystem && !isAdmin(actor))
      throw new ForbiddenError('System accounts cannot be used directly');

    const destination = await AccountModel.findById(input.toAccountId).exec();
    if (!destination) throw new NotFoundError('Destination account not found');

    this.assertUsable(source, 'source');
    this.assertUsable(destination, 'destination');

    if (source.currency !== destination.currency) {
      throw new ValidationError(
        `Currency mismatch: source is ${source.currency}, destination is ${destination.currency}`
      );
    }

    try {
      return await this.inTransaction(async (session) => {
        // Only availableBalance moves, and only if it covers the amount. Two
        // simultaneous holds cannot both reserve the same funds.
        const reserved = await AccountModel.findOneAndUpdate(
          { _id: source._id, availableBalance: mongoose.trusted({ $gte: amount }) },
          { $inc: { availableBalance: -amount } },
          { new: true, session }
        ).exec();

        if (!reserved) throw new InsufficientFundsError('Insufficient available balance');

        const [txn] = await TransactionModel.create(
          [
            {
              fromAccount: source._id,
              toAccount: destination._id,
              amount,
              currency: source.currency,
              type: 'TRANSFER',
              status: 'PENDING',
              initiatedBy: new Types.ObjectId(actor.id),
              idempotencyKey,
              reference: input.reference,
              metadata: input.metadata,
              expiresAt: new Date(Date.now() + ttl * 1000),
            },
          ],
          { session }
        );

        return txn;
      });
    } catch (err) {
      return this.resolveDuplicate(idempotencyKey, err);
    }
  }

  /** Loads a hold the actor is allowed to settle. */
  private async getCapturableHold(actor: Actor, transactionId: string): Promise<ITransaction> {
    if (!mongoose.Types.ObjectId.isValid(transactionId)) throw new NotFoundError('Transaction not found');

    const txn = await TransactionModel.findById(transactionId).exec();
    if (!txn) throw new NotFoundError('Transaction not found');
    if (txn.status !== 'PENDING')
      throw new ConflictError(`This transaction is ${txn.status}, not a live hold`);
    if (!txn.fromAccount) throw new ConflictError('This hold has no source account');

    // Settling is the source account owner's call, same as creating the hold.
    await this.accounts.getAuthorizedAccount(actor, String(txn.fromAccount));
    return txn;
  }

  /**
   * Settles a hold: the reserved funds actually move and the journal entries
   * are written. This is the point at which the transaction becomes real.
   */
  async capture(actor: Actor, transactionId: string): Promise<ITransaction> {
    this.assertVerified(actor);
    const hold = await this.getCapturableHold(actor, transactionId);

    if (hold.expiresAt && hold.expiresAt.getTime() <= Date.now()) {
      throw new ConflictError('This hold has expired and can only be voided');
    }

    return this.inTransaction(async (session) => {
      // Claim the hold first. Two simultaneous captures cannot both proceed,
      // because only one of them moves the row out of PENDING.
      const claimed = await TransactionModel.findOneAndUpdate(
        { _id: hold._id, status: 'PENDING' },
        { $set: { status: 'COMPLETED', completedAt: new Date() } },
        { new: true, session }
      ).exec();

      if (!claimed) throw new ConflictError('This hold has already been settled');

      const source = await AccountModel.findById(hold.fromAccount).session(session).exec();
      const destination = await AccountModel.findById(hold.toAccount).session(session).exec();
      if (!source || !destination) throw new NotFoundError('Account not found');

      // A closed account cannot settle. A frozen one still can: the funds were
      // reserved before the freeze, and stranding them would be worse.
      if (source.status === 'CLOSED') throw new ConflictError('The source account is closed');
      if (destination.status === 'CLOSED') throw new ConflictError('The destination account is closed');

      // availableBalance was already reduced when the hold was placed, so only
      // the ledger balance moves here.
      const debited = await AccountModel.findOneAndUpdate(
        { _id: source._id },
        { $inc: { balance: -hold.amount } },
        { new: true, session }
      ).exec();

      const credited = await AccountModel.findOneAndUpdate(
        { _id: destination._id },
        { $inc: { balance: hold.amount, availableBalance: hold.amount } },
        { new: true, session }
      ).exec();

      if (!debited || !credited) throw new NotFoundError('Account not found');

      await this.ledger.recordEntries(
        [
          {
            transactionId: claimed._id,
            accountId: debited._id,
            entryType: 'DEBIT',
            amount: hold.amount,
            currency: hold.currency,
            balanceAfter: debited.balance,
          },
          {
            transactionId: claimed._id,
            accountId: credited._id,
            entryType: 'CREDIT',
            amount: hold.amount,
            currency: hold.currency,
            balanceAfter: credited.balance,
          },
        ],
        session
      );

      return claimed;
    });
  }

  /** Releases a hold. The reservation is returned; no money ever moved. */
  async voidHold(actor: Actor, transactionId: string, reason?: string): Promise<ITransaction> {
    const hold = await this.getCapturableHold(actor, transactionId);

    return this.inTransaction(async (session) => {
      const released = await TransactionModel.findOneAndUpdate(
        { _id: hold._id, status: 'PENDING' },
        {
          $set: {
            status: 'CANCELLED',
            completedAt: new Date(),
            metadata: { ...(hold.metadata ?? {}), voidReason: reason },
          },
        },
        { new: true, session }
      ).exec();

      if (!released) throw new ConflictError('This hold has already been settled');

      await AccountModel.updateOne(
        { _id: hold.fromAccount },
        { $inc: { availableBalance: hold.amount } },
        { session }
      ).exec();

      return released;
    });
  }

  async reverse(actor: Actor, transactionId: string, reason?: string): Promise<ITransaction> {
    if (!isAdmin(actor)) throw new ForbiddenError('Only an administrator can reverse a transaction');

    const original = await TransactionModel.findById(transactionId).exec();
    if (!original) throw new NotFoundError('Transaction not found');
    if (original.status !== 'COMPLETED')
      throw new ConflictError(`Cannot reverse a ${original.status} transaction`);

    const alreadyReversed = await TransactionModel.findOne({
      'metadata.reversalOf': String(original._id),
    }).exec();
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

      // Recorded outside the money movement: an audit failure must not undo a
      // reversal the operator has already performed.
      void this.audit.record(actor, {
        action: 'TRANSACTION_REVERSED',
        targetType: 'TRANSACTION',
        targetId: original._id,
        subjectUserId: original.initiatedBy ? String(original.initiatedBy) : undefined,
        reason,
        metadata: { amount: original.amount, currency: original.currency, reversalId: String(reversal._id) },
      });

      return reversal;
    });
  }
}
