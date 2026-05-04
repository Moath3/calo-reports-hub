// Typed error for route handlers. The central error handler in index.js
// reads `status` and merges `extra` fields (e.g. { pending: true }) into the
// JSON response body alongside { error: message }.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest   = (msg, extra) => new HttpError(400, msg, extra);
export const unauthorized = (msg = 'Authentication required', extra) => new HttpError(401, msg, extra);
export const forbidden    = (msg = 'Access denied', extra) => new HttpError(403, msg, extra);
export const notFound     = (msg = 'Not found', extra) => new HttpError(404, msg, extra);
export const conflict     = (msg, extra) => new HttpError(409, msg, extra);
export const unprocessable = (msg, extra) => new HttpError(422, msg, extra);
