# CALO Reports Hub — Project Context

> This file is read by Claude Code automatically when working in this project.

## Quick Reference

- **GitHub**: https://github.com/Moath3/calo-reports-hub.git
- **Branch**: `master`
- **Deployment**: Render.com (free tier, auto-deploys on push)
- **Local dev**: `npm run dev` (runs server:3001 + client:5173 concurrently)
- **Build**: `npm run build` → `client/dist/`
- **Node.js PATH (Windows)**: `export PATH="/c/Program Files/nodejs:$PATH"` (required in Claude Code bash)

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite 6, TailwindCSS 3, Lucide React, React Hot Toast, React Router 6, Chart.js 4, react-dropzone, date-fns |
| Backend | Node.js (ESM), Express 4, sql.js (SQLite), JWT, Multer, Helmet, CORS, express-rate-limit, bcryptjs, xlsx, sanitize-html |
| AI | Google Gemini 2.0 Flash, Anthropic Claude Sonnet 4.5, Perplexity Sonar Pro |
| Database | SQLite via sql.js, file at `server/data/calo-reports.db`, auto-saves every 30s |
| Deploy | Render.com via `render.yaml` |

---

## Environment Variables (.env — NOT committed)

```
PORT=3001
NODE_ENV=development
JWT_SECRET=<secret>
COMPANY_REG_CODE=CALO2026
GEMINI_API_KEY=<key>
CLAUDE_API_KEY=<key>
PERPLEXITY_API_KEY=<key>
DEFAULT_AI_PROVIDER=gemini
NETLIFY_ACCESS_TOKEN=<token>
MAX_FILE_SIZE_MB=25
RESEND_API_KEY=<key>
ADMIN_EMAIL=<email>
```

---

## Project Structure

```
calo-report-platform/
├── package.json              # Root workspace (concurrently for dev)
├── .env                      # API keys (gitignored)
├── render.yaml               # Render.com deploy config
├── CLAUDE.md                 # This file
│
├── client/                   # React + Vite frontend
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx          # Entry: AuthProvider + BrowserRouter
│       ├── App.jsx           # Routes + Layout wrapper
│       ├── index.css          # Tailwind + custom utility classes
│       ├── contexts/
│       │   └── AuthContext.jsx  # User state, login/register/logout, pending approval
│       ├── components/
│       │   └── Layout.jsx     # Sidebar nav (5 items), mobile drawer, user menu
│       ├── utils/
│       │   └── api.js         # ApiClient class (27 methods, JWT bearer auth)
│       └── pages/
│           ├── LoginPage.jsx          # Login + register with pending approval flow
│           ├── DashboardPage.jsx      # Stats cards, recent reports, AI usage, admin overview
│           ├── NewReportPage.jsx      # 3-step wizard: Upload → Configure → Generate
│           ├── ReportEditorPage.jsx   # Visual block editors + AI chat (718 lines, main file)
│           ├── ReportPreviewPage.jsx  # Preview, export HTML/PDF, Netlify deploy
│           ├── ReportsListPage.jsx    # List, filter, search reports
│           ├── TemplatesPage.jsx      # Browse, use, create templates
│           └── SettingsPage.jsx       # Profile, password, admin user management
│
├── server/                   # Node.js/Express backend (ESM)
│   ├── package.json
│   └── src/
│       ├── index.js           # Express app setup, middleware, route mounting, static serve
│       ├── middleware/
│       │   └── auth.js        # requireAuth JWT middleware
│       ├── db/
│       │   ├── database.js    # sql.js DbWrapper, schema init, file persistence
│       │   └── seedTemplates.js  # Default templates + admin user seeder
│       ├── routes/
│       │   ├── auth.js        # /api/auth — login, register, me, profile, password, users, toggle
│       │   ├── upload.js      # /api/upload — file upload via multer + fileParser
│       │   ├── ai.js          # /api/ai — analyze, chat (with structured updates), refine, providers
│       │   ├── reports.js     # /api/reports — CRUD, status, shared
│       │   ├── templates.js   # /api/templates — CRUD, categories, use
│       │   ├── export.js      # /api/export — HTML, PDF, Netlify deploy
│       │   └── dashboard.js   # /api/dashboard — stats, AI usage
│       └── services/
│           ├── aiService.js   # callAI dispatcher, 3 provider functions, 3 system prompts, extractJSON
│           ├── htmlBuilder.js # buildStandaloneHTML — 8 block types + chart rendering
│           ├── fileParser.js  # Excel, CSV, JSON, text parsing with column statistics
│           └── emailService.js  # Resend API for admin notifications
│
└── data/                     # Auto-created, gitignored
    └── calo-reports.db       # SQLite database file
```

---

## Database Schema

6 tables, 10 indexes:

