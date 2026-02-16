import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './api/routes/auth.routes';
import { redisRateLimiter } from './api/middlewares/redisRateLimit.middleware';
import { idempotencyMiddleware } from './api/middlewares/idempotency.middleware';

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

// basic health
app.get('/health', (_req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));

export default app;
