import type { Statement } from 'better-sqlite3';
import type { Db } from '../db/database.js';
import type { AccountRow } from './account.model.js';

export class AccountRepository {
  private readonly insertStatement: Statement<AccountRow>;
  private readonly findByIdStatement: Statement<[string], AccountRow>;
  private readonly updateBalanceStatement: Statement<[number, string]>;

  constructor(db: Db) {
    this.insertStatement = db.prepare(
      'INSERT INTO accounts (id, name, balance, created_at) VALUES (@id, @name, @balance, @created_at)',
    );
    this.findByIdStatement = db.prepare('SELECT id, name, balance, created_at FROM accounts WHERE id = ?');
    this.updateBalanceStatement = db.prepare('UPDATE accounts SET balance = ? WHERE id = ?');
  }

  insert(account: AccountRow): void {
    this.insertStatement.run(account);
  }

  findById(id: string): AccountRow | undefined {
    return this.findByIdStatement.get(id);
  }

  /** `balance` is in minor units. */
  updateBalance(id: string, balance: number): void {
    this.updateBalanceStatement.run(balance, id);
  }
}
