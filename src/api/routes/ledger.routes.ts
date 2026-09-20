import { Router } from 'express';
import { ledgerController } from '../controllers/ledger.controller';
import { validationMiddleware } from '../middlewares/validation.middleware';
import { authMiddleware, requireAdmin } from '../middlewares/auth.middleware';
import { asyncHandler } from '../middlewares/asyncHandler';
import { objectIdParam, paginationQuery } from '../validators/common';

const router = Router();

// The ledger is the most sensitive read surface in the system - it is a
// complete financial history. Nothing here is public.
router.use(authMiddleware());

router.get(
  '/accounts/:accountId',
  [objectIdParam('accountId'), ...paginationQuery],
  validationMiddleware,
  asyncHandler(ledgerController.byAccount)
);

router.get(
  '/accounts/:accountId/reconcile',
  [objectIdParam('accountId')],
  validationMiddleware,
  asyncHandler(ledgerController.reconcileAccount)
);

router.get(
  '/transactions/:transactionId',
  [objectIdParam('transactionId')],
  validationMiddleware,
  asyncHandler(ledgerController.byTransaction)
);

router.get('/verify', requireAdmin, asyncHandler(ledgerController.verify));

export default router;
