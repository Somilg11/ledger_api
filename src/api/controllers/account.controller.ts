import { Response } from 'express';
import { accountService } from '../../shared/container';
import { AuthRequest, actorOf } from '../middlewares/auth.middleware';
import { parsePagination } from '../../shared/utils/pagination';

export class AccountController {
  async create(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const account = await accountService.createAccount(actor, {
      userId: req.body.userId,
      accountType: req.body.accountType,
      currency: req.body.currency,
    });
    res.status(201).json({ success: true, data: account });
  }

  /** Lists the caller's own accounts. */
  async listMine(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const { limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const accounts = await accountService.listAccounts(actor, actor.id, limit, skip);
    res.json({ success: true, data: accounts });
  }

  async getById(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const account = await accountService.getAccountById(actor, String(req.params.id));
    res.json({ success: true, data: account });
  }

  async getByUser(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const { limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const accounts = await accountService.listAccounts(actor, String(req.params.userId), limit, skip);
    res.json({ success: true, data: accounts });
  }

  async getBalance(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const balance = await accountService.getBalance(actor, String(req.params.id));
    res.json({ success: true, data: balance });
  }

  async updateMetadata(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const updated = await accountService.updateMetadata(
      actor,
      String(req.params.id),
      req.body.metadata ?? {}
    );
    res.json({ success: true, data: updated });
  }

  async freeze(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const updated = await accountService.updateStatus(actor, String(req.params.id), 'FROZEN');
    res.json({ success: true, data: updated });
  }

  async unfreeze(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const updated = await accountService.updateStatus(actor, String(req.params.id), 'ACTIVE');
    res.json({ success: true, data: updated });
  }

  async close(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const updated = await accountService.updateStatus(actor, String(req.params.id), 'CLOSED');
    res.json({ success: true, data: updated });
  }
}

export const accountController = new AccountController();
