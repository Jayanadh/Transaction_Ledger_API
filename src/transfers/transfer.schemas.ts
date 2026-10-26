import { amountField, descriptionField, jsonObject, referenceIdField, uuidField } from '../http/validation.js';

export const createTransferSchema = jsonObject({
  from_account_id: uuidField('from_account_id'),
  to_account_id: uuidField('to_account_id'),
  amount: amountField,
  reference_id: referenceIdField,
  description: descriptionField,
}).refine((transfer) => transfer.from_account_id !== transfer.to_account_id, {
  error: 'to_account_id must be different from from_account_id',
  path: ['to_account_id'],
  // Compare only once every field is valid, so two malformed ids are not also reported as "the same account".
  when: (payload) => payload.issues.length === 0,
});
