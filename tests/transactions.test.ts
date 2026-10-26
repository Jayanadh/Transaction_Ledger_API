import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UNKNOWN_ID,
  UUID_PATTERN,
  balanceOf,
  countTransactions,
  createAccount,
  createTestApp,
  credit,
  debit,
  postTransaction,
  setBalanceDirectly,
  type TestContext,
} from './helpers.js';

describe('transactions', () => {
  let ctx: TestContext;
  let accountId: string;

  beforeEach(async () => {
    ctx = createTestApp();
    accountId = (await createAccount(ctx.app)).id;
  });

  afterEach(() => {
    ctx.db.close();
    vi.restoreAllMocks();
  });

  describe('POST /transactions', () => {
    it('credit increases the balance', async () => {
      await credit(ctx.app, accountId, 100);

      const res = await credit(ctx.app, accountId, 50);

      expect(res.status).toBe(201);
      expect(res.body.data.balance_after).toBe(150);
      expect(await balanceOf(ctx.app, accountId)).toBe(150);
    });

    it('debit decreases the balance', async () => {
      await credit(ctx.app, accountId, 100);

      const res = await debit(ctx.app, accountId, 30);

      expect(res.status).toBe(201);
      expect(res.body.data.balance_after).toBe(70);
      expect(await balanceOf(ctx.app, accountId)).toBe(70);
    });

    it('rejects a debit larger than the balance and leaves the balance unchanged', async () => {
      await credit(ctx.app, accountId, 100);

      const res = await debit(ctx.app, accountId, 150);

      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient balance: available 100, requested 150',
          details: { account_id: accountId, available_balance: 100, requested_amount: 150 },
        },
      });
      expect(await balanceOf(ctx.app, accountId)).toBe(100);
      expect(countTransactions(ctx.db, accountId)).toBe(1);
    });

    it('rejects a credit that would take the balance above the maximum', async () => {
      setBalanceDirectly(ctx.db, accountId, 9_999_999_999_999);

      const res = await credit(ctx.app, accountId, 1);

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: 'BALANCE_LIMIT_EXCEEDED',
        message: 'Balance limit exceeded: a balance cannot exceed 9999999999999.99',
        details: {
          account_id: accountId,
          current_balance: 9_999_999_999_999,
          requested_amount: 1,
          max_balance: 9_999_999_999_999.99,
        },
      });
      expect(await balanceOf(ctx.app, accountId)).toBe(9_999_999_999_999);
      expect(countTransactions(ctx.db, accountId)).toBe(0);
    });

    it('accepts a credit that brings the balance exactly to the maximum', async () => {
      setBalanceDirectly(ctx.db, accountId, 9_999_999_999_999);

      const res = await credit(ctx.app, accountId, 0.99);

      expect(res.status).toBe(201);
      expect(res.body.data.balance_after).toBe(9_999_999_999_999.99);
      expect(await balanceOf(ctx.app, accountId)).toBe(9_999_999_999_999.99);
    });

    it('keeps the balance equal to the result of all valid transactions', async () => {
      await credit(ctx.app, accountId, 100);
      await credit(ctx.app, accountId, 50);
      await debit(ctx.app, accountId, 30);
      expect((await debit(ctx.app, accountId, 500)).status).toBe(422);
      await debit(ctx.app, accountId, 20);

      expect(await balanceOf(ctx.app, accountId)).toBe(100);
      expect(countTransactions(ctx.db, accountId)).toBe(4);
    });

    it('returns every transaction field', async () => {
      const res = await postTransaction(ctx.app, {
        account_id: accountId,
        type: 'credit',
        amount: 25.5,
        description: 'Salary',
        reference_id: 'salary-2026-10',
      });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        id: expect.stringMatching(UUID_PATTERN),
        account_id: accountId,
        type: 'credit',
        amount: 25.5,
        description: 'Salary',
        reference_id: 'salary-2026-10',
        balance_after: 25.5,
        transfer_id: null,
        created_at: expect.any(String),
      });
      expect(new Date(res.body.data.created_at).toISOString()).toBe(res.body.data.created_at);
    });

    it('stores amounts without floating-point drift', async () => {
      await credit(ctx.app, accountId, 0.1);
      await credit(ctx.app, accountId, 0.2);

      expect(await balanceOf(ctx.app, accountId)).toBe(0.3);
    });

    it('rejects a duplicate reference_id for the same account without changing the balance', async () => {
      const first = await credit(ctx.app, accountId, 100, 'ref-1');

      const duplicate = await credit(ctx.app, accountId, 100, 'ref-1');

      expect(duplicate.status).toBe(409);
      expect(duplicate.body).toEqual({
        error: {
          code: 'DUPLICATE_TRANSACTION',
          message: `A transaction with reference_id 'ref-1' already exists for account ${accountId}`,
          details: { existing_transaction: first.body.data },
        },
      });
      expect(await balanceOf(ctx.app, accountId)).toBe(100);
      expect(countTransactions(ctx.db, accountId)).toBe(1);
    });

    it('treats a reused reference_id as a duplicate even when the payload differs', async () => {
      await credit(ctx.app, accountId, 100, 'ref-1');

      const res = await debit(ctx.app, accountId, 30, 'ref-1');

      expect(res.status).toBe(409);
      expect(await balanceOf(ctx.app, accountId)).toBe(100);
    });

    it('reports a duplicate before checking the balance', async () => {
      await credit(ctx.app, accountId, 100);
      expect((await debit(ctx.app, accountId, 100, 'rent-october')).status).toBe(201);

      const retry = await debit(ctx.app, accountId, 100, 'rent-october');

      expect(retry.status).toBe(409);
      expect(retry.body.error.code).toBe('DUPLICATE_TRANSACTION');
    });

    it('allows the same reference_id on different accounts', async () => {
      const other = await createAccount(ctx.app, 'Bob');

      expect((await credit(ctx.app, accountId, 100, 'shared-ref')).status).toBe(201);
      expect((await credit(ctx.app, other.id, 100, 'shared-ref')).status).toBe(201);
    });

    it('returns 404 for an unknown account_id', async () => {
      const res = await credit(ctx.app, UNKNOWN_ID, 100);

      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({
        code: 'ACCOUNT_NOT_FOUND',
        message: `Account ${UNKNOWN_ID} not found`,
        details: { account_id: UNKNOWN_ID },
      });
    });

    it('returns 400 for a malformed account_id', async () => {
      const res = await credit(ctx.app, 'acc-1', 100);

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'account_id', message: 'account_id must be a valid UUID' }]);
    });

    it.each([
      ['account_id is missing', { account_id: undefined }, 'account_id', 'account_id is required'],
      ['type is missing', { type: undefined }, 'type', 'type is required'],
      ['type is not credit or debit', { type: 'refund' }, 'type', "type must be either 'credit' or 'debit'"],
      ['amount is missing', { amount: undefined }, 'amount', 'amount is required'],
      ['amount is zero', { amount: 0 }, 'amount', 'amount must be greater than 0'],
      ['amount is negative', { amount: -5 }, 'amount', 'amount must be greater than 0'],
      ['amount is a string', { amount: '50' }, 'amount', 'amount must be a number'],
      ['amount has three decimals', { amount: 10.123 }, 'amount', 'amount must have at most 2 decimal places'],
      ['amount is too large', { amount: 1e10 }, 'amount', 'amount must not exceed 1000000000'],
      ['reference_id is missing', { reference_id: undefined }, 'reference_id', 'reference_id is required'],
      ['reference_id is blank', { reference_id: '   ' }, 'reference_id', 'reference_id must not be empty'],
      ['description is not a string', { description: 42 }, 'description', 'description must be a string'],
      ['an unknown field is sent', { balance_after: 5 }, 'balance_after', 'balance_after is not an allowed field'],
    ])('rejects the request when %s', async (_case, override, field, message) => {
      const res = await postTransaction(ctx.app, {
        account_id: accountId,
        type: 'credit',
        amount: 10,
        reference_id: 'ref-validation',
        ...override,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: [{ field, message }],
      });
      expect(await balanceOf(ctx.app, accountId)).toBe(0);
    });
  });

  describe('GET /transactions/:transactionId', () => {
    it('returns the transaction', async () => {
      const created = (await credit(ctx.app, accountId, 100)).body.data;

      const res = await request(ctx.app).get(`/transactions/${created.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: created });
    });

    it('returns 404 for an unknown transaction', async () => {
      const res = await request(ctx.app).get(`/transactions/${UNKNOWN_ID}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({
        code: 'TRANSACTION_NOT_FOUND',
        message: `Transaction ${UNKNOWN_ID} not found`,
        details: { transaction_id: UNKNOWN_ID },
      });
    });

    it('returns 400 for a malformed transaction id', async () => {
      const res = await request(ctx.app).get('/transactions/42');

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'transaction_id', message: 'transaction_id must be a valid UUID' },
      ]);
    });
  });

  describe('immutability', () => {
    it.each(['put', 'patch', 'delete'] as const)('rejects %s on a transaction and leaves it unchanged', async (method) => {
      const created = (await credit(ctx.app, accountId, 100)).body.data;

      const res = await request(ctx.app)[method](`/transactions/${created.id}`).send({ amount: 1 });

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
      expect(res.body).toEqual({
        error: { code: 'TRANSACTION_IMMUTABLE', message: 'Transactions are immutable and cannot be modified or deleted' },
      });
      expect((await request(ctx.app).get(`/transactions/${created.id}`)).body.data).toEqual(created);
      expect(await balanceOf(ctx.app, accountId)).toBe(100);
    });
  });

  describe('atomicity', () => {
    it('rolls back the transaction when the balance update fails', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      await credit(ctx.app, accountId, 100, 'funding');
      ctx.db.exec(`
        CREATE TEMP TRIGGER fail_balance_update BEFORE UPDATE ON accounts
        BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
      `);

      const res = await credit(ctx.app, accountId, 50, 'interrupted');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
      expect(logged).toHaveBeenCalled();
      ctx.db.exec('DROP TRIGGER fail_balance_update');
      expect(await balanceOf(ctx.app, accountId)).toBe(100);
      expect(countTransactions(ctx.db, accountId)).toBe(1);
      // Nothing from the failed attempt survived, so the same reference can be used again.
      expect((await credit(ctx.app, accountId, 50, 'interrupted')).status).toBe(201);
    });
  });

  describe('concurrency', () => {
    it('serialises concurrent debits so the balance never goes negative', async () => {
      await credit(ctx.app, accountId, 100);

      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => debit(ctx.app, accountId, 30, `debit-${i}`)));
      const statuses = results.map((res) => res.status);

      expect(statuses.filter((status) => status === 201)).toHaveLength(3);
      expect(statuses.filter((status) => status === 422)).toHaveLength(7);
      expect(await balanceOf(ctx.app, accountId)).toBe(10);
    });

    it('accepts only one of several concurrent requests with the same reference_id', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => credit(ctx.app, accountId, 40, 'same-ref')));
      const statuses = results.map((res) => res.status);

      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(4);
      expect(await balanceOf(ctx.app, accountId)).toBe(40);
    });
  });
});
