import { UserRepository } from '../infrastructure/database/mongodb/repositories/user.repository';
import { AccountRepository } from '../infrastructure/database/mongodb/repositories/account.repository';
import { LedgerRepository } from '../infrastructure/database/mongodb/repositories/ledger.repository';
import { AuthService } from '../application/services/auth.service';
import { AccountService } from '../application/services/account.service';
import { LedgerService } from '../application/services/ledger.service';
import { TransactionService } from '../application/services/transaction.service';

/**
 * Single place where concrete implementations are wired together, so a test
 * or a future DI container only has to swap them here.
 */
const userRepository = new UserRepository();
const accountRepository = new AccountRepository();
const ledgerRepository = new LedgerRepository();

export const authService = new AuthService(userRepository);
export const ledgerService = new LedgerService(ledgerRepository);
export const accountService = new AccountService(accountRepository, ledgerRepository);
export const transactionService = new TransactionService(ledgerService, accountService);
