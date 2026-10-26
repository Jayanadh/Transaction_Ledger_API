import { Router } from 'express';
import { TransactionImmutableError } from '../errors.js';
import { parse, parseIdParam } from '../http/validation.js';
import { createTransactionSchema, listTransactionsQuerySchema } from './transaction.schemas.js';
import type { TransactionService } from './transaction.service.js';

export function transactionRoutes(transactions: TransactionService): Router {
  const router = Router();

  router.post('/transactions', (req, res) => {
    const input = parse(createTransactionSchema, req.body, 'body');
    res.status(201).json({ data: transactions.createTransaction(input) });
  });

  router.get('/accounts/:accountId/transactions', (req, res) => {
    const accountId = parseIdParam('account_id', req.params.accountId);
    const query = parse(listTransactionsQuerySchema, req.query, 'query');
    res.json(transactions.listTransactions(accountId, query));
  });

  router
    .route('/transactions/:transactionId')
    .get((req, res) => {
      const transactionId = parseIdParam('transaction_id', req.params.transactionId);
      res.json({ data: transactions.getTransaction(transactionId) });
    })
    // The ledger is append-only: any attempt to edit or delete a transaction is refused.
    .all((_req, res) => {
      res.set('Allow', 'GET');
      throw new TransactionImmutableError();
    });

  return router;
}
