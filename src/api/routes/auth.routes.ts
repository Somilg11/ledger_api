import { Router } from 'express';
import { body } from 'express-validator';
import {
  register,
  login,
  refresh,
  logout,
  me,
  changePassword,
  verifyEmail,
  resendVerification,
} from '../controllers/auth.controller';
import { validationMiddleware } from '../middlewares/validation.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authRateLimiter } from '../middlewares/redisRateLimit.middleware';
import { asyncHandler } from '../middlewares/asyncHandler';

const router = Router();

// isEmail()/isString() also stop object payloads such as {"$ne": null} from
// ever reaching a Mongo query.
const emailRule = body('email')
  .isString()
  .bail()
  .isEmail()
  .normalizeEmail()
  .withMessage('A valid email is required');
const passwordRule = body('password').isString().bail().isLength({ min: 10, max: 200 });

router.post(
  '/register',
  authRateLimiter,
  [
    emailRule,
    passwordRule,
    body('name').optional().isString().trim().isLength({ max: 120 }),
    body('phone').optional().isString().trim().isLength({ max: 20 }),
  ],
  validationMiddleware,
  asyncHandler(register)
);

router.post(
  '/login',
  authRateLimiter,
  [emailRule, body('password').isString().notEmpty()],
  validationMiddleware,
  asyncHandler(login)
);

router.post(
  '/refresh',
  authRateLimiter,
  [body('refreshToken').isString().notEmpty()],
  validationMiddleware,
  asyncHandler(refresh)
);

router.post(
  '/logout',
  authMiddleware(),
  [body('refreshToken').optional().isString(), body('allDevices').optional().isBoolean()],
  validationMiddleware,
  asyncHandler(logout)
);

router.get('/me', authMiddleware(), asyncHandler(me));

// Deliberately unauthenticated: the link is opened from a mail client, where
// the recipient is very likely not logged in. Possession of the single-use
// token is the proof.
router.post(
  '/verify-email',
  authRateLimiter,
  [body('token').isString().notEmpty().isLength({ max: 512 })],
  validationMiddleware,
  asyncHandler(verifyEmail)
);

router.post(
  '/resend-verification',
  authRateLimiter,
  [emailRule],
  validationMiddleware,
  asyncHandler(resendVerification)
);

router.post(
  '/change-password',
  authMiddleware(),
  [
    body('currentPassword').isString().notEmpty(),
    body('newPassword').isString().isLength({ min: 10, max: 200 }),
  ],
  validationMiddleware,
  asyncHandler(changePassword)
);

export default router;
