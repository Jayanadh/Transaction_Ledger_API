import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNKNOWN_ID, UUID_PATTERN, createAccount, createTestApp, credit, type TestContext } from './helpers.js';

describe('accounts', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  afterEach(() => ctx.db.close());

  describe('POST /accounts', () => {
    it('creates an account with a zero balance and system-generated id and created_at', async () => {
      const res = await request(ctx.app).post('/accounts').send({ name: 'Alice' });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        id: expect.stringMatching(UUID_PATTERN),
        name: 'Alice',
        balance: 0,
        created_at: expect.any(String),
      });
      expect(new Date(res.body.data.created_at).toISOString()).toBe(res.body.data.created_at);
    });

    it('gives every account a unique id', async () => {
      const first = await createAccount(ctx.app, 'Alice');
      const second = await createAccount(ctx.app, 'Alice');

      expect(first.id).not.toBe(second.id);
    });

    it('trims the name', async () => {
      const account = await createAccount(ctx.app, '  Alice Smith  ');

      expect(account.name).toBe('Alice Smith');
    });

    it.each([
      ['missing', {}, 'name is required'],
      ['blank', { name: '   ' }, 'name must not be empty'],
      ['not a string', { name: 123 }, 'name must be a string'],
      ['too long', { name: 'x'.repeat(101) }, 'name must be at most 100 characters'],
    ])('rejects a name that is %s', async (_case, body, message) => {
      const res = await request(ctx.app).post('/accounts').send(body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: [{ field: 'name', message }] },
      });
    });

    it.each([0, 500])('rejects a client-supplied balance of %s', async (balance) => {
      const res = await request(ctx.app).post('/accounts').send({ name: 'Alice', balance });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'balance', message: 'balance cannot be set by the client; new accounts always start with a balance of 0' },
      ]);
    });

    it('rejects unknown fields', async () => {
      const res = await request(ctx.app).post('/accounts').send({ name: 'Alice', id: 'my-own-id' });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'id', message: 'id is not an allowed field' }]);
    });

    it('rejects malformed JSON', async () => {
      const res = await request(ctx.app).post('/accounts').set('Content-Type', 'application/json').send('{"name":');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    });

    it('rejects a body sent without a JSON content type', async () => {
      const res = await request(ctx.app).post('/accounts').set('Content-Type', 'text/plain').send('{"name":"Alice"}');

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'body', message: 'Request body must be a JSON object' }]);
    });

    it.each(['42', '"Alice"', 'null', 'true'])('rejects the JSON value %s as a body', async (body) => {
      const res = await request(ctx.app).post('/accounts').set('Content-Type', 'application/json').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: [{ field: 'body', message: 'Request body must be a JSON object' }],
      });
    });

    it('rejects an array body', async () => {
      const res = await request(ctx.app).post('/accounts').send([{ name: 'Alice' }]);

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'body', message: 'Request body must be a JSON object' }]);
    });
  });

  describe('GET /accounts/:accountId', () => {
    it('returns the account', async () => {
      const account = await createAccount(ctx.app);

      const res = await request(ctx.app).get(`/accounts/${account.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: account });
    });

    it('returns 404 for an unknown account', async () => {
      const res = await request(ctx.app).get(`/accounts/${UNKNOWN_ID}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: {
          code: 'ACCOUNT_NOT_FOUND',
          message: `Account ${UNKNOWN_ID} not found`,
          details: { account_id: UNKNOWN_ID },
        },
      });
    });

    it('returns 400 for a malformed account id', async () => {
      const res = await request(ctx.app).get('/accounts/not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid path parameters',
          details: [{ field: 'account_id', message: 'account_id must be a valid UUID' }],
        },
      });
    });
  });

  describe('GET /accounts/:accountId/balance', () => {
    it('returns the account id and current balance', async () => {
      const account = await createAccount(ctx.app);
      await credit(ctx.app, account.id, 100);

      const res = await request(ctx.app).get(`/accounts/${account.id}/balance`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { account_id: account.id, balance: 100 } });
    });

    it('returns 404 for an unknown account', async () => {
      const res = await request(ctx.app).get(`/accounts/${UNKNOWN_ID}/balance`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('returns 400 for a malformed account id', async () => {
      const res = await request(ctx.app).get('/accounts/123/balance');

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'account_id', message: 'account_id must be a valid UUID' }]);
    });
  });
});
