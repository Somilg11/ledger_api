import { Schema, model, Document, Types } from 'mongoose';

import { TransactionStatus, TransactionType } from '../../../../domain/entities/Transaction.entity';

export type { TransactionStatus, TransactionType };

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  fromAccount?: Types.ObjectId;
  toAccount?: Types.ObjectId;
  /** Minor units (paise/cents). Always an integer. */
  amount: number;
  currency: string;
  status: TransactionStatus;
  type: TransactionType;
  /** User who initiated the transaction; used for authorising reads. */
  initiatedBy?: Types.ObjectId;
  reference?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  /** Set on a hold: after this the reservation can no longer be captured. */
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    fromAccount: { type: Schema.Types.ObjectId, ref: 'Account', index: true },
    toAccount: { type: Schema.Types.ObjectId, ref: 'Account', index: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, default: 'INR', uppercase: true },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED'],
      required: true,
      default: 'PENDING',
      index: true,
    },
    type: { type: String, enum: ['TRANSFER', 'DEPOSIT', 'WITHDRAWAL'], required: true },
    initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    reference: { type: String, maxlength: 140 },
    metadata: { type: Schema.Types.Mixed },
    idempotencyKey: { type: String },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

// Unique + sparse: two concurrent requests carrying the same idempotency key
// cannot both commit - the second one loses on the index, not on a race.
TransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
TransactionSchema.index({ fromAccount: 1, createdAt: -1 });
TransactionSchema.index({ toAccount: 1, createdAt: -1 });
// Finds holds that a sweeper should release.
TransactionSchema.index({ status: 1, expiresAt: 1 });

export const TransactionModel = model<ITransaction>('Transaction', TransactionSchema);
