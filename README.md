# CALO Reports Hub

An internal platform for building polished, shareable reports from raw data. Upload a spreadsheet, let AI draft a structured report, refine it in a visual block editor, then export it as a standalone HTML page or publish it to a live URL. Also hosts CALO's HR tooling: a live Zelt leave-balance portal and a data-hygiene audit.

Live: https://calo-reports-hub.onrender.com

---

## What it does

- **AI report generation** — upload Excel / CSV / JSON / text; Anthropic Claude analyzes it and produces a full report (KPIs, sections, charts, an executive summary, and insights).
- **Visual block editor** — 10 block types (badge, notes, metrics, table, key-value, comparison, callout, image, chart, link) arranged into sections.
- **Four layout variants** — editorial, dashboard, minimal, and brief — switchable per report without changing the content.
- **AI chat assistant** — iterate on a report in plain language; changes are merged into the live document.
- **Templates** — start from a saved structure (HR and Production templates ship by default).
- **Sharing** — keep a report private, share it with everyone, or share with specific users.
- **Export & publish** — download a self-contained HTML file, optionally **password-protected** (the body is AES-256-GCM encrypted, not just hidden), or one-click publish to a Netlify URL.
- **Zelt HR integration** — a live leave-balance portal (multi-entity, as-of-date lookups, CSV export) and a data-hygiene audit over the HRIS.

## Tech stack

| Layer | Stack |
|-------|-------|
| Frontend | React 18, Vite 6, TailwindCSS 3, React Router 6 |
| Backend | Express 4 (ESM), sql.js (SQLite) with atomic writes + daily backups |
| AI | Anthropic Claude (Opus + Sonnet) via the Messages API |
| Hosting | Render.com (single web service + 1 GB persistent disk) |

## Architecture

A full-stack monorepo. In development, Vite serves the client and proxies `/api` to Express. In production, Express serves the built client (`client/dist`) as static files and handles the API on the same origin.

```
calo-report-platform/
├── client/                 # React SPA
│   └── src/
│       ├── pages/          # one component per route (editor, preview, reports, settings, Zelt…)
│       ├── components/     # shared UI
│       ├── contexts/       # AuthContext (JWT)
│       └── utils/api.js    # ApiClient — all API calls
├── server/                 # Express API (ESM)
│   └── src/
│       ├── routes/         # auth, reports, templates, upload, export, ai, dashboard, zelt
│       ├── services/       # aiService, htmlBuilder, fileParser, email, zelt*
│       ├── middleware/     # auth + report-access guards
│       └── db/             # sql.js wrapper, schema, seed data
├── render.yaml             # Render deploy config
└── package.json            # root scripts (run client + server together)
```

The database is an in-memory SQLite image (sql.js) persisted to a single file on the Render disk. Writes are flushed atomically (temp file + rename) with a dated daily backup and automatic recovery from the last good backup if the main file is ever unreadable.

## Getting started

**Prerequisites:** Node.js 20+ and npm.

```bash
# Install root, server, and client dependencies
npm run setup

# Copy the example env and fill in values (see below)
cp .env.example server/.env

# Run client (http://localhost:5173) + server (http://localhost:3001) together
npm run dev
```

Other scripts:

```bash
npm run build          # build the client for production
npm start              # start the production server (serves client/dist + API)
npm run render:build   # build used by Render
```

> On Windows, if Node isn't on PATH in Git Bash:
> `export PATH="/c/Program Files/nodejs:$PATH"`

There is no automated test suite. Verify changes by building (`npm run build`) and checking the running app.

## Environment variables

Set these in `server/.env` for local dev, or in the Render dashboard for production. Real values are never committed.

**Core**

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3001) |
| `NODE_ENV` | `development` or `production` |
| `JWT_SECRET` | Required in production — signs auth tokens |
| `COMPANY_REG_CODE` | Code required to register a new account |
| `DB_DIR` | Directory for the SQLite file + backups (e.g. `/data` on Render) |

**AI & integrations**

| Variable | Purpose |
|----------|---------|
| `CLAUDE_API_KEY` | Anthropic API key — enables report generation and chat |
| `NETLIFY_ACCESS_TOKEN` | Enables one-click publish |
| `RESEND_API_KEY` / `ADMIN_EMAIL` | Email notifications (e.g. new-registration alerts) |
| `MAX_FILE_SIZE_MB` | Upload size limit (default 25) |
| `FRONTEND_URL` | Production CORS origin (optional; same-origin by default) |

**Admin bootstrap** (optional — seeds the first admin account)

| Variable | Purpose |
|----------|---------|
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Seed an admin at boot; leave unset to skip |
| `SEED_ADMIN_FORCE_PASSWORD` | One-time: set `true` to rotate the existing admin's password, then unset |

Zelt HR integration uses additional variables for OAuth tokens and cookie encryption.

## Authentication

- Registration requires the company code (`COMPANY_REG_CODE`) and lands in a pending state until an admin approves it.
- Auth is a JWT (7-day expiry) stored client-side; roles are `employee` and `admin`.
- Admins approve or deactivate users from the Settings page.

## Deployment

Hosted on Render via `render.yaml`. Pushing to `master` triggers an automatic build (`npm run render:build`) and deploy. State lives on a 1 GB persistent disk mounted at `/data`.

## Security notes

- Report content is HTML-escaped throughout the output pipeline (no stored XSS in previews, exports, or published pages).
- Password-protected exports encrypt the report body with AES-256-GCM (PBKDF2 key from the access code) — the content is never present in page source.
- Publishing is restricted to a report's owner (or an admin), and the published HTML is rebuilt server-side from stored data.
- Admin credentials are sourced from environment variables, never hardcoded.

---

Internal CALO project. Private repository.
