import { fromMinorUnits } from '../money.js';

export const TRANSACTION_TYPES = ['credit', 'debit'] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** A row of the `transactions` table; `amount` and `balance_after` are in minor units. */
export interface TransactionRow {
  id: string;
  account_id: string;
  type: TransactionType;
  amount: number;
  description: string | null;
  reference_id: string;
  /** The account balance right after this transaction was applied. */
  balance_after: number;
  /** Set on both legs of a transfer; null for a standalone credit or debit. */
  transfer_id: string | null;
  created_at: string;
}

/** A transaction as returned by the API; amounts are in decimal units. */
export type Transaction = TransactionRow;

export function toTransaction(row: TransactionRow): Transaction {
  return { ...row, amount: fromMinorUnits(row.amount), balance_after: fromMinorUnits(row.balance_after) };
}
