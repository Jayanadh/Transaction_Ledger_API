import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../src/errors.js';
import {
  amountField,
  descriptionField,
  jsonObject,
  parse,
  referenceIdField,
  uuidField,
} from '../src/http/validation.js';

function validationFailure(run: () => unknown) {
  try {
    run();
  } catch (err) {
    if (err instanceof ValidationError) {
      return { status: err.status, code: err.code, message: err.message, details: err.details };
    }
    throw err;
  }
  throw new Error('expected a ValidationError');
}

const messages = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).error?.issues.map((issue) => issue.message);

describe('parse', () => {
  const schema = jsonObject({ amount: amountField, reference_id: referenceIdField });

  it('returns the parsed value when the input is valid', () => {
    expect(parse(schema, { amount: 10, reference_id: ' ref-1 ' }, 'body')).toEqual({
      amount: 10,
      reference_id: 'ref-1',
    });
  });

  it('lists every invalid field in a 400 VALIDATION_ERROR', () => {
    expect(validationFailure(() => parse(schema, { amount: 0 }, 'body'))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body',
      details: [
        { field: 'amount', message: 'amount must be greater than 0' },
        { field: 'reference_id', message: 'reference_id is required' },
      ],
    });
  });

  it('reports each unknown field by name', () => {
    const failure = validationFailure(() => parse(schema, { amount: 1, reference_id: 'r', foo: 1, bar: 2 }, 'body'));
    expect(failure.details).toEqual([
      { field: 'foo', message: 'foo is not an allowed field' },
      { field: 'bar', message: 'bar is not an allowed field' },
    ]);
  });

  it('reports a body that is not a JSON object against the body itself', () => {
    for (const body of [undefined, [], 'text', 42]) {
      expect(validationFailure(() => parse(schema, body, 'body')).details).toEqual([
        { field: 'body', message: 'Request body must be a JSON object' },
      ]);
    }
  });

  it('names the request part in the message', () => {
    const query = z.object({ page: z.number() });
    expect(validationFailure(() => parse(query, {}, 'query')).message).toBe('Invalid query parameters');
    expect(validationFailure(() => parse(query, {}, 'params')).message).toBe('Invalid path parameters');
  });
});

describe('shared fields', () => {
  it('validates amounts', () => {
    expect(amountField.parse(10.25)).toBe(10.25);
    expect(messages(amountField, undefined)).toEqual(['amount is required']);
    expect(messages(amountField, '50')).toEqual(['amount must be a number']);
    expect(messages(amountField, 0)).toEqual(['amount must be greater than 0']);
    expect(messages(amountField, -5)).toEqual(['amount must be greater than 0']);
    expect(messages(amountField, 10.123)).toEqual(['amount must have at most 2 decimal places']);
    expect(messages(amountField, 1_000_000_000.01)).toEqual(['amount must not exceed 1000000000']);
  });

  it('lower-cases UUIDs and rejects malformed ones', () => {
    const field = uuidField('account_id');
    expect(field.parse('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(messages(field, undefined)).toEqual(['account_id is required']);
    expect(messages(field, 'not-a-uuid')).toEqual(['account_id must be a valid UUID']);
    expect(messages(field, 7)).toEqual(['account_id must be a valid UUID']);
  });

  it('trims reference ids and rejects blank ones', () => {
    expect(referenceIdField.parse('  ref-1 ')).toBe('ref-1');
    expect(messages(referenceIdField, undefined)).toEqual(['reference_id is required']);
    expect(messages(referenceIdField, '   ')).toEqual(['reference_id must not be empty']);
    expect(messages(referenceIdField, 'x'.repeat(101))).toEqual(['reference_id must be at most 100 characters']);
  });

  it('normalises a missing or blank description to null', () => {
    const schema = jsonObject({ description: descriptionField });
    expect(schema.parse({})).toEqual({ description: null });
    expect(schema.parse({ description: null })).toEqual({ description: null });
    expect(schema.parse({ description: '   ' })).toEqual({ description: null });
    expect(schema.parse({ description: ' Rent ' })).toEqual({ description: 'Rent' });
    expect(messages(schema, { description: 42 })).toEqual(['description must be a string']);
    expect(messages(schema, { description: 'x'.repeat(256) })).toEqual(['description must be at most 255 characters']);
  });
});
