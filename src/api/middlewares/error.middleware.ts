import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../../shared/errors';
import { config } from '../../shared/config/app.config';
import { TracedRequest } from './requestId.middleware';

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

interface BodyParserError extends Error {
  status?: number;
  type?: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    err instanceof Error &&
    typeof (err as BodyParserError).type === 'string' &&
    typeof (err as BodyParserError).status === 'number'
  );
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: `Cannot ${req.method} ${req.originalUrl}` },
  } satisfies ErrorBody);
}

/**
 * Single exit point for every failure, so responses have one shape and
 * internal details never leak to clients.
 */
export function errorHandler(err: unknown, req: TracedRequest, res: Response, _next: NextFunction) {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request failed validation';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    code = 'INVALID_IDENTIFIER';
    message = `Invalid value for ${err.path}`;
  } else if ((err as { code?: number }).code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE_KEY';
    message = 'A record with these values already exists';
  } else if (isBodyParserError(err)) {
    // body-parser rejects oversized or malformed payloads before any route
    // runs; its errors carry their own status.
    statusCode = err.status ?? 400;
    code = err.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'MALFORMED_REQUEST_BODY';
    message =
      err.type === 'entity.too.large'
        ? 'Request body is too large'
        : 'Request body could not be parsed';
  }

  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(`[${req.id ?? '-'}] ${req.method} ${req.originalUrl}`, err);
  }

  const body: ErrorBody = {
    success: false,
    error: { code, message, requestId: req.id },
  };

  if (details !== undefined) body.error.details = details;
  // Stack traces are a development convenience only; in production they hand
  // an attacker a map of the codebase.
  if (!config.isProduction && statusCode >= 500 && err instanceof Error) {
    body.error.details = { stack: err.stack };
  }

  res.status(statusCode).json(body);
}
