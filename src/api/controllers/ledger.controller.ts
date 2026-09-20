import { Response } from 'express';
import { ledgerService, accountService, transactionService } from '../../shared/container';
import { AuthRequest, actorOf } from '../middlewares/auth.middleware';
import { parsePagination } from '../../shared/utils/pagination';

export class LedgerController {
  /** Journal entries for one account - owner or admin only. */
  async byAccount(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const accountId = String(req.params.accountId);
    await accountService.getAuthorizedAccount(actor, accountId);

    const { limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const entries = await ledgerService.getByAccount(accountId, limit, skip);
    res.json({ success: true, data: entries, pagination: { limit, skip, count: entries.length } });
  }

  /** Both legs of one transaction - visible to its counterparties only. */
  async byTransaction(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const transactionId = String(req.params.transactionId);
    await transactionService.getById(actor, transactionId);

    const entries = await ledgerService.getByTransaction(transactionId);
    res.json({ success: true, data: entries });
  }

  /** Per-account reconciliation: cached balance vs the journal. */
  async reconcileAccount(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const balance = await accountService.getBalance(actor, String(req.params.accountId));
    res.json({ success: true, data: balance });
  }

  /** System-wide double-entry invariant. Admin only. */
  async verify(_req: AuthRequest, res: Response) {
    const result = await ledgerService.verifyDoubleEntry();
    res.status(result.balanced ? 200 : 500).json({ success: result.balanced, data: result });
  }
}

export const ledgerController = new LedgerController();
