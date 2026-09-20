import { config } from '../config/app.config';
import { ValidationError } from '../errors';

/**
 * All monetary values in this system are integers in the smallest currency
 * unit (paise for INR, cents for USD). Floats are never used for money:
 * 0.1 + 0.2 !== 0.3 in IEEE-754, and a ledger that cannot balance is useless.
 */
export function assertValidAmount(amount: unknown): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new ValidationError('amount must be a finite number of minor units (e.g. paise)');
  }
  if (!Number.isInteger(amount)) {
    throw new ValidationError('amount must be an integer number of minor units (no decimals)');
  }
  if (amount <= 0) {
    throw new ValidationError('amount must be greater than zero');
  }
  if (amount > config.limits.maxTransferMinorUnits) {
    throw new ValidationError(`amount exceeds the maximum of ${config.limits.maxTransferMinorUnits} minor units`);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new ValidationError('amount is not a safe integer');
  }
  return amount;
}

export function assertSupportedCurrency(currency: unknown): string {
  if (typeof currency !== 'string') {
    throw new ValidationError('currency must be a string');
  }
  const normalized = currency.trim().toUpperCase();
  if (!config.supportedCurrencies.includes(normalized)) {
    throw new ValidationError(`currency must be one of: ${config.supportedCurrencies.join(', ')}`);
  }
  return normalized;
}

/** Formats minor units for display only. Never feed this back into arithmetic. */
export function formatMinorUnits(amount: number, currency = 'INR'): string {
  return `${(amount / 100).toFixed(2)} ${currency}`;
}
