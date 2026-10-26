import type { Statement } from 'better-sqlite3';
import type { Db } from '../db/database.js';
import type { TransactionRow, TransactionType } from './transaction.model.js';

const COLUMNS = 'id, account_id, type, amount, description, reference_id, balance_after, transfer_id, created_at';

/** `type: null` matches both credits and debits. */
interface AccountFilter {
  account_id: string;
  type: TransactionType | null;
}

/** Transactions are append-only, so there is deliberately no update or delete here. */
export class TransactionRepository {
  private readonly insertStatement: Statement<TransactionRow>;
  private readonly findByIdStatement: Statement<[string], TransactionRow>;
  private readonly findByReferenceStatement: Statement<[string, string], TransactionRow>;
  private readonly listByAccountStatement: Statement<AccountFilter & { limit: number; offset: number }, TransactionRow>;
  private readonly countByAccountStatement: Statement<AccountFilter, { total: number }>;

  constructor(db: Db) {
    this.insertStatement = db.prepare(
      `INSERT INTO transactions (${COLUMNS})
       VALUES (@id, @account_id, @type, @amount, @description, @reference_id, @balance_after, @transfer_id, @created_at)`,
    );
    this.findByIdStatement = db.prepare(`SELECT ${COLUMNS} FROM transactions WHERE id = ?`);
    this.findByReferenceStatement = db.prepare(
      `SELECT ${COLUMNS} FROM transactions WHERE account_id = ? AND reference_id = ?`,
    );
    // Latest first; rowid (insertion order) breaks ties between rows created in the same millisecond.
    this.listByAccountStatement = db.prepare(
      `SELECT ${COLUMNS} FROM transactions
       WHERE account_id = @account_id AND (@type IS NULL OR type = @type)
       ORDER BY created_at DESC, rowid DESC
       LIMIT @limit OFFSET @offset`,
    );
    this.countByAccountStatement = db.prepare(
      `SELECT COUNT(*) AS total FROM transactions
       WHERE account_id = @account_id AND (@type IS NULL OR type = @type)`,
    );
  }

  insert(transaction: TransactionRow): void {
    this.insertStatement.run(transaction);
  }

  findById(id: string): TransactionRow | undefined {
    return this.findByIdStatement.get(id);
  }

  findByReference(accountId: string, referenceId: string): TransactionRow | undefined {
    return this.findByReferenceStatement.get(accountId, referenceId);
  }

  listByAccount(
    accountId: string,
    options: { type?: TransactionType; limit: number; offset: number },
  ): TransactionRow[] {
    return this.listByAccountStatement.all({
      account_id: accountId,
      type: options.type ?? null,
      limit: options.limit,
      offset: options.offset,
    });
  }

  countByAccount(accountId: string, type?: TransactionType): number {
    return this.countByAccountStatement.get({ account_id: accountId, type: type ?? null })?.total ?? 0;
  }
}
