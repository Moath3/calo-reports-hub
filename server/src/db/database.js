import initSqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { seedDefaultTemplates, seedAdminUser } from './seedTemplates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Use DB_DIR env var for persistent storage (Render Disk), fallback to local for dev
const DATA_DIR = process.env.DB_DIR || join(__dirname, '..', '..', 'data');
const DB_BASENAME = 'calo-reports.db';
const DB_PATH = join(DATA_DIR, DB_BASENAME);
const BACKUP_KEEP = 7; // dated daily backups retained on the /data disk

const SAVE_DEBOUNCE_MS = 1000;
const PERIODIC_SAVE_MS = 30000;
const DAILY_MS = 24 * 60 * 60 * 1000;

const normalizeParams = (params) => params.length === 1 && Array.isArray(params[0]) ? params[0] : params;

let wrapper = null;
let saveTimer = null;
let lastSaveAt = null;
let lastSaveError = null;

// Wrapper around sql.js to match better-sqlite3 API
class DbWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  prepare(sql) {
    const db = this._db;
    return {
      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(normalizeParams(params));
        const result = stmt.step() ? stmt.getAsObject() : undefined;
        stmt.free();
        return result;
      },
      all(...params) {
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(normalizeParams(params));
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
      run(...params) {
        db.run(sql, normalizeParams(params));
        scheduleSave();
        return { changes: db.getRowsModified() };
      }
    };
  }

  exec(sql) {
    this._db.run(sql);
    scheduleSave();
  }

  pragma(pragma) {
    try {
      this._db.run(`PRAGMA ${pragma}`);
    } catch { /* some pragmas may not be supported in sql.js */ }
  }

  close() {
    saveToDisk();
    this._db.close();
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveToDisk();
    saveTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

function saveToDisk() {
  if (!wrapper) return;
  try {
    const data = wrapper._db.export();
    const buffer = Buffer.from(data);
    const tmp = DB_PATH + '.tmp';
    try {
      // Atomic on POSIX (Render): write a temp file then rename over the target,
      // so a crash mid-write can never leave a truncated/corrupt DB file.
      writeFileSync(tmp, buffer);
      renameSync(tmp, DB_PATH);
    } catch {
      // Windows can reject rename-over-existing under a file lock; fall back to
      // a direct write so a dev save is never silently lost. (Prod uses rename.)
      writeFileSync(DB_PATH, buffer);
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
    }
    lastSaveAt = Date.now();
    lastSaveError = null;
  } catch (err) {
    lastSaveError = err.message;
    console.error('Failed to save database:', err.message);
  }
}

// Exposed for callers that must persist immediately (e.g. after Zelt token rotation)
export function persistNow() {
  saveToDisk();
}

// ─── Backups & corruption recovery ───────────────────────────────────────────

function listBackups() {
  try {
    return readdirSync(DATA_DIR)
      .filter(f => f.startsWith(DB_BASENAME + '.') && f.endsWith('.bak'))
      .sort(); // dated 'YYYY-MM-DD' suffix sorts chronologically (oldest first)
  } catch { return []; }
}

// Copy the current DB to a dated .bak and keep only the newest BACKUP_KEEP.
// Runs at boot and daily, so a corrupt or accidentally-wiped DB can be restored
// from the last good day — on the same Render disk, no external service needed.
function backupDb() {
  if (!existsSync(DB_PATH)) return;
  try {
    const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    copyFileSync(DB_PATH, join(DATA_DIR, `${DB_BASENAME}.${stamp}.bak`));
    const backups = listBackups();
    while (backups.length > BACKUP_KEEP) {
      const old = backups.shift();
      try { unlinkSync(join(DATA_DIR, old)); } catch { /* ignore */ }
    }
  } catch (err) {
    console.error('DB backup failed:', err.message);
  }
}

// Open a sql.js DB from a buffer and prove it's readable (throws if corrupt).
function openValidated(SQL, buffer) {
  const d = new SQL.Database(buffer);
  d.exec('SELECT 1 FROM sqlite_master LIMIT 1'); // throws on a corrupt image
  return d;
}

// Load the DB, falling back to the newest readable backup if the main file is
// corrupt — instead of crashing the whole platform on one bad file.
function loadDbWithRecovery(SQL) {
  const tmp = DB_PATH + '.tmp';
  if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* leftover from a crashed write */ } }
  try {
    return openValidated(SQL, readFileSync(DB_PATH));
  } catch (err) {
    console.error(`Main DB file is unreadable (${err.message}) — trying backups`);
    for (const b of listBackups().reverse()) { // newest first
      try {
        const d = openValidated(SQL, readFileSync(join(DATA_DIR, b)));
        console.warn(`Recovered database from backup: ${b}`);
        return d;
      } catch { /* try the next-newest backup */ }
    }
    console.error('No readable backup — starting fresh. Corrupt file left in place at ' + DB_PATH);
    return new SQL.Database();
  }
}

