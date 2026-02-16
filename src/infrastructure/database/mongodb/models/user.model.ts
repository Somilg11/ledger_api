import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name?: string;
  phone?: string;
  roles: string[];
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    phone: { type: String },
    roles: { type: [String], default: ['USER'] },
    status: { type: String, default: 'PENDING_VERIFICATION' },
  },
  { timestamps: true }
);

export const UserModel = model<IUser>('User', UserSchema);
