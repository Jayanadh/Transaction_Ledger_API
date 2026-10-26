# Transaction Ledger API

A backend API for a simple transaction ledger, built for the Full Stack Developer Assessment. It covers:

- creating accounts
- posting credit and debit transactions
- reading balances and paginated transaction history
- transferring money between accounts

Every balance change is atomic, and the database enforces the integrity rules as well as the API.

**Stack:** Node.js · TypeScript · Express 5 · SQLite (better-sqlite3) · zod · Vitest + Supertest · OpenAPI 3.1 / Swagger UI

| Deliverable | Where |
| --- | --- |
| Source code | [`src/`](src) (tests in [`tests/`](tests)) |
| README | this file |
| API documentation | [`docs/API.md`](docs/API.md), [`docs/openapi.yaml`](docs/openapi.yaml), Swagger UI at `/docs` |
| Assumptions | [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) |

## Requirements coverage

| # | Requirement | Implementation |
| --- | --- | --- |
| 1 | Create account | `POST /accounts`. The id is a UUID, the balance always starts at 0, and `created_at` is set by the system. A client-supplied balance is rejected. |
| 2 | Add transaction | `POST /transactions` takes a credit or debit. An overdraft returns `422` and leaves the balance unchanged. A duplicate `reference_id` on the same account returns `409` and creates nothing. |
| 3 | Get balance | `GET /accounts/{id}/balance` returns `{ account_id, balance }`. An unknown account returns `404`. |
| 4 | Transaction history | `GET /accounts/{id}/transactions?type=&page=&limit=` returns latest first, with `current_page`, `page_size`, `total_records` and `total_pages`. |
| 5 | Data integrity | Transactions are immutable (`405` from the API, plus database triggers). The balance always equals the result of all valid transactions. The insert and the balance update share one database transaction. |
| 7 | Validation | zod schemas validate every body, query string and path id. Bodies are strict. Database constraints act as a second line of defence. |
| 8 | Error handling | One error format, with a specific status and code for every case in the brief. |
| 9 | Bonus: money transfer | `POST /transfers` writes the debit and the credit in one database transaction. Any failure rolls back both. |
| 10 | Technical | Feature-based layered structure, database constraints, more than 120 automated tests, and two commands to run locally. |

## Getting started

**Prerequisites:** Node.js **22 or newer** (developed on Node 24 LTS) and npm. No database server is needed.

```bash
npm install
npm start
```

`npm start` compiles the TypeScript into `dist/` and starts the API on **http://localhost:3000**. The SQLite database file (`data/ledger.db`) and its schema are created on first start. To reset all data, stop the server and delete `data/`.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `data/ledger.db` | SQLite database file, created if missing |

For example: `PORT=4000 DATABASE_PATH=/tmp/ledger.db npm start`

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with auto-reload (tsx watch) |
| `npm test` | Run the test suite. Each test uses its own in-memory database, so no setup is needed. |
| `npm run typecheck` | Type-check the source and the tests |
| `npm run build` | Compile to `dist/` |

## Try it

With the server running, open **http://localhost:3000/docs** for interactive Swagger UI, or use curl. The walkthrough below reproduces the examples from the brief. It uses `jq` to capture ids.