```sql
users        — id, email, name, password_hash, role(employee/admin), avatar_url, department, created_at, last_login, is_active(0=pending/1=active)
reports      — id, user_id(FK), title, description, report_data(JSON), report_html, source_filename, source_data, ai_provider, status(draft/published), tags(JSON), netlify_url, created_at, updated_at
templates    — id, user_id(FK), name, description, category, template_data(JSON), preview_thumbnail, is_default, is_shared, usage_count, created_at, updated_at
audit_log    — id(auto), user_id(FK), action, resource_type, resource_id, details, ip_address, created_at
ai_usage     — id(auto), user_id(FK), provider, tokens_in, tokens_out, request_type(analyze/chat/refine), duration_ms, created_at
sessions     — id, user_id(FK), token_hash, expires_at, created_at
```

---

## API Endpoints

### Auth `/api/auth` (rate: 20/15min)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/login` | email + password → JWT token + user |
| POST | `/register` | name, email, password, companyCode → pending or active |
| GET | `/me` | Current user profile |
| PUT | `/profile` | Update name, department, avatar_url |
| PUT | `/password` | Change password |
| GET | `/users` | Admin: list all users |
| PATCH | `/users/:id/toggle` | Admin: toggle is_active |

### Upload `/api/upload`
| POST | `/` | Multipart file → parsed data (Excel/CSV/JSON/text) |

### AI `/api/ai` (rate: 10/min)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/analyze` | dataSummary, provider, customPrompt → full report JSON |
| POST | `/chat` | message, reportContext, provider, history → `{ response, message, updates }` |
| POST | `/refine` | reportData, sectionIndex, instruction, provider → updated section JSON |
| GET | `/providers` | List available AI providers |

### Reports `/api/reports`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List (pagination, search, status filter) |
| GET | `/:id` | Get single report |
| POST | `/` | Create report |
| PUT | `/:id` | Update report |
| DELETE | `/:id` | Delete report |
| PATCH | `/:id/status` | Update status (draft/published) |
| GET | `/shared/all` | List published reports |

### Templates `/api/templates`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List (category filter) |
| GET | `/categories` | All categories |
| GET | `/:id` | Get template |
| POST | `/` | Create template |
| PUT | `/:id` | Update template |
| DELETE | `/:id` | Delete template |
| POST | `/:id/use` | Increment usage, return data |

### Export `/api/export`
| POST | `/html` | reportData, brandColor, title → standalone HTML |
| POST | `/pdf` | html → PDF blob |
| POST | `/netlify` | html, siteName, netlifyToken → deploy |

### Dashboard `/api/dashboard`
| GET | `/stats` | Reports count, drafts, published, templates, AI usage |

---

## Report Data Schema

```json
{
  "generalInfo": {
    "title": "string",
    "reportDate": "string",
    "companyName": "string",
    "prevMonth": "string (period note)",
    "brandColor": "#hex",
    "kpiStrip": [{ "label": "Name", "value": "123", "unit": "meals", "trend": "up|down|stable" }]
  },
  "sections": [
    {
      "title": "Section Title",
      "icon": "emoji",
      "blocks": [ /* block objects */ ]
    }
  ]
}
```

### Block Types (9 types)

| Type | Fields |
|------|--------|
| `badge` | type, label, title, subtitle, period, style (green/amber/red/blue) |
| `notes` | type, label, items[] OR content (paragraph) |
| `metrics` | type, label, items[{label, value, change, trend}] |
| `table` | type, label, headers[], rows[[]] |
| `keyvalue` | type, label, items[{key, value}] |
| `comparison` | type, label, leftTitle, rightTitle, leftRows[{key,value}], rightRows[{key,value}] |
| `callout` | type, title, value, icon, bgColor, borderColor, textColor |
| `image` | type, url, caption |
| `chart` | type, chartType (bar/line/pie/doughnut), title, labels[], datasets[{label, data[]}] |

---

## ReportEditorPage.jsx — Architecture (718 lines)

### Visual Sub-Editor Components (no JSON exposed to user)
- `MetricsEditor({ items, onChange })` — inline metric cards
- `TableEditor({ headers, rows, onChangeHeaders, onChangeRows })` — WYSIWYG table
- `KeyValueEditor({ items, onChange })` — key-value pairs
- `ComparisonEditor({ leftRows, rightRows, onChangeLeft, onChangeRight })` — dual-column
- `KpiStripEditor({ items, onChange })` — KPI grid cards
- `Field({ label, value, onChange, type })` — generic input/color

### State
```javascript
report, loading, saving, tab('sections'|'general'|'ai'),
aiMsg, aiChat[], aiLoading, showAddBlock,
aiProvider, aiProviders[], showPasteBox, pasteText,
fileInputRef, chatEndRef
```

