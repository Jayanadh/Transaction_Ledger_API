import { z } from 'zod';
import { ValidationError, type FieldError } from '../errors.js';
import { MAX_AMOUNT, hasAtMostTwoDecimals } from '../money.js';

type RequestPart = 'body' | 'query' | 'params';

const FAILURE_MESSAGES: Record<RequestPart, string> = {
  body: 'Invalid request body',
  query: 'Invalid query parameters',
  params: 'Invalid path parameters',
};

/** Validates one part of a request; throws a 400 ValidationError that lists every invalid field. */
export function parse<S extends z.ZodType>(schema: S, input: unknown, part: RequestPart): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(FAILURE_MESSAGES[part], toFieldErrors(result.error, part));
  }
  return result.data;
}

/** Validates a UUID path parameter; errors are reported under `field` (e.g. `account_id`). */
export function parseIdParam(field: string, value: unknown): string {
  const result = uuidField(field).safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      FAILURE_MESSAGES.params,
      result.error.issues.map((issue) => ({ field, message: issue.message })),
    );
  }
  return result.data;
}

function toFieldErrors(error: z.ZodError, part: RequestPart): FieldError[] {
  return error.issues.flatMap((issue) => {
    const path = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({ field: [...path, key].join('.'), message: `${key} is not an allowed field` }));
    }
    return [{ field: path.length > 0 ? path.join('.') : part, message: issue.message }];
  });
}

/** Error option that tells a missing value apart from an invalid one. */
export function requiredOr(field: string, invalidMessage: string) {
  return {
    error: (issue: { input?: unknown }) => (issue.input === undefined ? `${field} is required` : invalidMessage),
  };
}

/** A JSON request body: must be an object and may not contain unknown fields. */
export function jsonObject<Shape extends z.core.$ZodLooseShape>(shape: Shape) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === 'invalid_type' ? 'Request body must be a JSON object' : undefined),
  });
}

export function uuidField(field: string) {
  return z.uuid(requiredOr(field, `${field} must be a valid UUID`)).transform((id) => id.toLowerCase());
}

export const amountField = z
  .number(requiredOr('amount', 'amount must be a number'))
  .positive({ error: 'amount must be greater than 0' })
  .max(MAX_AMOUNT, { error: `amount must not exceed ${MAX_AMOUNT}` })
  .refine(hasAtMostTwoDecimals, { error: 'amount must have at most 2 decimal places' });

export const referenceIdField = z
  .string(requiredOr('reference_id', 'reference_id must be a string'))
  .trim()
  .min(1, { error: 'reference_id must not be empty' })
  .max(100, { error: 'reference_id must be at most 100 characters' });

export const descriptionField = z
  .string({ error: 'description must be a string' })
  .trim()
  .max(255, { error: 'description must be at most 255 characters' })
  .nullish()
  .transform((description) => description || null);
