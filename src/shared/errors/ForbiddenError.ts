import { AppError } from './AppError';

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions', details?: unknown) {
    super('FORBIDDEN', message, 403, details);
  }
}
