import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStrongPassword } from '../../src/shared/utils/password';
import { ValidationError } from '../../src/shared/errors';

test('assertStrongPassword accepts a password meeting every rule', () => {
  assert.equal(assertStrongPassword('Sup3rStrong!Pass'), 'Sup3rStrong!Pass');
});

test('assertStrongPassword requires length, both cases, a digit and a symbol', () => {
  const rejected = [
    'Sh0rt!', // too short
    'alllowercase1!', // no uppercase
    'ALLUPPERCASE1!', // no lowercase
    'NoDigitsHere!!', // no digit
    'NoSymbolsHere1', // no symbol
  ];

  for (const password of rejected) {
    assert.throws(() => assertStrongPassword(password), ValidationError, `${password} should be rejected`);
  }
});

test('assertStrongPassword rejects non-strings and absurd lengths', () => {
  assert.throws(() => assertStrongPassword(12345678 as unknown as string), ValidationError);
  assert.throws(() => assertStrongPassword(`A1!${'a'.repeat(500)}`), ValidationError);
});
