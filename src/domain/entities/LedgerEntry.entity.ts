export type EntryType = 'DEBIT' | 'CREDIT';

/**
 * One side of a double-entry pair. Entries are immutable once written: a
 * correction is a new reversing entry, never an edit.
 */
export interface LedgerEntry {
  id?: string;
  transactionId: string;
  accountId: string;
  entryType: EntryType;
  /** Minor units (paise/cents). Always a positive integer. */
  amount: number;
  currency: string;
  /** Balance immediately after this entry; negative on system contra accounts. */
  balanceAfter: number;
  metadata?: Record<string, unknown>;
}