### Key Functions
- `updateData(fn)` — immutable report_data updater
- `setGeneral(k, v)` — update generalInfo field
- `updateSection/updateBlock/removeBlock/addBlock` — section/block CRUD
- `addSection/removeSection/moveSection` — section management
- `handleSave()` — save to backend
- `handleAIResponse(res)` — parse `{ message, updates }`, merge into reportData, toast
- `handleAISend()` — send chat to `/api/ai/chat`
- `sendQuickAction(text)` — predefined AI prompts
- `handleAIFileUpload(e)` — upload + send parsed data to AI
- `handlePasteSubmit()` — paste raw data to AI
- `handleRefine(sIdx)` — section-level AI refinement

### Three Tabs
1. **Sections** — collapsible cards, block editors, add/remove/reorder, AI refine per section
2. **General Info** — metadata fields + brandColor + KpiStripEditor
3. **AI Assistant** — provider selector, chat UI, 5 quick actions, file upload, paste box

---

## AI Service (`aiService.js`)

### Providers
| Provider | Model | JSON Mode |
|----------|-------|-----------|
| Gemini | gemini-2.0-flash | `responseMimeType: "application/json"` |
| Claude | claude-sonnet-4-5-20250514 | N/A (text parsing) |
| Perplexity | sonar-pro | N/A (text parsing) |

All: timeout 90s, temp 0.3, max 8192 tokens. Return `{ text, raw, tokensIn, tokensOut }`.

### System Prompts
- `buildReportSystemPrompt(dataSummary)` — full report generation
- `buildChatSystemPrompt(reportContext)` — structured `{ message, updates }` with sparse sections array
- `buildRefineSystemPrompt(section, instruction)` — single section refinement

### Chat Flow
1. Client sends message + reportData + provider + last 6 chat messages
2. Server builds chat prompt with full block schemas + current report (8000 chars)
3. AI returns `{ message, updates }` (updates = null if just chatting)
4. Server parses with `extractJSON()`, separates message from updates
5. Client `handleAIResponse()` auto-merges updates into state, shows toast

---

## Auth Flow
- **Register**: company code `CALO2026` → pending (`is_active=0`) → admin approves
- **Login**: JWT in localStorage (`calo-token`)
- **Roles**: `employee` (default), `admin`
- **Admin seed**: `seedAdminUser()` on first run
- **Email**: Resend API notifies admin of new registrations

## Rate Limits
- General: 200 req / 15 min
- Auth: 20 req / 15 min
- AI: 10 req / 1 min

## Frontend Routes
| Path | Page | Access |
|------|------|--------|
| `/login` | LoginPage | Public |
| `/` | DashboardPage | Protected |
| `/new` | NewReportPage | Protected |
| `/reports` | ReportsListPage | Protected |
| `/reports/:id` | ReportEditorPage | Protected |
| `/reports/:id/preview` | ReportPreviewPage | Protected |
| `/templates` | TemplatesPage | Protected |
| `/settings` | SettingsPage | Protected |

---

## Git History
```
dfddbd5 Add visual block editors and enhanced AI chat for report editor
77ccc83 Add approval-based registration with email notification
8eb1fcc Add admin user seeding and role management endpoint
c185417 Fix trust proxy for Render reverse proxy
65e615b Fix Render build: include dev deps for client vite build
d0cd5c7 Fix AI integration, add default templates, fix deployment
65697d5 CALO Reports Hub - full-stack report generation platform
```

---

## Related Projects (standalone HTML generators)

### HR Report Generator
- **File**: `C:\Users\Pc Force\Downloads\CALO HR Report Generator.html`
- **Deploy dir**: `C:\Users\Pc Force\Downloads\hr-report-deploy\index.html`
- **Tech**: Single HTML file, pure JS, localStorage, Netlify deploy
- **localStorage**: `calo-hr-v2`, `calo-hr-templates`, `calo-hr-reports`, `calo-hr-netlify-token`, `calo-hr-netlify-sites`, `calo-hr-ai-key`, `calo-hr-ai-history`

### Production Report Generator
- **File**: `C:\Users\Pc Force\Downloads\CALO Production Report Generator.html`
- **Deploy dir**: `C:\Users\Pc Force\Downloads\prod-report-deploy\index.html`
- **Tech**: Single HTML file, pure JS, localStorage, Netlify deploy
- **localStorage**: `calo-prod-v2`, `calo-prod-templates`, `calo-prod-reports`, `calo-prod-netlify-token`, `calo-prod-netlify-sites`, `calo-prod-ai-key`, `calo-prod-ai-history`
- **Live**: calogrowth8-15thfeb26.netlify.app
- **Extra blocks**: comparison (side-by-side), callout (announcement box)
- **Preset**: `getPresetGrowth()` — 8 sections for KSA Market Growth Update

Both generators share: 5 tabs (Edit Data, Manage Sections, Library, Preview Report, AI Assistant), multi-provider AI (Gemini/Claude/Perplexity), Netlify integration, template system, SheetJS for Excel parsing.
