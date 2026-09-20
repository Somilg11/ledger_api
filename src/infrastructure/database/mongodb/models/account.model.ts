import { Schema, model, Document, Types } from 'mongoose';

import { AccountType, AccountStatus } from '../../../../domain/entities/Account.entity';

export type { AccountType, AccountStatus };

export interface IAccount extends Document {
  _id: Types.ObjectId;
  /** Absent only on system contra accounts, which belong to the bank. */
  userId?: Types.ObjectId;
  accountNumber: string;
  accountType: AccountType;
  currency: string;
  /** Minor units (paise/cents). Always an integer. */
  balance: number;
  /** Balance minus holds. Debits are checked against this. */
  availableBalance: number;
  status: AccountStatus;
  /** System (contra) accounts hold the other half of deposits and withdrawals. */
  isSystem: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<IAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: function (this: { isSystem?: boolean }) {
        return !this.isSystem;
      },
      index: true,
    },
    accountNumber: { type: String, required: true, unique: true, immutable: true },
    accountType: { type: String, enum: ['SAVINGS', 'CURRENT', 'WALLET'], required: true, immutable: true },
    currency: { type: String, required: true, default: 'INR', uppercase: true, immutable: true },
    // No schema-level min:0 here. Customer balances are protected by the
    // conditional $inc guard in TransactionService (which is race-safe, unlike
    // a read-then-write check), and system contra accounts are *expected* to
    // run negative - they are the bank's liability side of the book.
    balance: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
    status: { type: String, enum: ['ACTIVE', 'FROZEN', 'CLOSED'], default: 'ACTIVE', index: true },
    isSystem: { type: Boolean, default: false, immutable: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

AccountSchema.index({ userId: 1, status: 1 });

export const AccountModel = model<IAccount>('Account', AccountSchema);
