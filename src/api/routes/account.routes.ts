import { Router } from 'express';
import { body } from 'express-validator';
import { accountController } from '../controllers/account.controller';
import { validationMiddleware } from '../middlewares/validation.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware';
import { asyncHandler } from '../middlewares/asyncHandler';
import { objectIdParam, paginationQuery, metadataBody } from '../validators/common';

const router = Router();

// Every account route requires a verified caller; ownership is then enforced
// inside AccountService.
router.use(authMiddleware());

router.post(
  '/',
  idempotencyMiddleware,
  [
    body('accountType').isString().isIn(['SAVINGS', 'CURRENT', 'WALLET']),
    body('currency').optional().isString().isLength({ min: 3, max: 3 }),
    body('userId').optional().isMongoId(),
  ],
  validationMiddleware,
  asyncHandler(accountController.create)
);

router.get('/', paginationQuery, validationMiddleware, asyncHandler(accountController.listMine));

router.get('/:id', [objectIdParam('id')], validationMiddleware, asyncHandler(accountController.getById));

router.get('/:id/balance', [objectIdParam('id')], validationMiddleware, asyncHandler(accountController.getBalance));

router.get(
  '/user/:userId',
  [objectIdParam('userId'), ...paginationQuery],
  validationMiddleware,
  asyncHandler(accountController.getByUser)
);

router.patch(
  '/:id',
  [objectIdParam('id'), metadataBody],
  validationMiddleware,
  asyncHandler(accountController.updateMetadata)
);

router.post('/:id/freeze', [objectIdParam('id')], validationMiddleware, asyncHandler(accountController.freeze));

router.post('/:id/unfreeze', [objectIdParam('id')], validationMiddleware, asyncHandler(accountController.unfreeze));

router.delete('/:id', [objectIdParam('id')], validationMiddleware, asyncHandler(accountController.close));

export default router;
