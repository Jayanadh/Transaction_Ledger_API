import { fromMinorUnits } from '../money.js';

/** A row of the `accounts` table; `balance` is in minor units. */
export interface AccountRow {
  id: string;
  name: string;
  balance: number;
  created_at: string;
}

/** An account as returned by the API; `balance` is in decimal units. */
export type Account = AccountRow;

export interface AccountBalance {
  account_id: string;
  balance: number;
}

export function toAccount(row: AccountRow): Account {
  return { ...row, balance: fromMinorUnits(row.balance) };
}
