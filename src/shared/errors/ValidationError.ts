import { AppError } from './AppError';

export class ValidationError extends AppError {
  constructor(message = 'Validation error', details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}
