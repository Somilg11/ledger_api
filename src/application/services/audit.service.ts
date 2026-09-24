import { Types } from 'mongoose';
import {
  AuditLogModel,
  AuditAction,
  IAuditLog,
} from '../../infrastructure/database/mongodb/models/auditLog.model';
import { Actor } from './account.service';
import { logger } from '../../shared/logger';

export interface AuditEntry {
  action: AuditAction;
  targetType: 'ACCOUNT' | 'TRANSACTION';
  targetId: Types.ObjectId | string;
  subjectUserId?: Types.ObjectId | string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  /**
   * Records a privileged action.
   *
   * Deliberately never throws: an audit write that fails must not roll back
   * the operation the operator just performed, and it must not be usable as a
   * way to make an action fail. The failure is logged loudly instead.
   */
  async record(actor: Actor, entry: AuditEntry): Promise<void> {
    try {
      await AuditLogModel.create({
        actorId: new Types.ObjectId(actor.id),
        actorEmail: actor.email,
        action: entry.action,
        targetType: entry.targetType,
        targetId: new Types.ObjectId(String(entry.targetId)),
        subjectUserId: entry.subjectUserId ? new Types.ObjectId(String(entry.subjectUserId)) : undefined,
        requestId: actor.requestId,
        ip: actor.ip,
        reason: entry.reason,
        metadata: entry.metadata,
      });
    } catch (err) {
      logger.error(
        { err, action: entry.action, targetId: String(entry.targetId) },
        'failed to write audit log'
      );
    }
  }

  async list(limit = 50, skip = 0): Promise<IAuditLog[]> {
    return AuditLogModel.find().sort({ createdAt: -1 }).limit(limit).skip(skip).exec();
  }

  async listForTarget(targetId: string, limit = 50): Promise<IAuditLog[]> {
    if (!Types.ObjectId.isValid(targetId)) return [];
    return AuditLogModel.find({ targetId: new Types.ObjectId(targetId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }
}
