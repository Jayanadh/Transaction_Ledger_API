import { MAX_BALANCE_MINOR_UNITS } from '../money.js';

/**
 * Database schema, applied on startup (every statement is idempotent).
 *
 * Money columns (`balance`, `amount`, `balance_after`) hold integer minor units
 * (cents), so no floating-point arithmetic ever touches money. STRICT tables make
 * SQLite enforce the declared column types instead of silently coercing values.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
  balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance BETWEEN 0 AND ${MAX_BALANCE_MINOR_UNITS}),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts (id),
  type          TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  description   TEXT,
  reference_id  TEXT NOT NULL CHECK (length(trim(reference_id)) > 0),
  balance_after INTEGER NOT NULL CHECK (balance_after BETWEEN 0 AND ${MAX_BALANCE_MINOR_UNITS}),
  transfer_id   TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (account_id, reference_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_transactions_account_created
  ON transactions (account_id, created_at);

-- The ledger is append-only: block edits and deletes at the database level as well.
CREATE TRIGGER IF NOT EXISTS transactions_no_update
BEFORE UPDATE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions are immutable');
END;
`;
