import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';
import { generateToken, requireAuth, requireAdmin, BCRYPT_COST } from '../middleware/auth.js';
import { notifyAdminNewRegistration } from '../services/emailService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, unauthorized, forbidden, notFound, conflict } from '../utils/httpError.js';

const router = Router();

const MIN_PASSWORD_LENGTH = 8;

// Company email domains that may self-register and get immediate employee
// access. Configurable via ALLOWED_EMAIL_DOMAINS (comma-separated); defaults to
// calo.app. This domain gate replaces the old company-registration code.
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'calo.app')
  .split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
const emailDomain = (email) => String(email || '').toLowerCase().split('@')[1] || '';
const isAllowedDomain = (email) => ALLOWED_EMAIL_DOMAINS.includes(emailDomain(email));

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name, department } = req.body;

  if (!email || !password || !name) throw badRequest('Email, password, and name are required');
  if (password.length < MIN_PASSWORD_LENGTH) throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) throw badRequest('Invalid email format');

  // Gate on company email domain — anyone with a @calo.app address gets in.
  if (!isAllowedDomain(email)) {
    throw forbidden(`Registration is limited to ${ALLOWED_EMAIL_DOMAINS.map((d) => '@' + d).join(' / ')} email addresses.`);
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) throw conflict('Email already registered');

  const salt = await bcrypt.genSalt(BCRYPT_COST);
  const passwordHash = await bcrypt.hash(password, salt);

  // First user is admin; everyone else is an employee. Company-domain emails
  // are auto-approved (active immediately) — no pending queue.
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const isFirstUser = userCount.count === 0;
  const role = isFirstUser ? 'admin' : 'employee';
  const isActive = 1;

  const id = uuid();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, department, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, email.toLowerCase(), name, passwordHash, role, department || null, isActive);

  const user = { id, email: email.toLowerCase(), name, role, department };
  const token = generateToken(user);
  res.status(201).json({
    message: 'Account created successfully',
    user,
    token,
  });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw badRequest('Email and password are required');

  const db = getDb();

  // Company-domain emails are auto-approved, so an inactive account means an
  // admin deactivated it (not a pending queue).
  const anyUser = db.prepare('SELECT id, is_active FROM users WHERE email = ?').get(email.toLowerCase());
  if (anyUser && !anyUser.is_active) {
    throw forbidden('Your account has been deactivated. Contact an administrator.', { deactivated: true });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase());
  if (!user) throw unauthorized('Invalid email or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw unauthorized('Invalid email or password');

  // Update last login
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  const token = generateToken(user);

  // Audit log
  db.prepare(`
    INSERT INTO audit_log (user_id, action, resource_type, details, ip_address)
    VALUES (?, 'login', 'auth', ?, ?)
  `).run(user.id, JSON.stringify({ email: user.email }), req.ip);

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      avatar_url: user.avatar_url
    },
    token
  });
}));

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { name, department, avatar_url } = req.body;
  const db = getDb();

  db.prepare(`
    UPDATE users SET name = COALESCE(?, name), department = COALESCE(?, department), avatar_url = COALESCE(?, avatar_url)
    WHERE id = ?
  `).run(name || null, department || null, avatar_url || null, req.user.id);

  const updated = db.prepare('SELECT id, email, name, role, department, avatar_url FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: updated });
}));

// PUT /api/auth/password
router.put('/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw badRequest('Current and new password required');
  if (newPassword.length < MIN_PASSWORD_LENGTH) throw badRequest(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);

  const db = getDb();
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw unauthorized('Current password is incorrect');

  const salt = await bcrypt.genSalt(BCRYPT_COST);
  const hash = await bcrypt.hash(newPassword, salt);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

  res.json({ message: 'Password updated successfully' });
}));

// GET /api/auth/users (admin only)
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, email, name, role, department, created_at, last_login, is_active FROM users ORDER BY created_at DESC').all();
  res.json({ users });
});

// PATCH /api/auth/users/:id/role (admin only - change role)
router.patch('/users/:id/role', requireAuth, requireAdmin, asyncHandler((req, res) => {
  const { role } = req.body;
  if (!['admin', 'employee'].includes(role)) throw badRequest('Invalid role');
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw notFound('User not found');
  if (user.id === req.user.id && role !== 'admin') {
    throw badRequest('Cannot demote yourself — ask another admin');
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ message: `User role updated to ${role}` });
}));

// PATCH /api/auth/users/:id/toggle (admin only - activate/deactivate)
router.patch('/users/:id/toggle', requireAuth, requireAdmin, asyncHandler((req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw notFound('User not found');
  if (user.id === req.user.id) throw badRequest('Cannot deactivate yourself');

  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(user.is_active ? 0 : 1, user.id);
  res.json({ message: `User ${user.is_active ? 'deactivated' : 'activated'}` });
}));

// DELETE /api/auth/users/:id (admin only — remove a user completely)
// Their reports & templates are REASSIGNED to the removing admin so nothing is
// lost; their logs/sessions/AI-usage rows are deleted (FKs are enforced, no
// cascade). Guards: can't remove yourself or the last remaining admin.
router.delete('/users/:id', requireAuth, requireAdmin, asyncHandler((req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw notFound('User not found');
  if (user.id === req.user.id) throw badRequest('Cannot remove yourself — ask another admin');
  if (user.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get();
    if (admins.n <= 1) throw badRequest('Cannot remove the last admin');
  }

  // Preserve assets: hand the removed user's reports & templates to the admin.
  const reassigned = db.prepare('UPDATE reports SET user_id = ? WHERE user_id = ?').run(req.user.id, user.id);
  db.prepare('UPDATE templates SET user_id = ? WHERE user_id = ?').run(req.user.id, user.id);
  // Drop the removed user's own log/session/usage rows (not assets).
  for (const tbl of ['ai_usage', 'sessions', 'audit_log']) {
    try { db.prepare(`DELETE FROM ${tbl} WHERE user_id = ?`).run(user.id); } catch { /* table may not exist */ }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

  try {
    db.prepare(`INSERT INTO audit_log (user_id, action, resource_type, details, ip_address) VALUES (?, 'user.removed', 'auth', ?, ?)`)
      .run(req.user.id, JSON.stringify({ removedUserId: user.id, reportsReassigned: reassigned.changes ?? null }), req.ip);
  } catch { /* audit is best-effort */ }
  res.json({ message: 'User removed', reportsReassigned: reassigned.changes ?? 0 });
}));


// GET /api/auth/users-for-share — List active users for sharing UI (any authenticated user)
router.get('/users-for-share', requireAuth, asyncHandler((req, res) => {
  const db = getDb();
  const users = db.prepare(
    'SELECT id, name, email, department FROM users WHERE is_active = 1 AND id != ? ORDER BY name ASC'
  ).all(req.user.id);
  res.json({ users });
}));

export default router;
