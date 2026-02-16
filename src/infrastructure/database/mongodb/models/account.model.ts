import { Schema, model, Document, Types } from 'mongoose';

export interface IAccount extends Document {
  userId: Types.ObjectId;
  accountNumber: string;
  accountType: 'SAVINGS' | 'CURRENT' | 'WALLET';
  currency: string;
  balance: number; // store in smallest currency unit
  availableBalance: number;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<IAccount>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountNumber: { type: String, required: true, unique: true },
    accountType: { type: String, required: true },
    currency: { type: String, required: true, default: 'INR' },
    balance: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
    status: { type: String, default: 'ACTIVE' },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const AccountModel = model<IAccount>('Account', AccountSchema);
