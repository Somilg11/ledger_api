import { Schema, model, Document, Types } from 'mongoose';

export type AuditAction = 'TRANSACTION_REVERSED' | 'ACCOUNT_FROZEN' | 'ACCOUNT_UNFROZEN' | 'ACCOUNT_CLOSED';

export interface IAuditLog extends Document {
  actorId: Types.ObjectId;
  actorEmail?: string;
  action: AuditAction;
  targetType: 'ACCOUNT' | 'TRANSACTION';
  targetId: Types.ObjectId;
  /** Whose account or transaction was acted on. */
  subjectUserId?: Types.ObjectId;
  requestId?: string;
  ip?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorEmail: { type: String },
    action: {
      type: String,
      enum: ['TRANSACTION_REVERSED', 'ACCOUNT_FROZEN', 'ACCOUNT_UNFROZEN', 'ACCOUNT_CLOSED'],
      required: true,
      index: true,
    },
    targetType: { type: String, enum: ['ACCOUNT', 'TRANSACTION'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    subjectUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    requestId: { type: String },
    ip: { type: String },
    reason: { type: String, maxlength: 280 },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ createdAt: -1 });

// Append-only, for the same reason the ledger is: a record of privileged
// actions that the privileged can edit is not a record of anything.
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
    AuditLogSchema as unknown as {
      pre: (name: string, fn: (next: (err?: Error) => void) => void) => void;
    }
  ).pre(hook, function (next) {
    next(new Error('Audit log entries are immutable'));
  });
}

export const AuditLogModel = model<IAuditLog>('AuditLog', AuditLogSchema);
