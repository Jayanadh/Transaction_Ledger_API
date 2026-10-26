import { randomUUID } from 'node:crypto';
import type { Transaction as DbTransaction } from 'better-sqlite3';
import type { AccountRepository } from '../accounts/account.repository.js';
import type { Db } from '../db/database.js';
import { AccountNotFoundError } from '../errors.js';
import { toMinorUnits } from '../money.js';
import { toTransaction, type Transaction } from '../transactions/transaction.model.js';
import type { TransactionService } from '../transactions/transaction.service.js';

/** `amount` is in decimal units. */
export interface CreateTransferInput {
  from_account_id: string;
  to_account_id: string;
  amount: number;
  reference_id: string;
  description: string | null;
}

export interface Transfer {
  transfer_id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  reference_id: string;
  description: string | null;
  created_at: string;
  debit_transaction: Transaction;
  credit_transaction: Transaction;
}

export class TransferService {
  private readonly transferAtomically: DbTransaction<(input: CreateTransferInput) => Transfer>;

  constructor(
    db: Db,
    private readonly accounts: AccountRepository,
    private readonly ledger: TransactionService,
  ) {
    this.transferAtomically = db.transaction((input: CreateTransferInput) => this.postTransfer(input));
  }

  /** Debits the source and credits the destination in one database transaction: both legs are written, or neither. */
  createTransfer(input: CreateTransferInput): Transfer {
    return this.transferAtomically.immediate(input);
  }

  private postTransfer(input: CreateTransferInput): Transfer {
    for (const accountId of [input.from_account_id, input.to_account_id]) {
      if (!this.accounts.findById(accountId)) {
        throw new AccountNotFoundError(accountId);
      }
    }

    const transferId = randomUUID();
    const createdAt = new Date().toISOString();
    const leg = {
      amount: toMinorUnits(input.amount),
      reference_id: input.reference_id,
      transfer_id: transferId,
      created_at: createdAt,
    };

    // If the credit leg throws (e.g. its reference_id is already used on the destination),
    // the surrounding transaction rolls back the debit leg as well.
    const debit = this.ledger.postEntry({
      ...leg,
      account_id: input.from_account_id,
      type: 'debit',
      description: input.description ?? `Transfer to ${input.to_account_id}`,
    });
    const credit = this.ledger.postEntry({
      ...leg,
      account_id: input.to_account_id,
      type: 'credit',
      description: input.description ?? `Transfer from ${input.from_account_id}`,
    });

    return {
      transfer_id: transferId,
      from_account_id: input.from_account_id,
      to_account_id: input.to_account_id,
      amount: input.amount,
      reference_id: input.reference_id,
      description: input.description,
      created_at: createdAt,
      debit_transaction: toTransaction(debit),
      credit_transaction: toTransaction(credit),
    };
  }
}
