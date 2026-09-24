import { ValidationError } from '../errors';

/**
 * Password policy.
 *
 * Kept as a pure module rather than a method on AuthService: the rules are
 * domain logic with no dependencies, and importing a service to check a string
 * would drag a Redis connection along with it.
 */
const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 10, message: 'at least 10 characters' },
  { test: (p: string) => /[a-z]/.test(p), message: 'a lowercase letter' },
  { test: (p: string) => /[A-Z]/.test(p), message: 'an uppercase letter' },
  { test: (p: string) => /[0-9]/.test(p), message: 'a digit' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), message: 'a symbol' },
];

/** A password that survives an offline crack attempt for more than a weekend. */
export function assertStrongPassword(password: unknown): string {
  if (typeof password !== 'string') throw new ValidationError('password must be a string');
  if (password.length > 200) throw new ValidationError('password must be at most 200 characters');

  const missing = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.message);
  if (missing.length > 0) {
    throw new ValidationError(`password must contain ${missing.join(', ')}`);
  }

  return password;
}
