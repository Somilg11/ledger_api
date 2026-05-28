import { Request, Response } from 'express';
import { TransactionService } from '../../application/services/transaction.service';
import { TransactionModel } from '../../infrastructure/database/mongodb/models/transaction.model';
import { AccountModel } from '../../infrastructure/database/mongodb/models/account.model';
import { AuthRequest } from '../middlewares/auth.middleware';
import { AppError } from '../../shared/errors/AppError';

const service = new TransactionService();

export class TransactionController {
  async create(req: AuthRequest, res: Response) {
    try {
      const { fromAccount, toAccount, amount, currency, reference, metadata } = req.body;
      const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;

      // Authorization: only account owner or admin can initiate
      const fromAcc = await AccountModel.findById(String(fromAccount)).exec();
      if (!fromAcc) return res.status(404).json({ success: false, error: 'From account not found' });
      const ownerId = String((fromAcc as any).userId);
      const requester = req.user?.sub;
      const roles = req.user?.roles || [];
      if (requester !== ownerId && !roles.includes('admin')) {
        return res.status(403).json({ success: false, error: 'Insufficient permissions' });
      }
      const txn = await service.createTransfer({
        fromAccountId: String(fromAccount),
        toAccountId: String(toAccount),
        amount: Number(amount),
        currency,
        idempotencyKey,
        reference,
        metadata,
      });
      res.status(201).json({ success: true, data: txn });
    } catch (error: any) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      }
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const id = String(req.params.id || '');
  const txn = await TransactionModel.findById(id).exec();
      if (!txn) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: txn });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async listByAccount(req: Request, res: Response) {
    try {
      const accountId = String(req.params.id || '');
      const { limit = 50, skip = 0 } = req.query;
      const txns = await TransactionModel.find({
        $or: [{ fromAccount: accountId }, { toAccount: accountId }],
      })
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip(Number(skip))
        .exec();
      res.json({ success: true, data: txns });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
}

export const transactionController = new TransactionController();
