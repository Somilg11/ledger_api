import { Schema, model, Document, Types } from 'mongoose';

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type TransactionType = 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL';

export interface ITransaction extends Document {
  fromAccount?: string;
  toAccount?: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  type: TransactionType;
  reference?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  createdAt: Date;
  completedAt?: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    fromAccount: { type: String },
    toAccount: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'INR' },
    status: { type: String, required: true, default: 'PENDING' },
    type: { type: String, required: true },
    reference: { type: String },
    metadata: { type: Schema.Types.Mixed },
    idempotencyKey: { type: String, index: true },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

TransactionSchema.index({ idempotencyKey: 1 });

export const TransactionModel = model<ITransaction>('Transaction', TransactionSchema);
