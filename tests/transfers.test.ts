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
  setBalanceDirectly,
  type TestContext,
} from './helpers.js';

describe('POST /transfers', () => {
  let ctx: TestContext;
  let accountA: string;
  let accountB: string;

  beforeEach(async () => {
    ctx = createTestApp();
    accountA = (await createAccount(ctx.app, 'Account A')).id;
    accountB = (await createAccount(ctx.app, 'Account B')).id;
    await credit(ctx.app, accountA, 100, 'fund-a');
    await credit(ctx.app, accountB, 50, 'fund-b');
  });

  afterEach(() => {
    ctx.db.close();
    vi.restoreAllMocks();
  });

  const transfer = (overrides: Record<string, unknown> = {}) =>
    request(ctx.app)
      .post('/transfers')
      .send({ from_account_id: accountA, to_account_id: accountB, amount: 30, reference_id: 'transfer-1', ...overrides });

  async function expectBalancesUntouched() {
    expect(await balanceOf(ctx.app, accountA)).toBe(100);
    expect(await balanceOf(ctx.app, accountB)).toBe(50);
    expect(countTransactions(ctx.db, accountA)).toBe(1);
    expect(countTransactions(ctx.db, accountB)).toBe(1);
  }

  it('moves money from one account to another', async () => {
    const res = await transfer();

    expect(res.status).toBe(201);
    expect(await balanceOf(ctx.app, accountA)).toBe(70);
    expect(await balanceOf(ctx.app, accountB)).toBe(80);
  });

  it('returns the transfer with both ledger entries', async () => {
    const res = await transfer({ description: 'Rent share' });
    const { data } = res.body;

    expect(data).toEqual({
      transfer_id: expect.stringMatching(UUID_PATTERN),
      from_account_id: accountA,
      to_account_id: accountB,
      amount: 30,
      reference_id: 'transfer-1',
      description: 'Rent share',
      created_at: expect.any(String),
      debit_transaction: expect.objectContaining({
        account_id: accountA,
        type: 'debit',
        amount: 30,
        balance_after: 70,
        reference_id: 'transfer-1',
        description: 'Rent share',
        created_at: data.created_at,
      }),
      credit_transaction: expect.objectContaining({
        account_id: accountB,
        type: 'credit',
        amount: 30,
        balance_after: 80,
        reference_id: 'transfer-1',
        description: 'Rent share',
        created_at: data.created_at,
      }),
    });
    expect(data.debit_transaction.transfer_id).toBe(data.transfer_id);
    expect(data.credit_transaction.transfer_id).toBe(data.transfer_id);
  });

  it('records each leg in its account history', async () => {
    const { data } = (await transfer()).body;

    const historyA = await request(ctx.app).get(`/accounts/${accountA}/transactions`);
    const historyB = await request(ctx.app).get(`/accounts/${accountB}/transactions`);

    expect(historyA.body.data[0]).toEqual(data.debit_transaction);
    expect(historyB.body.data[0]).toEqual(data.credit_transaction);
  });

  it('describes each leg when no description is given', async () => {
    const { data } = (await transfer()).body;

    expect(data.description).toBeNull();
    expect(data.debit_transaction.description).toBe(`Transfer to ${accountB}`);
    expect(data.credit_transaction.description).toBe(`Transfer from ${accountA}`);
  });

  it('rejects a transfer larger than the source balance and changes nothing', async () => {
    const res = await transfer({ amount: 150 });

    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({
      code: 'INSUFFICIENT_BALANCE',
      message: 'Insufficient balance: available 100, requested 150',
      details: { account_id: accountA, available_balance: 100, requested_amount: 150 },
    });
    await expectBalancesUntouched();
  });

  it.each([
    ['source', { from_account_id: UNKNOWN_ID }],
    ['destination', { to_account_id: UNKNOWN_ID }],
  ])('returns 404 when the %s account does not exist and changes nothing', async (_side, override) => {
    const res = await transfer(override);

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      message: `Account ${UNKNOWN_ID} not found`,
      details: { account_id: UNKNOWN_ID },
    });
    await expectBalancesUntouched();
  });

  it('rejects a transfer to the same account', async () => {
    const res = await transfer({ to_account_id: accountA.toUpperCase() });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { field: 'to_account_id', message: 'to_account_id must be different from from_account_id' },
    ]);
    await expectBalancesUntouched();
  });

  it('rejects a duplicate transfer reference_id without moving money again', async () => {
    expect((await transfer()).status).toBe(201);

    const res = await transfer();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(await balanceOf(ctx.app, accountA)).toBe(70);
    expect(await balanceOf(ctx.app, accountB)).toBe(80);
  });

  it('rolls back the debit when the credit leg fails', async () => {
    // B already used this reference, so the credit leg fails after the debit leg was written.
    await credit(ctx.app, accountB, 5, 'transfer-1');

    const res = await transfer();

    expect(res.status).toBe(409);
    expect(res.body.error.details.existing_transaction.account_id).toBe(accountB);
    expect(await balanceOf(ctx.app, accountA)).toBe(100);
    expect(countTransactions(ctx.db, accountA)).toBe(1);
    expect(await balanceOf(ctx.app, accountB)).toBe(55);
  });

  it('rolls back the debit when the credit would take the destination above the maximum balance', async () => {
    setBalanceDirectly(ctx.db, accountB, 9_999_999_999_999);

    const res = await transfer();

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BALANCE_LIMIT_EXCEEDED');
    expect(res.body.error.details.account_id).toBe(accountB);
    expect(await balanceOf(ctx.app, accountA)).toBe(100);
    expect(countTransactions(ctx.db, accountA)).toBe(1);
  });

  it('rolls back the whole transfer on an unexpected failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ctx.db.exec(`
      CREATE TEMP TRIGGER fail_credit_leg BEFORE INSERT ON transactions WHEN NEW.type = 'credit'
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
    `);

    const res = await transfer();

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    ctx.db.exec('DROP TRIGGER fail_credit_leg');
    await expectBalancesUntouched();
  });

  it('serialises concurrent transfers so the source never goes negative', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => transfer({ reference_id: `concurrent-${i}` })),
    );
    const statuses = results.map((res) => res.status);

    expect(statuses.filter((status) => status === 201)).toHaveLength(3);
    expect(statuses.filter((status) => status === 422)).toHaveLength(2);
    expect(await balanceOf(ctx.app, accountA)).toBe(10);
    expect(await balanceOf(ctx.app, accountB)).toBe(140);
  });

  it.each([
    ['from_account_id is missing', { from_account_id: undefined }, 'from_account_id', 'from_account_id is required'],
    ['to_account_id is malformed', { to_account_id: 'bob' }, 'to_account_id', 'to_account_id must be a valid UUID'],
    ['amount is zero', { amount: 0 }, 'amount', 'amount must be greater than 0'],
    ['amount is a string', { amount: '30' }, 'amount', 'amount must be a number'],
    ['reference_id is missing', { reference_id: undefined }, 'reference_id', 'reference_id is required'],
    ['an unknown field is sent', { currency: 'USD' }, 'currency', 'currency is not an allowed field'],
  ])('rejects the request when %s', async (_case, override, field, message) => {
    const res = await transfer(override);

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body',
      details: [{ field, message }],
    });
    await expectBalancesUntouched();
  });

  it('does not also report matching ids when both ids are invalid', async () => {
    const res = await transfer({ from_account_id: 'bob', to_account_id: 'bob' });

    expect(res.body.error.details).toEqual([
      { field: 'from_account_id', message: 'from_account_id must be a valid UUID' },
      { field: 'to_account_id', message: 'to_account_id must be a valid UUID' },
    ]);
  });
});
