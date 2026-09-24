import { Router } from 'express';
import { body } from 'express-validator';
import { transactionController } from '../controllers/transaction.controller';
import { validationMiddleware } from '../middlewares/validation.middleware';
import { authMiddleware, requireAdmin } from '../middlewares/auth.middleware';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware';
import { transactionRateLimiter } from '../middlewares/redisRateLimit.middleware';
import { asyncHandler } from '../middlewares/asyncHandler';
import {
  objectIdParam,
  objectIdBody,
  amountBody,
  referenceBody,
  metadataBody,
  paginationQuery,
} from '../validators/common';

const router = Router();

// Authentication first, then the per-user money-movement budget, then replay
// protection - each layer needs the caller identity established by the one
// before it.
router.use(authMiddleware());
router.use(transactionRateLimiter);

router.post(
  '/',
  idempotencyMiddleware,
  [objectIdBody('fromAccount'), objectIdBody('toAccount'), amountBody, referenceBody, metadataBody],
  validationMiddleware,
  asyncHandler(transactionController.create)
);

router.post(
  '/deposit',
  idempotencyMiddleware,
  [objectIdBody('accountId'), amountBody, referenceBody, metadataBody],
  validationMiddleware,
  asyncHandler(transactionController.deposit)
);

router.post(
  '/withdraw',
  idempotencyMiddleware,
  [objectIdBody('accountId'), amountBody, referenceBody, metadataBody],
  validationMiddleware,
  asyncHandler(transactionController.withdraw)
);

// Holds: reserve now, settle or release later. See docs/about.md.
router.post(
  '/authorize',
  idempotencyMiddleware,
  [
    objectIdBody('fromAccount'),
    objectIdBody('toAccount'),
    amountBody,
    body('expiresInSeconds').optional().isInt({ min: 1, max: 2_592_000 }).toInt(),
    referenceBody,
    metadataBody,
  ],
  validationMiddleware,
  asyncHandler(transactionController.authorize)
);

router.post(
  '/:id/capture',
  [objectIdParam('id')],
  validationMiddleware,
  asyncHandler(transactionController.capture)
);

router.post(
  '/:id/void',
  [objectIdParam('id'), body('reason').optional().isString().isLength({ max: 280 })],
  validationMiddleware,
  asyncHandler(transactionController.voidHold)
);

router.get('/:id', [objectIdParam('id')], validationMiddleware, asyncHandler(transactionController.getById));

router.get(
  '/account/:id',
  [objectIdParam('id'), ...paginationQuery],
  validationMiddleware,
  asyncHandler(transactionController.listByAccount)
);

router.post(
  '/:id/reverse',
  requireAdmin,
  [objectIdParam('id'), body('reason').optional().isString().isLength({ max: 280 })],
  validationMiddleware,
  asyncHandler(transactionController.reverse)
);

export default router;
