import { Router } from 'express';
import { body, param } from 'express-validator';
import { accountController } from '../controllers/account.controller';
import { validationMiddleware } from '../middlewares/validation.middleware';

const router = Router();

router.post(
  '/',
  [
    body('userId').notEmpty().withMessage('userId is required'),
    body('accountType').notEmpty().withMessage('accountType is required'),
    body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('ISO currency code required'),
  ],
  validationMiddleware,
  accountController.create
);

router.get('/:id', [param('id').notEmpty()], accountController.getById);

router.get('/user/:userId', [param('userId').notEmpty()], accountController.getByUser);

router.put('/:id', [param('id').notEmpty()], validationMiddleware, accountController.update);

router.delete('/:id', [param('id').notEmpty()], accountController.close);

export default router;
