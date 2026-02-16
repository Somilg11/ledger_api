export class Transaction {
  id?: string;
  fromAccount?: string;
  toAccount?: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  type: 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL';
  reference?: string;
  metadata?: Record<string, unknown>;

  constructor(params: {
    amount: number;
    type: 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL';
    fromAccount?: string;
    toAccount?: string;
    currency?: string;
    reference?: string;
    metadata?: Record<string, unknown>;
  }) {
    this.amount = params.amount;
    this.type = params.type;
    this.fromAccount = params.fromAccount;
    this.toAccount = params.toAccount;
    this.currency = params.currency ?? 'INR';
    this.reference = params.reference;
    this.metadata = params.metadata;
    this.status = 'PENDING';
  }
}
