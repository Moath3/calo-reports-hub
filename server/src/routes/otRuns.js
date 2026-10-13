// Saved OT calculator runs — shared history (draft/final), HR/admin only.
// Stores per-employee summary + totals (amounts, NOT raw basic pay).
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth, requireHrOrAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound, conflict } from '../utils/httpError.js';
import { listOtRuns, getOtRun, createOtRun, updateOtRun, finalizeOtRun, deleteOtRun } from '../db/database.js';

const router = Router();
const safe = (s, f) => { try { return JSON.parse(s); } catch { return f; } };
const parse = (row) => (row ? { ...row, totals: safe(row.totals, {}), rules: safe(row.rules, {}), data: safe(row.data, []) } : row);
const meta = (row) => ({ ...row, totals: safe(row.totals, {}) });

// List saved runs (metadata only — no per-employee blob).
router.get('/', requireAuth, requireHrOrAdmin, asyncHandler((req, res) => {
  res.json({ runs: listOtRuns().map(meta) });
}));

// One run, full (per-employee data included).
router.get('/:id', requireAuth, requireHrOrAdmin, asyncHandler((req, res) => {
  const row = getOtRun(req.params.id);
  if (!row) throw notFound('Run not found');
  res.json(parse(row));
}));

// Save a new run (status draft).
router.post('/', requireAuth, requireHrOrAdmin, asyncHandler((req, res) => {
  const b = req.body || {};
  if (!b.company) throw badRequest('company is required');
  const id = randomUUID();
  const row = createOtRun({
    id, company: b.company, company_name: b.company_name, currency: b.currency,
    label: (b.label || `${b.company_name || b.company} ${b.period_from || ''}`).trim(),
    period_from: b.period_from, period_to: b.period_to, status: 'draft',
    source_file: b.source_file, master_file: b.master_file,
    totals: JSON.stringify(b.totals || {}), rules: JSON.stringify(b.rules || {}), data: JSON.stringify(b.data || []),
    created_by: req.user.id, created_by_name: req.user.name || req.user.email,
  });
  res.json(parse(row));
}));

// Overwrite a DRAFT (finalized runs are locked).
router.put('/:id', requireAuth, requireHrOrAdmin, asyncHandler((req, res) => {
  const row = getOtRun(req.params.id);
  if (!row) throw notFound('Run not found');
  if (row.status === 'final') throw conflict('This run is finalized and cannot be edited.');
  const b = req.body || {};
  const updated = updateOtRun(req.params.id, {
    label: b.label ?? row.label,
    totals: JSON.stringify(b.totals ?? safe(row.totals, {})),
    rules: JSON.stringify(b.rules ?? safe(row.rules, {})),
    data: JSON.stringify(b.data ?? safe(row.data, [])),
    source_file: b.source_file ?? row.source_file, master_file: b.master_file ?? row.master_file,
    period_from: b.period_from ?? row.period_from, period_to: b.period_to ?? row.period_to,
    company: b.company ?? row.company, company_name: b.company_name ?? row.company_name, currency: b.currency ?? row.currency,
  });
  res.json(parse(updated));
}));

// Lock a run (draft → final).
router.post('/:id/finalize', requireAuth, requireHrOrAdmin, asyncHandler((req, res) => {
  const row = getOtRun(req.params.id);
  if (!row) throw notFound('Run not found');
  res.json(parse(finalizeOtRun(req.params.id)));
}));

// Delete a DRAFT (finalized runs are locked).
router.delete('/:id', requireAuth, requireHrOrAdmin, asyncHandler((req, res) => {
  const row = getOtRun(req.params.id);
  if (!row) throw notFound('Run not found');
  if (row.status === 'final') throw conflict('Finalized runs cannot be deleted.');
  res.json({ deleted: deleteOtRun(req.params.id) });
}));

export default router;
