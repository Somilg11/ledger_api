import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface TracedRequest extends Request {
  id?: string;
}

/** Tags every request so a log line can be traced back to a client report. */
export function requestId(req: TracedRequest, res: Response, next: NextFunction) {
  const incoming = req.header('X-Request-Id');
  // Client-supplied ids are accepted but bounded and sanitised - they end up
  // in logs and response headers.
  const id = incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
