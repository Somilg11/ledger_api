import { Router } from 'express';
import { body, param } from 'express-validator';
import { transactionController } from '../controllers/transaction.controller';
import { validationMiddleware } from '../middlewares/validation.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

router.post(
  '/',
  [
    body('fromAccount').notEmpty().withMessage('fromAccount is required'),
    body('toAccount').notEmpty().withMessage('toAccount is required'),
    body('amount').isNumeric().withMessage('amount must be numeric'),
  ],
  validationMiddleware,
  authMiddleware(),
  transactionController.create
);

router.get('/:id', [param('id').notEmpty()], transactionController.getById);

router.get('/account/:id', [param('id').notEmpty()], transactionController.listByAccount);

export default router;
