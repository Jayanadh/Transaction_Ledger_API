import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { AppError } from '../errors.js';

function sendError(res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ error: details === undefined ? { code, message } : { code, message, details } });
}

/** Errors raised by `express.json()` carry a `type` such as `entity.parse.failed` and an HTTP status. */
function isBodyParserError(err: unknown): err is Error & { type: string; status: number } {
  return (
    err instanceof Error &&
    typeof (err as { type?: unknown }).type === 'string' &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`);
};

/** Renders every error in the same `{ error: { code, message, details? } }` shape. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }

  if (isBodyParserError(err) && err.status < 500) {
    if (err.type === 'entity.parse.failed') {
      sendError(res, 400, 'INVALID_JSON', 'Request body contains malformed JSON');
    } else if (err.type === 'entity.too.large') {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    } else {
      sendError(res, err.status, 'INVALID_REQUEST_BODY', err.message);
    }
    return;
  }

  // Anything else is a bug or an infrastructure failure: log it, but never leak internals to the client.
  console.error(err);
  sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
};
