import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';
import { validationMiddleware } from '../middlewares/validation.middleware';
import { requireAdmin } from '../middlewares/auth.middleware';
import { asyncHandler } from '../middlewares/asyncHandler';
import { objectIdParam, paginationQuery } from '../validators/common';

const router = Router();

// Everything here is staff-only.
router.use(requireAdmin);

router.get('/audit-logs', paginationQuery, validationMiddleware, asyncHandler(adminController.auditLogs));

router.get(
  '/audit-logs/:targetId',
  [objectIdParam('targetId'), ...paginationQuery],
  validationMiddleware,
  asyncHandler(adminController.auditForTarget)
);

export default router;
