import express from 'express';
import { accountRoutes } from './accounts/account.routes.js';
import { AccountRepository } from './accounts/account.repository.js';
import { AccountService } from './accounts/account.service.js';
import type { Db } from './db/database.js';
import { docsRouter } from './http/docs.js';
import { errorHandler, notFoundHandler } from './http/error-handler.js';
import { TransactionRepository } from './transactions/transaction.repository.js';
import { transactionRoutes } from './transactions/transaction.routes.js';
import { TransactionService } from './transactions/transaction.service.js';
import { transferRoutes } from './transfers/transfer.routes.js';
import { TransferService } from './transfers/transfer.service.js';

export function createApp(db: Db): express.Express {
  const accountRepository = new AccountRepository(db);
  const transactionRepository = new TransactionRepository(db);
  const accountService = new AccountService(accountRepository);
  const transactionService = new TransactionService(db, accountRepository, transactionRepository);
  const transferService = new TransferService(db, accountRepository, transactionService);

  const app = express();
  app.disable('x-powered-by');
  // Non-strict parsing accepts any JSON value, so a body like `42` gets the precise
  // "Request body must be a JSON object" validation error instead of "malformed JSON".
  app.use(express.json({ strict: false }));

  app.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  app.use(accountRoutes(accountService));
  app.use(transactionRoutes(transactionService));
  app.use(transferRoutes(transferService));
  app.use(docsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
