import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

import { initDb, getDb, closeDb } from './db/database.js';
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/upload.js';
import aiRoutes from './routes/ai.js';
import reportRoutes from './routes/reports.js';
import templateRoutes from './routes/templates.js';
import exportRoutes from './routes/export.js';
import dashboardRoutes from './routes/dashboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Environment Validation ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const required = ['JWT_SECRET'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`[FATAL] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.JWT_SECRET === 'dev-secret-change-in-production') {
    console.error('[FATAL] JWT_SECRET is still the default dev value. Set a strong random secret.');
    process.exit(1);
  }
  // Warn about optional but recommended keys
  const recommended = ['GEMINI_API_KEY', 'CLAUDE_API_KEY', 'PERPLEXITY_API_KEY'];
  const missingOptional = recommended.filter(k => !process.env[k]);
  if (missingOptional.length) {
    console.warn(`[WARN] Missing optional env vars (AI providers): ${missingOptional.join(', ')}`);
  }
}

// Trust proxy (required for Render, Railway, Heroku etc. behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware — strict headers for production
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://api.anthropic.com", "https://api.perplexity.ai", "https://api.netlify.com"],
      frameSrc: ["'self'"],  // allow iframe for report preview
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// CORS — restrictive in production (same-origin serves frontend, deny cross-origin)
const corsOrigins = process.env.NODE_ENV === 'production'
  ? (process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : false) // false = same-origin only
  : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Stricter rate limit for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later.' }
});
app.use('/api/auth/', authLimiter);

// Stricter rate limit for AI routes
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'AI rate limit reached. Please wait a moment.' }
});
app.use('/api/ai/', aiLimiter);

// Stricter rate limit for export/netlify routes
const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Export rate limit reached. Please wait a moment.' }
});
app.use('/api/export/', exportLimiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Health check (no sensitive info exposed)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static frontend in production
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    etag: true
  }));
  app.get('*', (req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

// Error handler — never leak stack traces in production
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'File too large. Maximum size is 50MB.' });
  }
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nSIGTERM received, shutting down...');
  closeDb();
  process.exit(0);
});

// Initialize database (async for sql.js) then start server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  CALO Report AI Platform`);
    console.log(`  Server running on http://localhost:${PORT}`);
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

export default app;
