import { z } from 'zod';
import { jsonObject, requiredOr } from '../http/validation.js';

export const createAccountSchema = jsonObject({
  name: z
    .string(requiredOr('name', 'name must be a string'))
    .trim()
    .min(1, { error: 'name must not be empty' })
    .max(100, { error: 'name must be at most 100 characters' }),
  // Named explicitly (rather than rejected as an unknown field) so the client gets a clear reason.
  balance: z
    .never({ error: 'balance cannot be set by the client; new accounts always start with a balance of 0' })
    .optional(),
});
