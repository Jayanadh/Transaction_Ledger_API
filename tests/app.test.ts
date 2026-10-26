import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNKNOWN_ID, createTestApp, type TestContext } from './helpers.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

describe('app', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  afterEach(() => ctx.db.close());

  it('reports health', async () => {
    const res = await request(ctx.app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns a consistent 404 error for unknown routes', async () => {
    const res = await request(ctx.app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route GET /nope not found' } });
  });

  it('rejects malformed JSON with INVALID_JSON', async () => {
    const res = await request(ctx.app).post('/nope').set('Content-Type', 'application/json').send('{"name":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'INVALID_JSON', message: 'Request body contains malformed JSON' } });
  });

  it('rejects oversized bodies with PAYLOAD_TOO_LARGE', async () => {
    const res = await request(ctx.app)
      .post('/nope')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(200_000) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a body in an unsupported charset with 415', async () => {
    const res = await request(ctx.app)
      .post('/accounts')
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{"name":"Alice"}');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('INVALID_REQUEST_BODY');
    expect(res.body.error.message).toMatch(/unsupported charset/i);
  });

  describe('API documentation', () => {
    it('serves the OpenAPI document', async () => {
      const res = await request(ctx.app).get('/openapi.json');

      expect(res.status).toBe(200);
      expect(res.body.openapi).toMatch(/^3\.1\./);
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining([
          '/health',
          '/accounts',
          '/accounts/{accountId}',
          '/accounts/{accountId}/balance',
          '/accounts/{accountId}/transactions',
          '/transactions',
          '/transactions/{transactionId}',
          '/transfers',
        ]),
      );
    });

    it('documents only routes the app actually serves', async () => {
      const { paths } = (await request(ctx.app).get('/openapi.json')).body as {
        paths: Record<string, Partial<Record<(typeof HTTP_METHODS)[number], unknown>>>;
      };

      for (const [template, operations] of Object.entries(paths)) {
        const path = template.replace(/\{[^}]+\}/g, UNKNOWN_ID);
        for (const method of HTTP_METHODS.filter((m) => m in operations)) {
          const res = await request(ctx.app)[method](path).send({});
          expect(res.body.error?.code, `${method.toUpperCase()} ${template}`).not.toBe('ROUTE_NOT_FOUND');
        }
      }
    });

    it('documents an amount schema that accepts every valid amount', async () => {
      const amount = (await request(ctx.app).get('/openapi.json')).body.components.schemas.Amount;
      // Mirrors how JSON Schema validators check these keywords, including multipleOf's float division.
      const satisfiesSchema = (value: number) =>
        value > amount.exclusiveMinimum &&
        value <= amount.maximum &&
        (amount.multipleOf === undefined || Number.isInteger(value / amount.multipleOf));

      for (const value of [0.01, 0.29, 19.99, 100, 999999999.99]) {
        expect(satisfiesSchema(value), String(value)).toBe(true);
      }
    });

    it('serves interactive docs with Swagger UI', async () => {
      const res = await request(ctx.app).get('/docs/');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('swagger-ui');
    });
  });
});
