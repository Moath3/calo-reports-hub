# CALO Reports Hub

Internal platform that turns raw data into polished, shareable reports: AI drafts a report from an uploaded spreadsheet, a visual block editor refines it, and it exports as a standalone HTML file or a published URL. Also hosts the Zelt leave-balance portal and an HR data-hygiene audit.

**Live:** https://calo-reports-hub.onrender.com

## Stack

React 18 + Vite 6 + Tailwind (client) · Express 4 + sql.js (server) · Anthropic Claude · deployed on Render.

## Develop

```bash
npm run setup                  # install root + server + client deps
cp .env.example server/.env    # then fill in values
npm run dev                    # client :5173, server :3001
```

`npm run build` builds the client; `npm start` runs the production server. No test suite — verify by building and running.

## Layout

- `client/` — React SPA (`pages/`, `components/`, `utils/api.js`)
- `server/` — Express API (`routes/`, `services/`, `db/`)
- `render.yaml` — Render deploy config

## Environment

Set in `server/.env` (dev) or the Render dashboard (prod). Required: `JWT_SECRET`, `COMPANY_REG_CODE`, `DB_DIR`, `CLAUDE_API_KEY`. Optional: `NETLIFY_ACCESS_TOKEN`, `RESEND_API_KEY` + `ADMIN_EMAIL`, `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`. See `.env.example`.

## Deploy

Push to `master` → Render auto-builds (`npm run render:build`) and deploys. State lives on a 1 GB disk at `/data`.

---

Private internal CALO project.
