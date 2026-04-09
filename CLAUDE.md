# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# IMPORTANT: On Windows, always set Node.js PATH first
export PATH="/c/Program Files/nodejs:$PATH"

# Development (runs server:3001 + client:5173 concurrently)
npm run dev

# Build client for production
npm run build

# Start production server (serves client/dist + API)
npm start

# Install all dependencies (root + server + client)
npm run setup

# Render.com deploy build
npm run render:build

# Server-only dev (with --watch)
npm run dev:server

# Client-only dev (vite)
npm run dev:client
```

No test suite exists. Verify changes by building (`npm run build`) and checking the live site after push.

## Architecture

Full-stack monorepo: React 18 + Vite 6 frontend, Express 4 + sql.js backend, deployed to Render.com (auto-deploys on push to master).

**Frontend** (`client/src/`): React Router 6 SPA with TailwindCSS 3. Auth state via `contexts/AuthContext.jsx` (JWT in localStorage `calo-token`). All API calls through `utils/api.js` (ApiClient class, ~30 methods, Bearer token auth). Pages are in `pages/`, one component per route.

**Backend** (`server/src/`): ESM modules. Express routes in `routes/`, business logic in `services/`. Auth via JWT middleware (`middleware/auth.js` — `requireAuth`, `requireAdmin`). Database is sql.js (in-memory SQLite with file persistence to `DB_DIR/calo-reports.db`, auto-saves every 30s).

**Data flow**: Vite proxies `/api` to Express in dev. In production, Express serves `client/dist/` as static files with SPA fallback.

### Key Files

| File | Purpose |
|------|---------|
| `server/src/services/aiService.js` | Multi-provider AI dispatcher (Gemini/Claude/Perplexity), system prompts, JSON extraction |
| `client/src/pages/ReportEditorPage.jsx` | Main editor (~800 lines) — visual block editors, section management, AI chat tab |
| `client/src/pages/ReportPreviewPage.jsx` | Preview, export, Netlify publish, sharing panel |
| `server/src/db/database.js` | sql.js wrapper (mimics better-sqlite3 API), schema init, migrations, file persistence |
| `server/src/services/htmlBuilder.js` | Standalone HTML report builder (9 block types + password protection) |
| `server/src/services/fileParser.js` | Excel/CSV/JSON/text parser with column statistics |

### Report Data Model

Reports store structured JSON in `report_data` column:
- `generalInfo`: title, reportDate, companyName, brandColor, kpiStrip[]
- `sections[]`: each has title, icon, blocks[]

**9 block types**: badge, notes, metrics, table, keyvalue, comparison, callout, image, chart

### AI Chat Pattern

The AI chat uses a structured update format:
1. Client sends: message + current reportData + provider + last 6 messages
2. Server builds system prompt with full block schemas + report context (8000 char limit)
3. AI returns `{ message, updates }` where `updates.sections` is a sparse array (null = unchanged, object = merge/create)
4. Client `handleAIResponse()` merges updates into state immutably
5. When report has no sections, AI creates them; when sections exist, AI merges changes

### Auth & Registration

- Company code `CALO2026` required to register
- First user auto-becomes admin (is_active=1); all others pending (is_active=0)
- Admin approves users via Settings page (PATCH `/users/:id/toggle`)
- JWT: 7-day expiry, stored in localStorage

### Report Sharing (3-state model)

- `private`: only owner + admin can view
- `shared`: all authenticated users can view
- `specific`: only selected users (stored in `shared_with` JSON array) can view
- PATCH `/reports/:id/share` endpoint validates user IDs against active users

## Database Schema

6 tables. Key columns beyond obvious CRUD fields:

- **reports**: `visibility` (private/shared/specific), `shared_with` (JSON user ID array), `netlify_site_id` (for republish reuse), `status` (draft/done/published/archived)
- **users**: `is_active` (0=pending, 1=approved), `role` (employee/admin)
- **ai_usage**: tracks tokens_in/out, provider, request_type, duration per call

Migrations run automatically on startup via `database.js` migrations array (ALTER TABLE statements).

## Environment Variables

```
PORT=3001                    # Server port
NODE_ENV=development         # development | production
JWT_SECRET=<secret>          # Required in production
COMPANY_REG_CODE=CALO2026    # Registration gate
DB_DIR=/data                 # Persistent disk path (Render)
GEMINI_API_KEY=<key>         # Enables Gemini provider
CLAUDE_API_KEY=<key>         # Enables Claude provider
PERPLEXITY_API_KEY=<key>     # Enables Perplexity provider
DEFAULT_AI_PROVIDER=gemini
NETLIFY_ACCESS_TOKEN=<token> # For publish feature
MAX_FILE_SIZE_MB=25
RESEND_API_KEY=<key>         # Email notifications
ADMIN_EMAIL=<email>          # Receives registration alerts
FRONTEND_URL=<url>           # Production CORS origin
```

## Rate Limits

- General: 200 req / 15 min
- Auth: 20 req / 15 min
- AI: 10 req / 1 min
- Export/Netlify: 5 req / 1 min

## Deployment

Render.com via `render.yaml`. Persistent disk at `/data` (1GB) for SQLite database. Build runs `npm run render:build` (installs server+client deps, builds client). Start runs `npm start`.

Auto-deploys on push to `master` branch. Live at: https://calo-reports-hub.onrender.com

## File Editing Notes

On this Windows machine, the Edit and Write tools sometimes fail with `EEXIST: file already exists, mkdir` errors for project subdirectories. Workarounds:
1. Write a temp `.js` script to `C:\\Users\\Pc Force\\temp-*.js` that uses `fs.writeFileSync()` to modify the target file
2. Run it with `node "C:\\Users\\Pc Force\\temp-*.js"`
3. Clean up temp files after
4. For simple single-line changes, `sed -i` works reliably

## Related Projects

Two standalone HTML report generators share the same block schema and AI patterns:
- **HR Report Generator**: `C:\\Users\\Pc Force\\Downloads\\CALO HR Report Generator.html`
- **Production Report Generator**: `C:\\Users\\Pc Force\\Downloads\\CALO Production Report Generator.html` (live: calogrowth8-15thfeb26.netlify.app)