// Surfaced via /api/health so a silently failing save / missing backups is detectable.
export function getDbHealth() {
  let fileSize = null;
  try { fileSize = existsSync(DB_PATH) ? statSync(DB_PATH).size : 0; } catch { /* ignore */ }
  return {
    lastSaveAt: lastSaveAt ? new Date(lastSaveAt).toISOString() : null,
    lastSaveError,
    fileSize,
    backups: listBackups().length,
  };
}

export async function initDb() {
  if (wrapper) return wrapper;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  const db = existsSync(DB_PATH) ? loadDbWithRecovery(SQL) : new SQL.Database();

  wrapper = new DbWrapper(db);
  wrapper.pragma('journal_mode = WAL');
  wrapper.pragma('foreign_keys = ON');

  initSchema();

  // Seed default templates and admin user
  try { seedDefaultTemplates(); } catch (e) { console.error('Template seed error:', e.message); }
  try { await seedAdminUser(); } catch (e) { console.error('Admin seed error:', e.message); }

  saveToDisk();

  // Take a dated backup at boot and daily thereafter (kept on the /data disk).
  backupDb();
  setInterval(backupDb, DAILY_MS);

  // Save periodically and on exit
  setInterval(saveToDisk, PERIODIC_SAVE_MS);
  process.on('exit', saveToDisk);
  process.on('SIGINT', () => { saveToDisk(); process.exit(); });
  process.on('SIGTERM', () => { saveToDisk(); process.exit(); });

  return wrapper;
}

export function getDb() {
  if (!wrapper) throw new Error('Database not initialized. Call initDb() first.');
  return wrapper;
}

function initSchema() {
  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'employee',
      avatar_url TEXT,
      department TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      report_data TEXT NOT NULL,
      report_html TEXT,
      source_filename TEXT,
      source_data TEXT,
      ai_provider TEXT,
      status TEXT DEFAULT 'draft',
      tags TEXT DEFAULT '[]',
      netlify_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'general',
      template_data TEXT NOT NULL,
      preview_thumbnail TEXT,
      is_default INTEGER DEFAULT 0,
      is_shared INTEGER DEFAULT 1,
      usage_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      request_type TEXT,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS zelt_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS zelt_oauth_states (
      state TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      consumed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS zelt_bot_session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie_jar TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS zelt_balance_snapshots (
      entity TEXT NOT NULL,
      as_of_date TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      PRIMARY KEY (entity, as_of_date)
    );
  `);

  // Create indexes individually (sql.js exec doesn't support multiple statements well with IF NOT EXISTS)
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)',
    'CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category)',
    'CREATE INDEX IF NOT EXISTS idx_templates_shared ON templates(is_shared)',
    'CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)',
    'CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)',
  ];
  for (const idx of indexes) {
    try { wrapper._db.run(idx); } catch { /* ignore if exists */ }
  }

  // Migrations — add columns that may not exist in older databases
  const migrations = [
    "ALTER TABLE reports ADD COLUMN visibility TEXT DEFAULT 'private'",
    "ALTER TABLE reports ADD COLUMN netlify_site_id TEXT",
    "ALTER TABLE reports ADD COLUMN shared_with TEXT DEFAULT '[]'",
  ];
  for (const m of migrations) {
    try { wrapper._db.run(m); } catch { /* column already exists, ignore */ }
  }

  // Index for visibility queries
  try { wrapper._db.run('CREATE INDEX IF NOT EXISTS idx_reports_visibility ON reports(visibility)'); } catch {}
}

export function closeDb() {
  if (wrapper) {
    wrapper.close();
    wrapper = null;
  }
}
