export class Account {
  id?: string;
  userId: string;
  accountNumber: string;
  accountType: 'SAVINGS' | 'CURRENT' | 'WALLET';
  currency: string;
  balance: number;
  availableBalance: number;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';

  constructor(params: {
    userId: string;
    accountNumber: string;
    accountType: 'SAVINGS' | 'CURRENT' | 'WALLET';
    currency?: string;
    balance?: number;
  }) {
    this.userId = params.userId;
    this.accountNumber = params.accountNumber;
    this.accountType = params.accountType;
    this.currency = params.currency ?? 'INR';
    this.balance = params.balance ?? 0;
    this.availableBalance = this.balance;
    this.status = 'ACTIVE';
  }
}
