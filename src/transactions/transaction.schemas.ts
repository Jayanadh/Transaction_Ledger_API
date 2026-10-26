import { z } from 'zod';
import { amountField, descriptionField, jsonObject, referenceIdField, requiredOr, uuidField } from '../http/validation.js';
import { TRANSACTION_TYPES } from './transaction.model.js';

export const transactionTypeField = z.enum(TRANSACTION_TYPES, requiredOr('type', "type must be either 'credit' or 'debit'"));

export const createTransactionSchema = jsonObject({
  account_id: uuidField('account_id'),
  type: transactionTypeField,
  amount: amountField,
  reference_id: referenceIdField,
  description: descriptionField,
});

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

const PAGE_MESSAGE = 'page must be an integer greater than or equal to 1';
const LIMIT_MESSAGE = `limit must be an integer between 1 and ${MAX_PAGE_SIZE}`;

/** Query strings arrive as text, so page and limit are coerced to numbers before validation. Unknown parameters are ignored. */
export const listTransactionsQuerySchema = z.object({
  type: transactionTypeField.optional(),
  page: z.coerce
    .number({ error: PAGE_MESSAGE })
    .int({ error: PAGE_MESSAGE })
    .min(1, { error: PAGE_MESSAGE })
    .default(1),
  limit: z.coerce
    .number({ error: LIMIT_MESSAGE })
    .int({ error: LIMIT_MESSAGE })
    .min(1, { error: LIMIT_MESSAGE })
    .max(MAX_PAGE_SIZE, { error: LIMIT_MESSAGE })
    .default(DEFAULT_PAGE_SIZE),
});
