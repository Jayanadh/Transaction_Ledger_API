import { randomUUID } from 'node:crypto';
import { AccountNotFoundError } from '../errors.js';
import { fromMinorUnits } from '../money.js';
import { toAccount, type Account, type AccountBalance, type AccountRow } from './account.model.js';
import type { AccountRepository } from './account.repository.js';

export interface CreateAccountInput {
  name: string;
}

export class AccountService {
  constructor(private readonly accounts: AccountRepository) {}

  /** New accounts always start at 0; only ledger transactions change the balance. */
  createAccount(input: CreateAccountInput): Account {
    const account: AccountRow = {
      id: randomUUID(),
      name: input.name,
      balance: 0,
      created_at: new Date().toISOString(),
    };
    this.accounts.insert(account);
    return toAccount(account);
  }

  getAccount(accountId: string): Account {
    return toAccount(this.findOrThrow(accountId));
  }

  getBalance(accountId: string): AccountBalance {
    const account = this.findOrThrow(accountId);
    return { account_id: account.id, balance: fromMinorUnits(account.balance) };
  }

  private findOrThrow(accountId: string): AccountRow {
    const account = this.accounts.findById(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }
    return account;
  }
}
