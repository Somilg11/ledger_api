import { AppError } from './AppError';

export class InsufficientFundsError extends AppError {
  constructor(message = 'Insufficient funds', details?: unknown) {
    super('INSUFFICIENT_FUNDS', message, 400, details);
  }
}
