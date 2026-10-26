import { MAX_BALANCE } from './money.js';
import type { Transaction } from './transactions/transaction.model.js';

export interface FieldError {
  field: string;
  message: string;
}

/**
 * An error with an HTTP status and a stable, machine-readable code.
 * The error handler renders it as `{ "error": { "code", "message", "details"? } }`.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: FieldError[]) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class AccountNotFoundError extends AppError {
  constructor(accountId: string) {
    super(404, 'ACCOUNT_NOT_FOUND', `Account ${accountId} not found`, { account_id: accountId });
  }
}

export class TransactionNotFoundError extends AppError {
  constructor(transactionId: string) {
    super(404, 'TRANSACTION_NOT_FOUND', `Transaction ${transactionId} not found`, { transaction_id: transactionId });
  }
}

export class TransactionImmutableError extends AppError {
  constructor() {
    super(405, 'TRANSACTION_IMMUTABLE', 'Transactions are immutable and cannot be modified or deleted');
  }
}

/** The reference_id was already used on this account; the original transaction is returned for reconciliation. */
export class DuplicateTransactionError extends AppError {
  constructor(existing: Transaction) {
    super(
      409,
      'DUPLICATE_TRANSACTION',
      `A transaction with reference_id '${existing.reference_id}' already exists for account ${existing.account_id}`,
      { existing_transaction: existing },
    );
  }
}

/** Amounts are decimal (API) units. */
export class BalanceLimitExceededError extends AppError {
  constructor(accountId: string, currentBalance: number, requestedAmount: number) {
    super(422, 'BALANCE_LIMIT_EXCEEDED', `Balance limit exceeded: a balance cannot exceed ${MAX_BALANCE}`, {
      account_id: accountId,
      current_balance: currentBalance,
      requested_amount: requestedAmount,
      max_balance: MAX_BALANCE,
    });
  }
}

/** Amounts are decimal (API) units. */
export class InsufficientBalanceError extends AppError {
  constructor(accountId: string, availableBalance: number, requestedAmount: number) {
    super(422, 'INSUFFICIENT_BALANCE', `Insufficient balance: available ${availableBalance}, requested ${requestedAmount}`, {
      account_id: accountId,
      available_balance: availableBalance,
      requested_amount: requestedAmount,
    });
  }
}
