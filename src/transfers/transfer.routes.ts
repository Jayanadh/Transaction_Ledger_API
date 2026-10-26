import { Router } from 'express';
import { parse } from '../http/validation.js';
import { createTransferSchema } from './transfer.schemas.js';
import type { TransferService } from './transfer.service.js';

export function transferRoutes(transfers: TransferService): Router {
  const router = Router();

  router.post('/transfers', (req, res) => {
    const input = parse(createTransferSchema, req.body, 'body');
    res.status(201).json({ data: transfers.createTransfer(input) });
  });

  return router;
}
