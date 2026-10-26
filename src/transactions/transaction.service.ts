import { randomUUID } from 'node:crypto';
import type { Transaction as DbTransaction } from 'better-sqlite3';
import type { AccountRepository } from '../accounts/account.repository.js';
import type { Db } from '../db/database.js';
import {
  AccountNotFoundError,
  BalanceLimitExceededError,
  DuplicateTransactionError,
  InsufficientBalanceError,
  TransactionNotFoundError,
} from '../errors.js';
import { MAX_BALANCE_MINOR_UNITS, fromMinorUnits, toMinorUnits } from '../money.js';
import { toTransaction, type Transaction, type TransactionRow, type TransactionType } from './transaction.model.js';
import type { TransactionRepository } from './transaction.repository.js';

/** `amount` is in decimal units. */
export interface CreateTransactionInput {
  account_id: string;
  type: TransactionType;
  amount: number;
  reference_id: string;
  description: string | null;
}

export interface ListTransactionsQuery {
  type?: TransactionType;
  page: number;
  limit: number;
}

export interface Pagination {
  current_page: number;
  page_size: number;
  total_records: number;
  total_pages: number;
}

export interface TransactionPage {
  data: Transaction[];
  pagination: Pagination;
}

/** One entry to post to the ledger; `amount` is in minor units. */
export interface LedgerEntry {
  account_id: string;
  type: TransactionType;
  amount: number;
  reference_id: string;
  description: string | null;
  transfer_id: string | null;
  created_at: string;
}

export class TransactionService {
  private readonly postAtomically: DbTransaction<(entry: LedgerEntry) => TransactionRow>;

  constructor(
    private readonly db: Db,
    private readonly accounts: AccountRepository,
    private readonly transactions: TransactionRepository,
  ) {
    this.postAtomically = db.transaction((entry: LedgerEntry) => this.postEntry(entry));
  }

  createTransaction(input: CreateTransactionInput): Transaction {
    // IMMEDIATE takes the write lock up front, so the balance read inside postEntry
    // cannot go stale before the write (even with several processes on one database file).
    const row = this.postAtomically.immediate({
      ...input,
      amount: toMinorUnits(input.amount),
      transfer_id: null,
      created_at: new Date().toISOString(),
    });
    return toTransaction(row);
  }

  getTransaction(transactionId: string): Transaction {
    const row = this.transactions.findById(transactionId);
    if (!row) {
      throw new TransactionNotFoundError(transactionId);
    }
    return toTransaction(row);
  }

  /** Latest first, optionally filtered by type, one page at a time. */
  listTransactions(accountId: string, query: ListTransactionsQuery): TransactionPage {
    // One read transaction, so the total and the page come from the same snapshot.
    const readPage = this.db.transaction(() => {
      if (!this.accounts.findById(accountId)) {
        throw new AccountNotFoundError(accountId);
      }
      const total = this.transactions.countByAccount(accountId, query.type);
      const offset = (query.page - 1) * query.limit;
      const rows =
        offset < total ? this.transactions.listByAccount(accountId, { type: query.type, limit: query.limit, offset }) : [];
      return { rows, total };
    });

    const { rows, total } = readPage();
    return {
      data: rows.map(toTransaction),
      pagination: {
        current_page: query.page,
        page_size: query.limit,
        total_records: total,
        total_pages: Math.ceil(total / query.limit),
      },
    };
  }

  /**
   * Records one transaction and applies it to the account balance. Both writes
   * happen inside the caller's database transaction, so they commit or roll back together.
   */
  postEntry(entry: LedgerEntry): TransactionRow {
    if (!this.db.inTransaction) {
      throw new Error('postEntry must run inside a database transaction');
    }

    const account = this.accounts.findById(entry.account_id);
    if (!account) {
      throw new AccountNotFoundError(entry.account_id);
    }

    // Checked before the balance: a retried debit that already went through is a duplicate,
    // even if the balance could no longer cover it.
    const existing = this.transactions.findByReference(entry.account_id, entry.reference_id);
    if (existing) {
      throw new DuplicateTransactionError(toTransaction(existing));
    }

    const balanceAfter = entry.type === 'credit' ? account.balance + entry.amount : account.balance - entry.amount;
    if (balanceAfter < 0) {
      throw new InsufficientBalanceError(account.id, fromMinorUnits(account.balance), fromMinorUnits(entry.amount));
    }
    if (balanceAfter > MAX_BALANCE_MINOR_UNITS) {
      throw new BalanceLimitExceededError(account.id, fromMinorUnits(account.balance), fromMinorUnits(entry.amount));
    }

    const transaction: TransactionRow = {
      id: randomUUID(),
      account_id: entry.account_id,
      type: entry.type,
      amount: entry.amount,
      description: entry.description,
      reference_id: entry.reference_id,
      balance_after: balanceAfter,
      transfer_id: entry.transfer_id,
      created_at: entry.created_at,
    };
    this.transactions.insert(transaction);
    this.accounts.updateBalance(account.id, balanceAfter);
    return transaction;
  }
}
