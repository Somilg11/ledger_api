import { Schema, model, Document, Types } from 'mongoose';

export interface ILedgerEntry extends Document {
  transactionId: Types.ObjectId;
  accountId: Types.ObjectId;
  entryType: 'DEBIT' | 'CREDIT';
  amount: number;
  currency: string;
  balanceAfter?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const LedgerSchema = new Schema<ILedgerEntry>(
  {
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', index: true },
    entryType: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    balanceAfter: { type: Number },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

LedgerSchema.index({ accountId: 1, createdAt: -1 });

export const LedgerModel = model<ILedgerEntry>('Ledger', LedgerSchema);
