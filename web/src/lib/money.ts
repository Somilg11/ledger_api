/**
 * The API speaks in minor units (paise/cents) as integers, and rejects
 * decimals and numeric strings. Conversion happens here and nowhere else, so
 * no component is ever tempted to do float arithmetic on money.
 */

const SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export const CURRENCIES = Object.keys(SYMBOLS);

export function symbolFor(currency: string): string {
  return SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
}

/** 50000 → "₹500.00" */
export function formatMinor(minor: number, currency = 'INR'): string {
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const major = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  const grouped = major.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US');
  return `${negative ? '-' : ''}${symbolFor(currency)}${grouped}.${fraction}`;
}

/** 50000 → "500.00", for prefilling an input. */
export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

export interface ParsedAmount {
  minor: number | null;
  error: string | null;
}

/**
 * "500", "500.5", "1,200.75" → minor units.
 * Rejects anything with more than two decimal places rather than rounding it,
 * because silently dropping a paise is exactly the class of bug a ledger
 * exists to prevent.
 */
export function parseAmount(raw: string): ParsedAmount {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '') return { minor: null, error: 'Enter an amount' };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { minor: null, error: 'Use digits with up to two decimal places' };
  }

  const [whole, fraction = ''] = cleaned.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(minor)) return { minor: null, error: 'Amount is too large' };
  if (minor <= 0) return { minor: null, error: 'Amount must be greater than zero' };
  return { minor, error: null };
}
