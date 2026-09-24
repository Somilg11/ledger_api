import { Schema, model, Document, Types } from 'mongoose';

export type TokenPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export interface IVerificationToken extends Document {
  userId: Types.ObjectId;
  /** SHA-256 of the token. The raw value is never stored. */
  tokenHash: string;
  purpose: TokenPurpose;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
}

const VerificationTokenSchema = new Schema<IVerificationToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Only the hash is stored. A leaked database dump must not hand an attacker
    // working verification or reset links, exactly as with passwords.
    tokenHash: { type: String, required: true, unique: true },
    purpose: { type: String, enum: ['EMAIL_VERIFICATION', 'PASSWORD_RESET'], required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// MongoDB removes the document once expiresAt passes, so spent tokens do not
// accumulate and an expired one cannot be resurrected.
VerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
VerificationTokenSchema.index({ userId: 1, purpose: 1 });

export const VerificationTokenModel = model<IVerificationToken>('VerificationToken', VerificationTokenSchema);
