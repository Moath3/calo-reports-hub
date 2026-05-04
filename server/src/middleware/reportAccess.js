import { getDb } from '../db/database.js';
import { notFound, forbidden } from '../utils/httpError.js';

// Loads the report at :id into req.report. Returns 404 if missing.
// By default fetches only `user_id` (cheap ownership lookup).
// Pass { full: true } to fetch the full row + author_name (for GET /:id reads).
export function loadReport({ full = false } = {}) {
  return (req, res, next) => {
    const db = getDb();
    const sql = full
      ? 'SELECT r.*, u.name as author_name FROM reports r JOIN users u ON r.user_id = u.id WHERE r.id = ?'
      : 'SELECT user_id FROM reports WHERE id = ?';
    const report = db.prepare(sql).get(req.params.id);
    if (!report) return next(notFound('Report not found'));
    req.report = report;
    next();
  };
}

// Ownership gate. Must run after loadReport().
// Default is strict ownership; pass { adminOk: true } to also allow admins
// (used by DELETE /:id). The custom message preserves existing endpoint copy.
export function requireReportOwner({ adminOk = false, message = 'Access denied' } = {}) {
  return (req, res, next) => {
    const isOwner = req.report.user_id === req.user.id;
    const isAdmin = adminOk && req.user.role === 'admin';
    if (!isOwner && !isAdmin) return next(forbidden(message));
    next();
  };
}