```bash
API=http://localhost:3000
A=$(curl -s -X POST $API/accounts -H 'Content-Type: application/json' -d '{"name":"Account A"}' | jq -r .data.id)
B=$(curl -s -X POST $API/accounts -H 'Content-Type: application/json' -d '{"name":"Account B"}' | jq -r .data.id)

# Credit A with 100 and B with 50
curl -s -X POST $API/transactions -H 'Content-Type: application/json' \
  -d "{\"account_id\":\"$A\",\"type\":\"credit\",\"amount\":100,\"reference_id\":\"deposit-a\"}"
curl -s -X POST $API/transactions -H 'Content-Type: application/json' \
  -d "{\"account_id\":\"$B\",\"type\":\"credit\",\"amount\":50,\"reference_id\":\"deposit-b\"}"

# Transfer 30 from A to B
curl -s -X POST $API/transfers -H 'Content-Type: application/json' \
  -d "{\"from_account_id\":\"$A\",\"to_account_id\":\"$B\",\"amount\":30,\"reference_id\":\"transfer-1\"}"
curl -s $API/accounts/$A/balance    # → "balance":70
curl -s $API/accounts/$B/balance    # → "balance":80

# Debit 150 from A (balance 70) → 422 INSUFFICIENT_BALANCE; the balance stays 70
curl -s -X POST $API/transactions -H 'Content-Type: application/json' \
  -d "{\"account_id\":\"$A\",\"type\":\"debit\",\"amount\":150,\"reference_id\":\"too-much\"}"

# Re-send an existing reference_id → 409 DUPLICATE_TRANSACTION; nothing changes
curl -s -X POST $API/transactions -H 'Content-Type: application/json' \
  -d "{\"account_id\":\"$A\",\"type\":\"credit\",\"amount\":100,\"reference_id\":\"deposit-a\"}"

# History: latest first, filtered and paginated
curl -s "$API/accounts/$A/transactions?type=debit&page=1&limit=10"
```

Full request and response examples for every endpoint and error are in [`docs/API.md`](docs/API.md).

## API at a glance

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/accounts` | Create an account (balance starts at 0) |
| `GET` | `/accounts/{accountId}` | Get an account |
| `GET` | `/accounts/{accountId}/balance` | Get the current balance |
| `GET` | `/accounts/{accountId}/transactions` | History: `type`, `page`, `limit`; latest first |
| `POST` | `/transactions` | Add a credit or debit |
| `GET` | `/transactions/{transactionId}` | Get a transaction |
| `PUT` `PATCH` `DELETE` | `/transactions/{transactionId}` | Always `405`: transactions are immutable |
| `POST` | `/transfers` | Transfer money between two accounts |
| `GET` | `/health` | Health check |
| `GET` | `/docs`, `/openapi.json` | Swagger UI and the OpenAPI document |

Every error has the same shape:

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance: available 100, requested 150",
    "details": { "account_id": "…", "available_balance": 100, "requested_amount": 150 }
  }
}
```

| Case from the brief | Status | Code |
| --- | --- | --- |
| Invalid request body, invalid transaction type, invalid amount, invalid pagination parameters | `400` | `VALIDATION_ERROR`, with a `details` entry per invalid field |
| Malformed JSON | `400` | `INVALID_JSON` |
| Account not found | `404` | `ACCOUNT_NOT_FOUND` |
| Duplicate transaction | `409` | `DUPLICATE_TRANSACTION`, with the original transaction in `details` |
| Insufficient balance | `422` | `INSUFFICIENT_BALANCE` |

## Project structure

```
src/
├── server.ts                 Entry point: reads env vars, opens the database, starts HTTP, shuts down cleanly
├── app.ts                    createApp(db): wires repositories → services → routes, docs and error handling
├── errors.ts                 AppError and the typed errors the API returns (HTTP status + code)
├── money.ts                  Decimal ↔ integer minor-unit conversion
├── db/
│   ├── schema.ts             Tables, CHECK / UNIQUE / foreign-key constraints, index, immutability triggers
│   └── database.ts           Opens SQLite, sets pragmas, applies the schema
├── http/
│   ├── validation.ts         parse() plus the shared zod fields (UUID, amount, reference_id, description)
│   ├── error-handler.ts      One error format for everything; 404 for unknown routes
│   └── docs.ts               /openapi.json and Swagger UI at /docs
├── accounts/                 account.routes → account.service → account.repository (+ schemas, model)
├── transactions/             The same layers, plus TransactionService.postEntry, the only code that changes a balance
└── transfers/                Transfer routes, schema and service: two ledger entries, one database transaction
tests/                        Vitest + Supertest suites per feature, plus direct database-constraint tests
docs/                         API.md, ASSUMPTIONS.md, openapi.yaml
```

## Design decisions

**Layers.**
- Routes only deal with HTTP: validate the input, call a service, shape the response.
- Services hold the business rules and own the database transactions.
- Repositories hold the SQL.

