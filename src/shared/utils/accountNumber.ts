import crypto from 'crypto';

/**
 * Generates a 16-digit account number from a cryptographic RNG.
 * Callers retry on the unique-index collision rather than pre-checking, which
 * keeps generation race-free.
 */
export function generateAccountNumber(): string {
  let digits = '';
  while (digits.length < 16) {
    digits += crypto.randomInt(0, 1_000_000_000).toString().padStart(9, '0');
  }
  return digits.slice(0, 16);
}
