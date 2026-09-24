import { Response } from 'express';
import { transactionService } from '../../shared/container';
import { AuthRequest, actorOf } from '../middlewares/auth.middleware';
import { parsePagination } from '../../shared/utils/pagination';

function idempotencyKeyOf(req: AuthRequest): string | undefined {
  const header = req.header('X-Idempotency-Key');
  return header || undefined;
}

export class TransactionController {
  async create(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const txn = await transactionService.createTransfer(actor, {
      fromAccountId: String(req.body.fromAccount),
      toAccountId: String(req.body.toAccount),
      amount: req.body.amount,
      idempotencyKey: idempotencyKeyOf(req),
      reference: req.body.reference,
      metadata: req.body.metadata,
    });
    res.status(201).json({ success: true, data: txn });
  }

  async deposit(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const txn = await transactionService.deposit(actor, {
      accountId: String(req.body.accountId),
      amount: req.body.amount,
      idempotencyKey: idempotencyKeyOf(req),
      reference: req.body.reference,
      metadata: req.body.metadata,
    });
    res.status(201).json({ success: true, data: txn });
  }

  async withdraw(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const txn = await transactionService.withdraw(actor, {
      accountId: String(req.body.accountId),
      amount: req.body.amount,
      idempotencyKey: idempotencyKeyOf(req),
      reference: req.body.reference,
      metadata: req.body.metadata,
    });
    res.status(201).json({ success: true, data: txn });
  }

  async authorize(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const txn = await transactionService.authorize(actor, {
      fromAccountId: String(req.body.fromAccount),
      toAccountId: String(req.body.toAccount),
      amount: req.body.amount,
      expiresInSeconds: req.body.expiresInSeconds,
      idempotencyKey: idempotencyKeyOf(req),
      reference: req.body.reference,
      metadata: req.body.metadata,
    });
    res.status(201).json({ success: true, data: txn });
  }

  async capture(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const txn = await transactionService.capture(actor, String(req.params.id));
    res.status(200).json({ success: true, data: txn });
  }

  async voidHold(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const txn = await transactionService.voidHold(actor, String(req.params.id), req.body?.reason);
    res.status(200).json({ success: true, data: txn });
  }

  async getById(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const txn = await transactionService.getById(actor, String(req.params.id));
    res.json({ success: true, data: txn });
  }

  async listByAccount(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const { limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const txns = await transactionService.listByAccount(actor, String(req.params.id), limit, skip);
    res.json({ success: true, data: txns, pagination: { limit, skip, count: txns.length } });
  }

  async reverse(req: AuthRequest, res: Response) {
    const actor = actorOf(req);
    const txn = await transactionService.reverse(actor, String(req.params.id), req.body?.reason);
    res.status(201).json({ success: true, data: txn });
  }
}

export const transactionController = new TransactionController();