`createApp(db)` wires the three layers together, so the tests run the full stack against a fresh in-memory database.

**Money.** Amounts arrive as decimals (`19.99`) and are stored as integer minor units (`1999`). Balance arithmetic is integer arithmetic, so `0.1 + 0.2` is exactly `0.3`. Conversion happens in one module, `money.ts`. Balances are capped at 9,999,999,999,999.99 (15 significant digits), so every balance is also exact as a JSON number.

**Atomicity.** Every balance change goes through `TransactionService.postEntry`, which:

1. checks that the account exists,
2. rejects a duplicate `reference_id`,
3. rejects an overdraft,
4. inserts the transaction,
5. updates the balance.

`postEntry` refuses to run outside a database transaction.
- A credit or debit runs it inside one `BEGIN IMMEDIATE` transaction.
- A transfer runs it twice, debit then credit, inside one shared transaction.

If anything throws, SQLite rolls back every write. That includes the credit leg failing after the debit leg was written. The tests prove this by injecting failures with temporary triggers.

**Integrity in the database, not just the code.**
- `CHECK (balance BETWEEN 0 AND 999999999999999)` (the cap in minor units), `CHECK (amount > 0)`, `CHECK (type IN ('credit','debit'))`, and non-blank names and references.
- `UNIQUE (account_id, reference_id)`.
- A foreign key from transactions to accounts (enabled with `PRAGMA foreign_keys = ON`).
- `STRICT` tables, so a fractional value can never land in an integer money column.
- Triggers that abort any `UPDATE` or `DELETE` on `transactions`.

**Duplicates.** The `reference_id` check runs inside the locked transaction, before the balance check, and the unique index backs it up. A duplicate returns `409` with the original transaction, so the client can reconcile.

**Concurrency.** better-sqlite3 is synchronous. Within one Node process, each request's database transaction runs to completion before another starts, so two balance checks can never interleave. `BEGIN IMMEDIATE` and a busy timeout also serialise writers across processes that share the database file. The tests fire concurrent debits, duplicate submissions and transfers, and check that the balance never goes negative and nothing is applied twice.

**Errors.** One error handler renders everything as `{ error: { code, message, details? } }`. Unexpected errors are logged and returned as a generic `500` without internals.

## Testing

```bash
npm test
```

| Suite | Covers |
| --- | --- |
| `database.test.ts` | Schema constraints and triggers, exercised directly in SQL |
| `money.test.ts`, `validation.test.ts` | Amount conversion and the shared validators |
| `accounts.test.ts` | Create and get accounts, balance endpoint, body validation (missing name, client-set balance, malformed JSON…) |
| `transactions.test.ts` | Credit and debit rules, the brief's examples, duplicates, a validation table, immutability, rollback on failure, concurrency |
| `transaction-history.test.ts` | Latest-first sorting (including same-millisecond ties), type filter, pagination metadata, invalid query parameters |
| `transfers.test.ts` | The brief's transfer example, rollback when either leg fails, missing accounts, duplicates, concurrency |
| `app.test.ts` | Health check, unknown routes, malformed and oversized bodies, and that the OpenAPI docs match the real routes |

## Assumptions

The brief leaves some behaviour open. Every decision is listed with its reasoning in [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md). The most important ones:

- A duplicate `reference_id` returns **409** with the original transaction, even if the amount or type differs. It is checked before the balance, so a retried debit is reported as a duplicate, not as insufficient funds.
- Insufficient balance returns **422**. Malformed input returns **400**.
- Amounts are JSON numbers with at most 2 decimal places, from 0.01 up to 1,000,000,000, in a single currency. Balances are capped at 9,999,999,999,999.99.
- `description` is optional. Unknown body fields are rejected.
- A transfer needs a `reference_id`, which must be unused on both accounts. It is stored as two linked transactions, one per account.
- There is no authentication; it is out of scope for the brief.

## What I would add next

- Authentication, with accounts owned by users
- PostgreSQL and a migrations tool, for deployments with several instances
- Cursor-based pagination for very long histories
- Request IDs, structured logging and metrics
- Rate limiting and a Dockerfile
