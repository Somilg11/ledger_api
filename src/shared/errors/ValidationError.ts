import { AppError } from './AppError';

export class ValidationError extends AppError {
  constructor(message = 'Validation error', details?: any) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}
