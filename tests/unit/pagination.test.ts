import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePagination } from '../../src/shared/utils/pagination';

test('parsePagination falls back to sane defaults', () => {
  assert.deepEqual(parsePagination({}), { limit: 50, skip: 0 });
});

test('parsePagination clamps an unbounded limit', () => {
  // Without this, one request could ask the database for everything.
  const { limit } = parsePagination({ limit: 1_000_000 });
  assert.ok(limit <= 100, `expected a clamped limit, got ${limit}`);
});

test('parsePagination ignores junk instead of producing NaN', () => {
  assert.deepEqual(parsePagination({ limit: 'abc', skip: 'xyz' }), { limit: 50, skip: 0 });
  assert.deepEqual(parsePagination({ limit: -5, skip: -5 }), { limit: 50, skip: 0 });
});

test('parsePagination floors fractional input', () => {
  assert.deepEqual(parsePagination({ limit: 10.9, skip: 3.7 }), { limit: 10, skip: 3 });
});
