export type AccountType = 'SAVINGS' | 'CURRENT' | 'WALLET';
export type AccountStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface Account {
  id?: string;
  userId?: string;
  accountNumber: string;
  accountType: AccountType;
  currency: string;
  /** Minor units (paise/cents). Always an integer. */
  balance: number;
  /** Balance minus holds; debits are checked against this. */
  availableBalance: number;
  status: AccountStatus;
  /** System (contra) accounts hold the bank's side of deposits and withdrawals. */
  isSystem: boolean;
  metadata?: Record<string, unknown>;
}
