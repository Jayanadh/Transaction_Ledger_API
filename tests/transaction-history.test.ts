import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNKNOWN_ID, createAccount, createTestApp, credit, debit, type TestContext } from './helpers.js';

const PAGE_MESSAGE = 'page must be an integer greater than or equal to 1';
const LIMIT_MESSAGE = 'limit must be an integer between 1 and 100';

describe('GET /accounts/:accountId/transactions', () => {
  let ctx: TestContext;
  let accountId: string;

  beforeEach(async () => {
    ctx = createTestApp();
    accountId = (await createAccount(ctx.app)).id;
  });

  afterEach(() => {
    ctx.db.close();
    vi.useRealTimers();
  });

  const history = (query = '') => request(ctx.app).get(`/accounts/${accountId}/transactions${query}`);
  const referenceIds = (res: request.Response) => res.body.data.map((t: { reference_id: string }) => t.reference_id);

  async function creditTimes(count: number) {
    for (let i = 1; i <= count; i++) {
      await credit(ctx.app, accountId, 1, `r${i}`);
    }
  }

  it('returns transactions latest first', async () => {
    await credit(ctx.app, accountId, 100, 'r1');
    await debit(ctx.app, accountId, 10, 'r2');
    await credit(ctx.app, accountId, 5, 'r3');

    const res = await history();

    expect(res.status).toBe(200);
    expect(referenceIds(res)).toEqual(['r3', 'r2', 'r1']);
  });

  it('breaks created_at ties by insertion order', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'));
    await creditTimes(3);

    const res = await history();

    expect(new Set(res.body.data.map((t: { created_at: string }) => t.created_at)).size).toBe(1);
    expect(referenceIds(res)).toEqual(['r3', 'r2', 'r1']);
  });

  it('returns both credits and debits when no type is given', async () => {
    await credit(ctx.app, accountId, 100, 'c1');
    await debit(ctx.app, accountId, 40, 'd1');

    const res = await history();

    expect(res.body.data.map((t: { type: string }) => t.type)).toEqual(['debit', 'credit']);
  });

  it('filters by type', async () => {
    await credit(ctx.app, accountId, 100, 'c1');
    await debit(ctx.app, accountId, 40, 'd1');
    await credit(ctx.app, accountId, 10, 'c2');

    expect(referenceIds(await history('?type=credit'))).toEqual(['c2', 'c1']);
    expect(referenceIds(await history('?type=debit'))).toEqual(['d1']);
  });

  it('paginates with page and limit', async () => {
    await creditTimes(25);

    const first = await history('?page=1&limit=10');
    const last = await history('?page=3&limit=10');

    expect(referenceIds(first)).toEqual(['r25', 'r24', 'r23', 'r22', 'r21', 'r20', 'r19', 'r18', 'r17', 'r16']);
    expect(referenceIds(last)).toEqual(['r5', 'r4', 'r3', 'r2', 'r1']);
    expect(last.body.pagination).toEqual({ current_page: 3, page_size: 10, total_records: 25, total_pages: 3 });
  });

  it('defaults to page 1 and a page size of 10', async () => {
    await creditTimes(12);

    const res = await history();

    expect(res.body.data).toHaveLength(10);
    expect(res.body.pagination).toEqual({ current_page: 1, page_size: 10, total_records: 12, total_pages: 2 });
  });

  it('returns an empty page past the end', async () => {
    await creditTimes(3);

    const res = await history('?page=99');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      pagination: { current_page: 99, page_size: 10, total_records: 3, total_pages: 1 },
    });
  });

  it('counts totals after filtering', async () => {
    await creditTimes(3);
    await debit(ctx.app, accountId, 1, 'd1');
    await debit(ctx.app, accountId, 1, 'd2');

    const res = await history('?type=debit&limit=1');

    expect(referenceIds(res)).toEqual(['d2']);
    expect(res.body.pagination).toEqual({ current_page: 1, page_size: 1, total_records: 2, total_pages: 2 });
  });

  it('returns an empty list for an account without transactions', async () => {
    const res = await history();

    expect(res.body).toEqual({
      data: [],
      pagination: { current_page: 1, page_size: 10, total_records: 0, total_pages: 0 },
    });
  });

  it("only returns the requested account's transactions", async () => {
    const other = await createAccount(ctx.app, 'Bob');
    await credit(ctx.app, accountId, 100, 'mine');
    await credit(ctx.app, other.id, 100, 'theirs');

    expect(referenceIds(await history())).toEqual(['mine']);
  });

  it.each([
    ['page=0', 'page', PAGE_MESSAGE],
    ['page=-1', 'page', PAGE_MESSAGE],
    ['page=abc', 'page', PAGE_MESSAGE],
    ['page=1.5', 'page', PAGE_MESSAGE],
    ['limit=0', 'limit', LIMIT_MESSAGE],
    ['limit=101', 'limit', LIMIT_MESSAGE],
    ['limit=abc', 'limit', LIMIT_MESSAGE],
    ['type=refund', 'type', "type must be either 'credit' or 'debit'"],
  ])('rejects the query %s', async (query, field, message) => {
    const res = await history(`?${query}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: [{ field, message }] },
    });
  });

  it('returns 404 for an unknown account', async () => {
    const res = await request(ctx.app).get(`/accounts/${UNKNOWN_ID}/transactions`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('returns 400 for a malformed account id', async () => {
    const res = await request(ctx.app).get('/accounts/abc/transactions');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'account_id', message: 'account_id must be a valid UUID' }]);
  });
});
