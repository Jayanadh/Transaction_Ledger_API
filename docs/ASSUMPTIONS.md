# Assumptions

## Accounts

1. **Names are not unique.** Two account holders can share a name. Names are trimmed and must be 1–100 characters.
2. **Supplying a balance is an error, not ignored.** The brief says the client must not set the initial balance. `POST /accounts` with any `balance` (even `0`) returns `400` with an explanation, so a client never thinks it set one. Other unknown fields (`id`, `created_at`, typos) are rejected the same way.
3. **Accounts cannot be renamed or deleted.** The brief doesn't ask for it, and deleting an account with history would break the ledger. The foreign key from `transactions` to `accounts` also blocks that at the database level.

## Money

4. **Single currency.** No currency field. Amounts work like a currency with two decimal places (cents, paise).
5. **Amounts are JSON numbers** with at most 2 decimal places. Strings such as `"50"` are rejected, so there is no ambiguity about type or locale formatting.
6. **Limits: 1,000,000,000 per transaction or transfer, and 9,999,999,999,999.99 per balance.** The first is a sanity limit on a single movement of money. The second keeps every balance exact from end to end, because a decimal with up to 15 significant digits survives the round trip through a JSON number exactly. A credit that would push a balance past the cap is rejected with `422 BALANCE_LIMIT_EXCEEDED`, and a database `CHECK` constraint backs the rule up.
7. **Stored as integer minor units.** 19.99 is stored as 1999, so balance arithmetic never suffers floating-point error. The API still speaks decimal amounts.

## Transactions

8. **`description` is optional.** The brief lists it as a transaction field but not among the required validations. It is `null` when omitted or blank, and at most 255 characters.
9. **`reference_id` is required.** It is trimmed, case-sensitive, at most 100 characters, and unique per account (enforced by a `UNIQUE (account_id, reference_id)` constraint).
10. **A duplicate `reference_id` returns `409 Conflict`** with the original transaction in `details.existing_transaction`. No transaction is created and the balance does not change.
    - This applies even if the second request has a different amount or type: the reference identifies the operation.
    - The duplicate check runs **before** the balance check. A retried debit that already succeeded is reported as a duplicate, not as "insufficient balance".
    - I considered returning `200` with the original transaction (idempotent replay). I chose `409` because the brief lists "duplicate transaction" among the error cases and asks for a response "indicating that the transaction already exists".
11. **Rejected requests are not stored.** Validation errors, insufficient balance and duplicates leave no trace in the ledger. A rejected request's `reference_id` therefore stays free for a corrected retry.
12. **Insufficient balance returns `422 Unprocessable Entity`.** The request is well-formed but breaks a business rule given the account's current state. A credit over the balance cap gets the same status, with the code `BALANCE_LIMIT_EXCEEDED`. `400` is reserved for malformed input.
13. **Two extra fields per transaction.** `balance_after` (the balance right after the transaction) makes the history auditable. `transfer_id` links the two legs of a transfer.
14. **Immutability is enforced twice.** `PUT`, `PATCH` and `DELETE` on a transaction return `405` with `Allow: GET`. Database triggers also reject any `UPDATE` or `DELETE` on the `transactions` table.

## Transaction history

15. **Pagination:** `page` defaults to 1 and `limit` to 10, with a maximum `limit` of 100. Non-integer or out-of-range values return `400`; they are not silently clamped.
16. **A page past the end returns `200`** with an empty `data` array and the real totals. `total_pages` is `0` when there are no matching records.
17. **Sorting:** latest first by `created_at`. Rows created in the same millisecond are ordered by insertion, newest first.
18. **Unknown query parameters are ignored.** `type`, `page` and `limit` are validated.
19. **An unknown account returns `404`** rather than an empty list, so a typo in the id is visible.

## Transfers (bonus)

20. **A transfer needs a `reference_id`** so a client can retry safely. It is recorded on both legs and must be unused on both accounts. Otherwise the API returns `409` and no money moves.
21. **A transfer is two ordinary transactions:** a debit on the source and a credit on the destination, linked by a shared `transfer_id`, with no separate transfers table. Each account's history and balance stay explained entirely by its own transactions. When no description is given, the legs read `Transfer to <id>` and `Transfer from <id>`.
22. **A transfer to the same account returns `400`.**
23. **Both accounts must exist.** The `404` names the missing account.

## IDs, timestamps and API shape

24. **IDs are UUIDs.** A malformed id returns `400` (validation error) and a well-formed but unknown id returns `404`. Uppercase UUIDs are accepted and normalised to lowercase.
25. **Timestamps are generated by the server** in UTC, ISO 8601 with milliseconds.
26. **Response envelopes:** success is `{ "data": ... }`; every error is `{ "error": { "code", "message", "details"? } }`.

## Scope and environment

27. **No authentication or authorisation.** It is not in the brief. In production every endpoint would sit behind auth, and accounts would belong to users.
28. **SQLite as the database.** It needs no setup to run locally, and the schema is created automatically on startup. It still enforces the integrity rules: `CHECK`, `UNIQUE` and foreign-key constraints, `STRICT` column types, and immutability triggers.
29. **Concurrency.** Each write runs in a `BEGIN IMMEDIATE` transaction. better-sqlite3 is synchronous, so within one process each request's database transaction completes before the next starts. Across several processes sharing the file, the immediate write lock (with a busy timeout) serialises writers. Scaling out horizontally would mean moving to PostgreSQL with row locks (`SELECT … FOR UPDATE`).
