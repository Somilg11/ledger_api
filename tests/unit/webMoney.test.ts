import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatMinor, minorToInput } from '../../web/src/lib/money';

/**
 * The console converts what a human types into the integer minor units the API
 * demands. Everything below is a way that conversion could silently lose or
 * invent money.
 */

test('parseAmount converts plain rupee input to minor units', () => {
  assert.deepEqual(parseAmount('500'), { minor: 50_000, error: null });
  assert.deepEqual(parseAmount('500.00'), { minor: 50_000, error: null });
  assert.deepEqual(parseAmount('0.01'), { minor: 1, error: null });
});

test('parseAmount pads a single decimal place correctly', () => {
  // "0.5" is fifty paise, not five. Getting this wrong loses money by 10x.
  assert.deepEqual(parseAmount('0.5'), { minor: 50, error: null });
  assert.deepEqual(parseAmount('1.5'), { minor: 150, error: null });
});

test('parseAmount strips thousands separators', () => {
  assert.deepEqual(parseAmount('1,200.75'), { minor: 120_075, error: null });
});

test('parseAmount rejects more precision than a currency has', () => {
  // Rounding here would quietly discard a fraction of a paise on every call.
  assert.equal(parseAmount('1.234').minor, null);
  assert.ok(parseAmount('1.234').error);
});

test('parseAmount rejects empty, zero, negative and non-numeric input', () => {
  for (const bad of ['', '   ', '0', '0.00', '-5', 'abc', '1e5', '1.2.3']) {
    assert.equal(parseAmount(bad).minor, null, `${JSON.stringify(bad)} should be rejected`);
  }
});

test('parseAmount rejects an amount too large to be a safe integer', () => {
  assert.equal(parseAmount('999999999999999999999').minor, null);
});

test('parseAmount and formatMinor round-trip without drift', () => {
  // The classic float failure: 0.1 + 0.2 !== 0.3. Integers must survive it.
  for (const input of ['0.01', '0.10', '0.20', '0.30', '123.45', '99999.99']) {
    const { minor } = parseAmount(input);
    assert.ok(minor !== null);
    assert.equal(minorToInput(minor!), Number(input).toFixed(2));
  }
});

test('formatMinor never produces floating-point noise', () => {
  assert.equal(formatMinor(10, 'INR'), '₹0.10');
  assert.equal(formatMinor(20, 'INR'), '₹0.20');
  assert.equal(formatMinor(30, 'INR'), '₹0.30');
});
