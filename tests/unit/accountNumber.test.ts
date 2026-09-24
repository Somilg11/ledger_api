import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAccountNumber } from '../../src/shared/utils/accountNumber';

test('generateAccountNumber returns exactly sixteen digits', () => {
  for (let i = 0; i < 100; i += 1) {
    assert.match(generateAccountNumber(), /^\d{16}$/);
  }
});

test('generateAccountNumber does not collide across a large sample', () => {
  // Collisions are ultimately caught by a unique index, but a generator that
  // produced them often would turn every account opening into a retry loop.
  const seen = new Set<string>();
  for (let i = 0; i < 20_000; i += 1) seen.add(generateAccountNumber());
  assert.equal(seen.size, 20_000);
});
