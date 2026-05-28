import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './api/routes/auth.routes';
import accountRoutes from './api/routes/account.routes';
import { redisRateLimiter } from './api/middlewares/redisRateLimit.middleware';
import { idempotencyMiddleware } from './api/middlewares/idempotency.middleware';
import transactionRoutes from './api/routes/transaction.routes';
import ledgerRoutes from './api/routes/ledger.routes';

const app = express();

// Middlewares
app.use(helmet());
app.use(express.json());
app.use(morgan('combined'));

// Redis-backed rate limiting
app.use(redisRateLimiter);

// Idempotency for mutation requests
app.use(idempotencyMiddleware);

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/accounts', accountRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/ledger', ledgerRoutes);

// basic health
app.get('/health', (_req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));

export default app;
