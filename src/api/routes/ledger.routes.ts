import { Router, Request, Response } from 'express';
import { param } from 'express-validator';
import { LedgerService } from '../../application/services/ledger.service';
import { validationMiddleware } from '../middlewares/validation.middleware';

const router = Router();
const ledgerService = new LedgerService();

router.get('/accounts/:accountId', [param('accountId').notEmpty()], validationMiddleware, async (req: Request, res: Response) => {
  try {
    const accountId = String(req.params.accountId || '');
    const { limit = 50, skip = 0 } = req.query;
    const entries = await ledgerService.getByAccount(accountId, Number(limit), Number(skip));
    res.json({ success: true, data: entries });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/transactions/:transactionId', [param('transactionId').notEmpty()], validationMiddleware, async (req: Request, res: Response) => {
  try {
    const transactionId = String(req.params.transactionId || '');
    const entries = await ledgerService.getByTransaction(transactionId);
    res.json({ success: true, data: entries });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
