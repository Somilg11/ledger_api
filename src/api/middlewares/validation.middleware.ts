import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { ValidationError } from '../../shared/errors';

/** Turns express-validator results into the API's single error shape. */
export function validationMiddleware(req: Request, _res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  return next(
    new ValidationError(
      'Request failed validation',
      errors.array().map((e) => ({
        field: 'path' in e ? e.path : undefined,
        message: e.msg,
      }))
    )
  );
}
