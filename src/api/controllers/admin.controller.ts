import { Response } from 'express';
import { auditService } from '../../shared/container';
import { AuthRequest } from '../middlewares/auth.middleware';
import { parsePagination } from '../../shared/utils/pagination';

export class AdminController {
  /** The trail of privileged actions: who reversed what, who unfroze which account. */
  async auditLogs(req: AuthRequest, res: Response) {
    const { limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const entries = await auditService.list(limit, skip);
    res.json({ success: true, data: entries, pagination: { limit, skip, count: entries.length } });
  }

  async auditForTarget(req: AuthRequest, res: Response) {
    const { limit } = parsePagination(req.query as Record<string, unknown>);
    const entries = await auditService.listForTarget(String(req.params.targetId), limit);
    res.json({ success: true, data: entries });
  }
}

export const adminController = new AdminController();
