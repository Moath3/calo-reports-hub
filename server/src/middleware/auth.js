import jwt from 'jsonwebtoken';
import { getDb } from '../db/database.js';

export const BCRYPT_COST = 12;
export const DEV_JWT_SECRET = 'dev-secret-change-in-production';
export const TOKEN_TTL = '7d';
const BEARER_PREFIX = 'Bearer ';

const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(BEARER_PREFIX.length);
  try {
    const decoded = verifyToken(token);
    const db = getDb();
    const user = db.prepare('SELECT id, email, name, role, department, avatar_url, is_active FROM users WHERE id = ?').get(decoded.id);
    
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Account not found or deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired, please login again' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function auditLog(action, resourceType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) {
        try {
          const db = getDb();
          db.prepare(`
            INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            req.user?.id || null,
            action,
            resourceType,
            body?.id || req.params?.id || null,
            JSON.stringify({ method: req.method, path: req.path }),
            req.ip
          );
        } catch (e) {
          console.error('Audit log error:', e.message);
        }
      }
      return originalJson(body);
    };
    next();
  };
}
