import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';

import { config } from './shared/config/app.config';
import { getRedisClient } from './infrastructure/cache/redis.client';
import { requestId } from './api/middlewares/requestId.middleware';
import { redisRateLimiter } from './api/middlewares/redisRateLimit.middleware';
import { errorHandler, notFoundHandler } from './api/middlewares/error.middleware';

import authRoutes from './api/routes/auth.routes';
import accountRoutes from './api/routes/account.routes';
import transactionRoutes from './api/routes/transaction.routes';
import ledgerRoutes from './api/routes/ledger.routes';

const app = express();

// Without this, req.ip behind a proxy is the proxy's address, which would make
// every per-IP rate limit share a single bucket - and an X-Forwarded-For header
// spoofable when it is enabled blindly. Configure the exact hop count instead.
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

app.use(helmet());
app.use(
  cors({
    // An empty allow-list means same-origin only, which is the safe default
    // for an API that authenticates with bearer tokens.
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'X-Idempotent-Replay', 'RateLimit-Remaining', 'Retry-After'],
    maxAge: 600,
  })
);

// A hard body cap keeps a single request from exhausting memory.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(requestId);
morgan.token('id', (req) => (req as { id?: string }).id ?? '-');
app.use(morgan(':id :method :url :status :response-time ms', { skip: () => config.env === 'test' }));

app.use(redisRateLimiter);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/accounts', accountRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/ledger', ledgerRoutes);

/** Liveness: the process is up. */
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/** Readiness: dependencies are actually usable, so a load balancer can drain. */
app.get('/ready', async (_req, res) => {
  const checks = { mongodb: false, redis: false };

  checks.mongodb = mongoose.connection.readyState === 1;
  try {
    checks.redis = (await getRedisClient().ping()) === 'PONG';
  } catch {
    checks.redis = false;
  }

  const ready = Object.values(checks).every(Boolean);
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', checks });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
