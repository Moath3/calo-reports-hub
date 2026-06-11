import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

import { initDb, closeDb, getDbHealth } from './db/database.js';
import { HttpError } from './utils/httpError.js';
import { getStatus as getZeltOauthStatus, drainRefresh as drainZeltRefresh } from './services/zeltApi.js';
import { warmSession as warmZeltSession, getBotStatus as getZeltBotStatus } from './services/zeltBot.js';
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/upload.js';
import aiRoutes from './routes/ai.js';
import reportRoutes from './routes/reports.js';
import templateRoutes from './routes/templates.js';
import exportRoutes from './routes/export.js';
import dashboardRoutes from './routes/dashboard.js';
import zeltRoutes from './routes/zelt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Environment Validation ────────────────────────────────────────────────
if (IS_PROD) {
  const missing = ['JWT_SECRET'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`[FATAL] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.JWT_SECRET === 'dev-secret-change-in-production') {
    console.error('[FATAL] JWT_SECRET is still the default dev value. Set a strong random secret.');
    process.exit(1);
  }
  if (!process.env.CLAUDE_API_KEY) {
    console.warn('[WARN] CLAUDE_API_KEY is not set — all AI features will be disabled.');
  }
}

// Trust proxy (required for Render, Railway, Heroku etc. behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
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
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// CORS — same-origin only in prod unless FRONTEND_URL is set
app.use(cors({
  origin: IS_PROD
    ? (process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : false)
    : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const MIN = 60 * 1000;
const makeLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { error: message },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/',        makeLimiter(15 * MIN, 200, 'Too many requests, please try again later.'));
app.use('/api/auth/',   makeLimiter(15 * MIN,  20, 'Too many login attempts, please try again later.'));
app.use('/api/ai/',     makeLimiter(     MIN,  10, 'AI rate limit reached. Please wait a moment.'));
app.use('/api/export/', makeLimiter(     MIN,   5, 'Export rate limit reached. Please wait a moment.'));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API routes
const apiRoutes = [
  ['/api/auth',      authRoutes],
  ['/api/upload',    uploadRoutes],
  ['/api/ai',        aiRoutes],
  ['/api/reports',   reportRoutes],
  ['/api/templates', templateRoutes],
  ['/api/export',    exportRoutes],
  ['/api/dashboard', dashboardRoutes],
  ['/api/zelt',      zeltRoutes],
];
for (const [path, router] of apiRoutes) app.use(path, router);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: getDbHealth(),
    zelt: {
      oauth: getZeltOauthStatus(),
      bot: getZeltBotStatus(),
    },
  });
});

// Serve static frontend in production
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, {
    maxAge: IS_PROD ? '1d' : 0,
    etag: true
  }));
  app.get('*', (req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

// Error handler — never leak stack traces in production
app.use((err, req, res, next) => {
  // 4xx HttpErrors are expected client errors — already in the response, no need to log as [Error]
  const isClientError = err instanceof HttpError && err.status < 500;
  if (!isClientError) console.error('[Error]', err.message);

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'File too large. Maximum size is 50MB.' });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  res.status(err.status || 500).json({
    error: IS_PROD ? 'Internal server error' : err.message
  });
});

// Graceful shutdown — await any in-flight Zelt refresh first so a deploy
// mid-refresh doesn't strand a rotated refresh token. 5s cap so we never
// hang the process indefinitely on a stuck network call.
const shutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down...`);
  try {
    await Promise.race([
      drainZeltRefresh(),
      new Promise(r => setTimeout(r, 5000)),
    ]);
  } catch (e) {
    console.warn('[shutdown] zelt drain error:', e.message);
  }
  closeDb();
  process.exit(0);
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Initialize database (async for sql.js) then start server
initDb().then(() => {
  // Warm the Zelt bot session from persisted cookie + start heartbeat. Without
  // this, the heartbeat doesn't run until the first user request triggers a
  // lazy login, so a freshly deployed build serves the first user a re-login.
  try { warmZeltSession(); } catch (e) { console.warn('[zelt-bot] warmSession failed:', e.message); }

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
