export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REVERSED';
export type TransactionType = 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL';

export interface Transaction {
  id?: string;
  fromAccount?: string;
  toAccount?: string;
  /** Minor units (paise/cents). Always an integer. */
  amount: number;
  currency: string;
  status: TransactionStatus;
  type: TransactionType;
  initiatedBy?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  /** Set on a hold: after this the reservation can no longer be captured. */
  expiresAt?: Date;
  completedAt?: Date;
}
