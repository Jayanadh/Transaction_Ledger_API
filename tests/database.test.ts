import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database.js';

const NOW = '2026-01-01T00:00:00.000Z';

describe('database schema constraints', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
    const insertAccount = db.prepare('INSERT INTO accounts (id, name, created_at) VALUES (?, ?, ?)');
    insertAccount.run('acc-1', 'Alice', NOW);
    insertAccount.run('acc-2', 'Bob', NOW);
  });

  afterEach(() => db.close());

  function insertTransaction(overrides: Record<string, unknown> = {}) {
    db.prepare(
      `INSERT INTO transactions
         (id, account_id, type, amount, description, reference_id, balance_after, transfer_id, created_at)
       VALUES
         (@id, @account_id, @type, @amount, @description, @reference_id, @balance_after, @transfer_id, @created_at)`,
    ).run({
      id: randomUUID(),
      account_id: 'acc-1',
      type: 'credit',
      amount: 1000,
      description: null,
      reference_id: 'ref-1',
      balance_after: 1000,
      transfer_id: null,
      created_at: NOW,
      ...overrides,
    });
  }

  it('starts new accounts with a zero balance', () => {
    expect(db.prepare('SELECT balance FROM accounts WHERE id = ?').get('acc-1')).toEqual({ balance: 0 });
  });

  it('rejects a negative account balance', () => {
    expect(() => db.prepare('UPDATE accounts SET balance = -1 WHERE id = ?').run('acc-1')).toThrow(/CHECK/);
  });

  it('rejects a balance above the maximum', () => {
    expect(() =>
      db.prepare('UPDATE accounts SET balance = 1000000000000000 WHERE id = ?').run('acc-1'),
    ).toThrow(/CHECK/);
  });

  it('rejects a blank account name', () => {
    expect(() =>
      db.prepare('INSERT INTO accounts (id, name, created_at) VALUES (?, ?, ?)').run('acc-3', '   ', NOW),
    ).toThrow(/CHECK/);
  });

  it('rejects a non-positive transaction amount', () => {
    expect(() => insertTransaction({ amount: 0 })).toThrow(/CHECK/);
  });

  it('stores money as whole minor units only', () => {
    expect(() => insertTransaction({ amount: 10.5 })).toThrow(/cannot store REAL value in INTEGER column/);
  });

  it('rejects an unknown transaction type', () => {
    expect(() => insertTransaction({ type: 'refund' })).toThrow(/CHECK/);
  });

  it('rejects a duplicate reference_id for the same account', () => {
    insertTransaction();
    expect(() => insertTransaction()).toThrow(/UNIQUE/);
  });

  it('allows the same reference_id on different accounts', () => {
    insertTransaction();
    expect(() => insertTransaction({ account_id: 'acc-2' })).not.toThrow();
  });

  it('rejects a transaction for a missing account', () => {
    expect(() => insertTransaction({ account_id: 'missing' })).toThrow(/FOREIGN KEY/);
  });

  it('blocks updating a transaction', () => {
    insertTransaction();
    expect(() => db.prepare('UPDATE transactions SET amount = 1').run()).toThrow(/immutable/);
  });

  it('blocks deleting a transaction', () => {
    insertTransaction();
    expect(() => db.prepare('DELETE FROM transactions').run()).toThrow(/immutable/);
  });
});
