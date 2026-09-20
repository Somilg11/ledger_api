import { Schema, model, Document } from 'mongoose';

import { UserRole, UserStatus } from '../../../../domain/entities/User.entity';

export type { UserRole, UserStatus };

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name?: string;
  phone?: string;
  roles: UserRole[];
  status: UserStatus;
  emailVerified: boolean;
  /** Bumped on password change or "log out everywhere" to invalidate live tokens. */
  tokenVersion: number;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    // Stored lowercase so Alice@x.com and alice@x.com cannot become two users.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    // select:false keeps the hash out of every query that does not explicitly ask.
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 20 },
    roles: { type: [String], enum: ['USER', 'ADMIN'], default: ['USER'] },
    status: {
      type: String,
      enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED'],
      default: 'ACTIVE',
      index: true,
    },
    emailVerified: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        delete ret.tokenVersion;
        delete ret.failedLoginAttempts;
        delete ret.lockedUntil;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const UserModel = model<IUser>('User', UserSchema);
