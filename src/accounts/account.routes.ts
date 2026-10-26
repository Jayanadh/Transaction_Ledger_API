import { Router } from 'express';
import { parse, parseIdParam } from '../http/validation.js';
import { createAccountSchema } from './account.schemas.js';
import type { AccountService } from './account.service.js';

export function accountRoutes(accounts: AccountService): Router {
  const router = Router();

  router.post('/accounts', (req, res) => {
    const input = parse(createAccountSchema, req.body, 'body');
    res.status(201).json({ data: accounts.createAccount(input) });
  });

  router.get('/accounts/:accountId', (req, res) => {
    const accountId = parseIdParam('account_id', req.params.accountId);
    res.json({ data: accounts.getAccount(accountId) });
  });

  router.get('/accounts/:accountId/balance', (req, res) => {
    const accountId = parseIdParam('account_id', req.params.accountId);
    res.json({ data: accounts.getBalance(accountId) });
  });

  return router;
}
