import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerService } from '../../src/application/services/ledger.service';
import { ValidationError } from '../../src/shared/errors';

/** Stands in for the repository so nothing touches a database. */
function fakeRepo() {
  const written: unknown[][] = [];
  return {
    written,
    repo: {
      createMany: async (entries: unknown[]) => {
        written.push(entries);
        return entries;
      },
    },
  };
}

test('recordEntries writes a balanced debit and credit pair', async () => {
  const { repo, written } = fakeRepo();
  const ledger = new LedgerService(repo as never);

  await ledger.recordEntries([
    { entryType: 'DEBIT', amount: 5000 },
    { entryType: 'CREDIT', amount: 5000 },
  ] as never);

  assert.equal(written.length, 1);
  assert.equal(written[0].length, 2);
});

test('recordEntries refuses an unbalanced pair', async () => {
  // This is the invariant the whole system rests on: an unbalanced write must
  // never reach the journal, because a journal that does not balance cannot be
  // used to detect anything.
  const { repo, written } = fakeRepo();
  const ledger = new LedgerService(repo as never);

  await assert.rejects(
    () =>
      ledger.recordEntries([
        { entryType: 'DEBIT', amount: 5000 },
        { entryType: 'CREDIT', amount: 4999 },
      ] as never),
    ValidationError
  );

  assert.equal(written.length, 0, 'nothing should have been written');
});

test('recordEntries refuses a one-sided entry', async () => {
  const { repo } = fakeRepo();
  const ledger = new LedgerService(repo as never);

  await assert.rejects(
    () => ledger.recordEntries([{ entryType: 'DEBIT', amount: 5000 }] as never),
    ValidationError
  );
});

test('recordEntries accepts a balanced multi-leg entry', async () => {
  // Splitting one side across several accounts is still balanced.
  const { repo, written } = fakeRepo();
  const ledger = new LedgerService(repo as never);

  await ledger.recordEntries([
    { entryType: 'DEBIT', amount: 3000 },
    { entryType: 'DEBIT', amount: 2000 },
    { entryType: 'CREDIT', amount: 5000 },
  ] as never);

  assert.equal(written.length, 1);
});
