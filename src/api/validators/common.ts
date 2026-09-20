import { body, param, query } from 'express-validator';
import { config } from '../../shared/config/app.config';

/**
 * Mongo ids must be validated at the edge: an unchecked object here is how
 * NoSQL operator injection (`{"$ne": null}`) gets into a query.
 */
export const objectIdParam = (name: string) =>
  param(name).isString().bail().isMongoId().withMessage(`${name} must be a valid id`);

export const objectIdBody = (name: string) =>
  body(name).isString().bail().isMongoId().withMessage(`${name} must be a valid id`);

/**
 * Money is always an integer count of minor units, sent as a JSON number.
 * A numeric *string* is rejected on purpose: silently coercing "1000" hides
 * client bugs that would otherwise surface as a rounding or precision error.
 */
export const amountBody = body('amount')
  .custom((value) => typeof value === 'number' && Number.isInteger(value))
  .withMessage('amount must be a JSON integer, not a string or decimal')
  .bail()
  .isInt({ min: 1, max: config.limits.maxTransferMinorUnits })
  .withMessage(`amount must be between 1 and ${config.limits.maxTransferMinorUnits} minor units`);

export const referenceBody = body('reference')
  .optional()
  .isString()
  .isLength({ max: 140 })
  .withMessage('reference must be at most 140 characters')
  .trim();

export const metadataBody = body('metadata')
  .optional()
  .isObject()
  .withMessage('metadata must be an object');

export const paginationQuery = [
  query('limit').optional().isInt({ min: 1, max: config.limits.maxPageSize }).toInt(),
  query('skip').optional().isInt({ min: 0 }).toInt(),
];
