import { Router } from 'express';
import { body } from 'express-validator';
import { register, login } from '../controllers/auth.controller';
import { validationMiddleware } from '../middlewares/validation.middleware';

const router = Router();

router.post(
  '/register',
  [body('email').isEmail(), body('password').isLength({ min: 8 })],
  validationMiddleware,
  register
);

router.post('/login', [body('email').isEmail(), body('password').exists()], validationMiddleware, login);

export default router;
