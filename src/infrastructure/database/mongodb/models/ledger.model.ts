import { Schema, model, Document, Types } from 'mongoose';

import { EntryType } from '../../../../domain/entities/LedgerEntry.entity';

export type { EntryType };

export interface ILedgerEntry extends Document {
  transactionId: Types.ObjectId;
  accountId: Types.ObjectId;
  entryType: EntryType;
  /** Minor units (paise/cents). Always a positive integer. */
  amount: number;
  currency: string;
  /** Account balance immediately after this entry - the audit trail. May be
   * negative on system contra accounts. */
  balanceAfter: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const LedgerSchema = new Schema<ILedgerEntry>(
  {
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    entryType: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true },
    balanceAfter: { type: Number, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

LedgerSchema.index({ accountId: 1, createdAt: -1 });
LedgerSchema.index({ transactionId: 1, entryType: 1 });

// Ledger entries are immutable once written: an append-only log is what makes
// the history auditable. Corrections are new reversing entries, never edits.
const MUTATING_HOOKS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const;

for (const hook of MUTATING_HOOKS) {
  (
    LedgerSchema as unknown as {
      pre: (name: string, fn: (next: (err?: Error) => void) => void) => void;
    }
  ).pre(hook, function (next) {
    next(new Error('Ledger entries are immutable'));
  });
}

export const LedgerModel = model<ILedgerEntry>('Ledger', LedgerSchema);
