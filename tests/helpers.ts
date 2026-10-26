import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { toMinorUnits } from '../src/money.js';

export interface TestContext {
  app: Express;
  db: Db;
}

/** A well-formed UUID that no record uses. */
export const UNKNOWN_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A fresh app backed by its own in-memory database. */
export function createTestApp(): TestContext {
  const db = openDatabase(':memory:');
  return { app: createApp(db), db };
}

export async function createAccount(app: Express, name = 'Alice') {
  const res = await request(app).post('/accounts').send({ name });
  if (res.status !== 201) {
    throw new Error(`createAccount failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string; name: string; balance: number; created_at: string };
}

export function postTransaction(app: Express, body: Record<string, unknown>) {
  return request(app).post('/transactions').send(body);
}

export function credit(app: Express, accountId: string, amount: number, referenceId: string = randomUUID()) {
  return postTransaction(app, { account_id: accountId, type: 'credit', amount, reference_id: referenceId });
}

export function debit(app: Express, accountId: string, amount: number, referenceId: string = randomUUID()) {
  return postTransaction(app, { account_id: accountId, type: 'debit', amount, reference_id: referenceId });
}

export async function balanceOf(app: Express, accountId: string): Promise<number> {
  const res = await request(app).get(`/accounts/${accountId}/balance`);
  return res.body.data.balance;
}

/** Sets a balance straight in the database (decimal units), e.g. to start an account near the maximum. */
export function setBalanceDirectly(db: Db, accountId: string, balance: number): void {
  db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(toMinorUnits(balance), accountId);
}

/** Counts stored transactions straight from the database, bypassing the API. */
export function countTransactions(db: Db, accountId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?').get(accountId) as {
    count: number;
  };
  return row.count;
}
