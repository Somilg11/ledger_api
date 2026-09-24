import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * pino-http augments Express's Request with `id`, so this middleware only has
 * to populate it before the logger runs.
 */
export type TracedRequest = Request;

/** Tags every request so a log line can be traced back to a client report. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('X-Request-Id');
  // Client-supplied ids are accepted but bounded and sanitised - they end up
  // in logs and response headers.
  const id = incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/** Narrows the logger's `ReqId` union back to something printable. */
export function idOf(req: Request): string {
  return typeof req.id === 'string' || typeof req.id === 'number' ? String(req.id) : '-';
}
