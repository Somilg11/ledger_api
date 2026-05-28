import { AppError } from './AppError';

export class InsufficientFundsError extends AppError {
  constructor(message = 'Insufficient funds', details?: any) {
    super('INSUFFICIENT_FUNDS', message, 400, details);
  }
}
