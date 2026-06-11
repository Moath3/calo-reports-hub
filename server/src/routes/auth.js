import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';
import { generateToken, requireAuth, requireAdmin } from '../middleware/auth.js';
import { notifyAdminNewRegistration } from '../services/emailService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, unauthorized, forbidden, notFound, conflict } from '../utils/httpError.js';

const router = Router();

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name, department, companyCode } = req.body;

  // Validate company code
  const validCode = process.env.COMPANY_REG_CODE;
  if (!validCode || companyCode !== validCode) {
    throw forbidden('Invalid company registration code. Contact your administrator.');
  }

  // Validate fields
  if (!email || !password || !name) throw badRequest('Email, password, and name are required');
  if (password.length < 8) throw badRequest('Password must be at least 8 characters');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) throw badRequest('Invalid email format');

  const db = getDb();

  // Check if email exists
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) throw conflict('Email already registered');

  // Hash password
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(password, salt);

  // Determine role - first user is admin (and auto-approved)
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const isFirstUser = userCount.count === 0;
  const role = isFirstUser ? 'admin' : 'employee';
  const isActive = isFirstUser ? 1 : 0; // New users are pending approval

  const id = uuid();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, department, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, email.toLowerCase(), name, passwordHash, role, department || null, isActive);

  // First user (admin) gets immediate access
  if (isFirstUser) {
    const user = { id, email: email.toLowerCase(), name, role, department };
    const token = generateToken(user);
    return res.status(201).json({
      message: 'Account created successfully',
      user: { id, email: email.toLowerCase(), name, role, department },
      token
    });
  }

  // All other users: pending approval — notify admin
  notifyAdminNewRegistration({ name, email: email.toLowerCase(), department }).catch(() => {});

  res.status(201).json({
    message: 'Registration submitted. Awaiting admin approval.',
    pending: true
  });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw badRequest('Email and password are required');

  const db = getDb();

  // Check if user exists but is pending approval
  const anyUser = db.prepare('SELECT id, is_active FROM users WHERE email = ?').get(email.toLowerCase());
  if (anyUser && !anyUser.is_active) {
    throw forbidden('Your account is pending admin approval. Please wait for activation.', { pending: true });
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
  if (newPassword.length < 8) throw badRequest('New password must be at least 8 characters');

  const db = getDb();
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw unauthorized('Current password is incorrect');

  const salt = await bcrypt.genSalt(12);
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


// GET /api/auth/users-for-share — List active users for sharing UI (any authenticated user)
router.get('/users-for-share', requireAuth, asyncHandler((req, res) => {
  const db = getDb();
  const users = db.prepare(
    'SELECT id, name, email, department FROM users WHERE is_active = 1 AND id != ? ORDER BY name ASC'
  ).all(req.user.id);
  res.json({ users });
}));

export default router;
