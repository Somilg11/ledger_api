import express, { type Request, type Response } from 'express';

// Create and configure the Express application
const app = express();

// Basic middleware (example: JSON parsing)
app.use(express.json());

// Health/root route
app.get('/', (_req: Request, res: Response) => {
  res.send('Hello from ledger API (TypeScript)');
});

// Export the configured app; server startup lives in server.ts
export default app;
