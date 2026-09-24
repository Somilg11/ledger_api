import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValidAmount, assertSupportedCurrency } from '../../src/shared/utils/money';
import { ValidationError } from '../../src/shared/errors';

test('assertValidAmount accepts a positive integer of minor units', () => {
  assert.equal(assertValidAmount(1), 1);
  assert.equal(assertValidAmount(50_000), 50_000);
});

test('assertValidAmount rejects anything that is not a whole number', () => {
  // Decimals are the entire reason this system uses minor units.
  for (const bad of [10.5, 0.1, -0.0001]) {
    assert.throws(() => assertValidAmount(bad), ValidationError, `${bad} should be rejected`);
  }
});

test('assertValidAmount rejects numeric strings rather than coercing them', () => {
  // A client sending "1000" usually has a rounding bug somewhere upstream.
  assert.throws(() => assertValidAmount('1000' as unknown as number), ValidationError);
});

test('assertValidAmount rejects zero and negative amounts', () => {
  assert.throws(() => assertValidAmount(0), ValidationError);
  assert.throws(() => assertValidAmount(-1), ValidationError);
});

test('assertValidAmount rejects values that are not finite', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => assertValidAmount(bad), ValidationError);
  }
});

test('assertValidAmount rejects amounts beyond the configured ceiling', () => {
  assert.throws(() => assertValidAmount(Number.MAX_SAFE_INTEGER), ValidationError);
  assert.throws(() => assertValidAmount(1e18), ValidationError);
});

test('assertSupportedCurrency normalises case and trims', () => {
  assert.equal(assertSupportedCurrency('inr'), 'INR');
  assert.equal(assertSupportedCurrency('  usd  '), 'USD');
});

test('assertSupportedCurrency rejects unknown or malformed currencies', () => {
  assert.throws(() => assertSupportedCurrency('XYZ'), ValidationError);
  assert.throws(() => assertSupportedCurrency(123 as unknown as string), ValidationError);
});
