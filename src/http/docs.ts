import { readFileSync } from 'node:fs';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';

// Resolves to <project>/docs from both src/http (dev, tests) and dist/http (build).
const OPENAPI_FILE = new URL('../../docs/openapi.yaml', import.meta.url);

/** Serves the OpenAPI document at /openapi.json and Swagger UI at /docs. */
export function docsRouter(): Router {
  const document = parseYaml(readFileSync(OPENAPI_FILE, 'utf8'));
  const router = Router();

  router.get('/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.use('/docs', swaggerUi.serve, swaggerUi.setup(document, { customSiteTitle: 'Transaction Ledger API' }));

  return router;
}
