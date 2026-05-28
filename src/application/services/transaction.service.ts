import mongoose from 'mongoose';
import { TransactionModel } from '../../infrastructure/database/mongodb/models/transaction.model';
import { AccountModel } from '../../infrastructure/database/mongodb/models/account.model';
import { LedgerService } from './ledger.service';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { AppError } from '../../shared/errors/AppError';
import { InsufficientFundsError } from '../../shared/errors/InsufficientFundsError';

const cache = new CacheService();

export class TransactionService {
  private ledger = new LedgerService();

  async createTransfer(options: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    currency?: string;
    idempotencyKey?: string;
    reference?: string;
    metadata?: Record<string, any>;
  }) {
    const { fromAccountId, toAccountId, amount, currency = 'INR', idempotencyKey, reference, metadata } = options;

    if (amount <= 0) throw new Error('Amount must be positive');

    // Idempotency: check existing transaction
    const processingKey = idempotencyKey ? `idemp:${idempotencyKey}:processing` : null;
    const responseKey = idempotencyKey ? `idemp:${idempotencyKey}:response` : null;

    // If cached response exists, return it
    if (responseKey) {
      const cached = await cache.get(responseKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    // Try to acquire processing lock
    if (processingKey) {
      const acquired = await cache.setIfNotExists(processingKey, '1', 60);
      if (!acquired) {
        throw new AppError('PROCESSING', 'Request is currently being processed', 409);
      }
    }

    // DB-side idempotency check (in case persisted earlier)
    if (idempotencyKey) {
      const existing = await TransactionModel.findOne({ idempotencyKey }).exec();
      if (existing) {
        // release processing key
        if (processingKey) await cache.del(processingKey);
        if (responseKey) await cache.set(responseKey, JSON.stringify(existing), 24 * 60 * 60);
        return existing;
      }
    }

    const session = await mongoose.startSession();
    try {
      let result: any = null;
      await session.withTransaction(async () => {
        // Perform atomic updates using $inc and conditional filter to avoid races
        const fromAccUpdated = await AccountModel.findOneAndUpdate(
          { _id: fromAccountId, availableBalance: { $gte: amount } },
          { $inc: { balance: -amount, availableBalance: -amount } },
          { new: true, session }
        ).exec();

  if (!fromAccUpdated) throw new InsufficientFundsError();

        const toAccUpdated = await AccountModel.findByIdAndUpdate(
          toAccountId,
          { $inc: { balance: amount, availableBalance: amount } },
          { new: true, session }
        ).exec();

  if (!toAccUpdated) throw new AppError('DEST_NOT_FOUND', 'Destination account not found', 404);

        // Create transaction record
        const txn = new TransactionModel({
          fromAccount: fromAccUpdated._id,
          toAccount: toAccUpdated._id,
          amount,
          currency,
          type: 'TRANSFER',
          status: 'COMPLETED',
          idempotencyKey,
          reference,
          metadata,
          completedAt: new Date(),
        });

        await txn.save({ session });

        // Create ledger entries within the same session (bulk)
        await this.ledger.recordEntries(
          [
            {
              transactionId: txn._id,
              accountId: fromAccUpdated._id,
              entryType: 'DEBIT',
              amount,
              currency,
            },
            {
              transactionId: txn._id,
              accountId: toAccUpdated._id,
              entryType: 'CREDIT',
              amount,
              currency,
            },
          ],
          session
        );

        result = txn;
        // cache response
        if (responseKey) {
          await cache.set(responseKey, JSON.stringify(txn), 24 * 60 * 60);
        }
      });
      // release processing key
      if (processingKey) await cache.del(processingKey);
      return result;
    } finally {
      session.endSession();
      // ensure processing key cleared in case of exception
      if (processingKey) await cache.del(processingKey);
    }
  }
}
