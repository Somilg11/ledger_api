import rateLimit from 'express-rate-limit';
import { RequestHandler } from 'express';
import { config } from '../../shared/config/app.config';

export const apiRateLimiter: RequestHandler = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
});
