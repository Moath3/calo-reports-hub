# CALO Reports Hub — Design Review Document

A full-stack internal platform for generating, managing, and publishing branded business reports. Built for CALO's internal teams to turn raw data (Excel/CSV/JSON) into polished, shareable HTML reports with the help of AI.

**Live**: https://calo-reports-hub.onrender.com
**Repo**: https://github.com/Moath3/calo-reports-hub
**Tech**: React 18 + Vite 6 + TailwindCSS 3 (frontend) · Express 4 + sql.js (backend) · Gemini / Claude / Perplexity (AI)

---

## 1. Purpose of This Document

This file is intended for the Claude design team (or any designer / UX reviewer). It consolidates everything needed to evaluate the visual system, information architecture, and brand expression of the platform without having to spelunk the codebase.

It covers:

- Brand identity as currently applied (colors, typography, logo)
- Component and page inventory with intent
- The 9 report "block types" that define every published artifact
- Known rough edges and open design questions
- Where to push improvements

---

## 2. Brand Identity — Current Implementation

### 2.1 Primary Color

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| Primary | `#02B376` | 2, 179, 118 | Logo, primary buttons, links, section accents, chart fills |
| Dark | `#027D53` | 2, 125, 83 | Header gradient stop, button hover, footer |
| Deep | `#016040` | 1, 96, 64 | High-contrast text on light-brand backgrounds |

### 2.2 Full Palette (Tailwind Tokens)

Available as `bg-brand-{50..900}`, `text-brand-{50..900}`, `border-brand-{50..900}`:

| Step | Hex | Role |
|------|-----|------|
| 50 | `#E6F9F1` | Subtle backgrounds, callouts, row-hover |
| 100 | `#B3EED8` | Hover states, tag fills |
| 200 | `#80E3BF` | Dividers, decorative accents |
| 300 | `#4DD8A6` | Illustrations, secondary accents |
| 400 | `#26CF93` | Badges, icons |
| 500 | `#02B376` | **Primary brand green** |
| 600 | `#029A66` | Button hover |
| 700 | `#027D53` | Gradient dark stop, active state |
| 800 | `#016040` | High-contrast text |
| 900 | `#01432D` | Headings on brand backgrounds |

### 2.3 Typography

- **Font**: Lato (Google Fonts) — loaded globally via `<link>` in `client/index.html` and embedded inside every rendered standalone report HTML.
- **Weights loaded**: 300, 400, 700, 900.
- **Global application**: `html { font-family: Lato, system-ui, -apple-system, sans-serif }` + `body { font-sans }` (Tailwind → Lato).

Weight hierarchy in use:

| Weight | Where |
|--------|-------|
| 300 Light | (available, not yet used) |
| 400 Regular | Body copy, table cells, form inputs, paragraphs |
| 700 Bold | Labels, KPI values, section titles, button text |
| 900 Black | Logo wordmark (SVG paths mimic this weight), hero headlines |

### 2.4 Logo

Official CALO wordmark SVG with 4 letterform paths (`C`, `A`, `L`, `O`), viewBox `0 0 746 320`. Lives at `client/src/components/CaloLogo.jsx` and is also inlined as a string in every rendered report HTML.

**Six placements** — each size chosen deliberately:

| Location | Size | Color |
|----------|------|-------|
| App sidebar | 28px | Brand green `#02B376` |
| Login hero (desktop, left panel) | 40px | White on green gradient |
| Login mobile header | 36px | Brand green |
| Report header (published/preview) | 44px | White on gradient |
| Report password gate | 36px | Report's brand color (configurable) |
| Report footer | 18px | Gray `#9ca3af` |

**Why inline SVG everywhere**: zero external requests, crisp at any DPI, fill color driven by prop/brand-color so password gates match the report.

### 2.5 Supporting Colors (Semantic)

Used for non-brand signals — report block badges, status indicators, trends:

| Role | Hex | Usage |
|------|-----|-------|
| Success / Up | `#16a34a` | Positive trend arrows, "up" change % |
| Warning | `#F59E0B` | Amber badges, caution states |
| Error / Down | `#dc2626` | Negative trend, validation errors, destructive actions |
| Info | `#3B82F6` | Blue badges |
| Neutral | `#6b7280` | Stable trends, secondary text |

---

## 3. Visual System Primitives

Defined in `client/src/index.css` as Tailwind `@layer components`:

| Class | Purpose |
|-------|---------|
| `.btn-primary` | Brand green button, hover → 600, active scale 0.98 |
| `.btn-secondary` | White / gray border button |
| `.btn-danger` | Red destructive action |
| `.btn-ghost` | Icon-only / subtle button |
| `.card` | White 12px radius, 1px gray border, subtle shadow |
| `.card-hover` | Card + hover lift (shadow-md + border-gray-300) |
| `.input-field` | Text input: 10px radius, focus ring brand-green |
| `.label` | Form label text style |
| `.badge-{green\|amber\|red\|blue\|gray}` | Status pill badges |
| `.glass` | Backdrop-blur white/80 panel |
| `.gradient-header` | Diagonal gradient `#02B376 → #027D53` |

Custom animations:

- `fade-in` (0.3s), `slide-up` (0.3s), `slide-in` (0.3s), `pulse-slow` (3s)

---

## 4. Page Inventory & Intent

All routes live under the authenticated `<Layout>` shell except `/login`.

| Route | File | Role |
|-------|------|------|
| `/login` | `LoginPage.jsx` | Login + registration (with pending-approval flow) |
| `/` (dashboard) | `DashboardPage.jsx` | KPIs, recent reports, AI usage chart, admin overview |
| `/reports` | `ReportsListPage.jsx` | Filterable, searchable report list with status chips |
| `/reports/new` | `NewReportPage.jsx` | 3-step wizard: Upload → Configure → Generate |
| `/reports/:id` | `ReportPreviewPage.jsx` | Preview iframe, export HTML/PDF, Netlify publish, share panel |
| `/reports/:id/edit` | `ReportEditorPage.jsx` | Visual block editor + AI chat sidebar |
| `/templates` | `TemplatesPage.jsx` | Browse, use, create shared templates |
| `/guide` | `GuidePage.jsx` | In-app how-to reference |
| `/settings` | `SettingsPage.jsx` | Profile, password, admin user management |

### 4.1 Login

- Desktop: split screen — left = green gradient marketing panel with logo, headline, feature bullets; right = form card.
- Mobile: single column, logo-over-form.
- Registration flow requires company code `CALO2026`; new accounts enter pending state; admin email notified via Resend; admin approves via Settings.

### 4.2 Dashboard

- Hero KPI row: Total Reports / Drafts / Published / Templates.
- Recent reports list with quick-view links.
- AI usage breakdown by provider.
- Admin-only panel: user table with approve/reject toggle.

### 4.3 Reports List

- Grid of cards, each showing title, status chip, AI provider badge, updated date.
- Filters: status (draft/done/published), search by title, sort by date.
- Empty state: "Create your first report" CTA → `/reports/new`.

### 4.4 New Report Wizard

- **Step 1 — Upload**: large dropzone (react-dropzone), accepts `.xlsx/.xls/.csv/.json/.txt/.md/.html` up to 25MB.
- **Step 2 — Configure**: title, description, AI provider select, optional custom prompt, optional template picker.
- **Step 3 — Generating**: spinner with provider name; on success redirects to the new report's edit page.
- Alternative paths: "Start blank" button, "Import from file" only (skip AI).

### 4.5 Report Editor (most complex — 812 LOC)

Three tabs:

- **Sections** — main editing surface. Each section is collapsible, reorderable; blocks can be added via a picker (9 types). Every block type has its own visual editor (e.g. the `metrics` editor shows 4 input rows for label/value/change/trend per card).
- **General** — report-level metadata: title, date, company, brand color picker, KPI strip editor.
- **AI Assistant** — chat panel. Sends reportData + last 6 messages + selected provider. AI returns structured updates that merge into state.

Auto-save: debounced 2s after any change. "Done" status toggle next to Save.

### 4.6 Report Preview

- Full-width iframe rendering the standalone HTML (same builder used for exports).
- Right sidebar actions: Export HTML, Export PDF, Export Image (html2canvas), Publish to Netlify, Share.
- **Share panel**: 3-state (private / team / specific) with searchable user picker for "specific" mode.
- **Publish panel**: optional password protection with SHA-256-hashed gate embedded in exported HTML.

### 4.7 Templates

- Two default seeded templates: HR Performance Report, Production Performance Report.
- Each template stores the full `reportData` shape + category + share flag.
- "Use template" creates a new report pre-filled with the template's sections.

### 4.8 Settings

- Profile: name, department, avatar URL.
- Security: password change.
- Admin-only: user list with toggle-active and role management.

---

## 5. Report Block Types (9)

The core of the design system — every published report is composed of these. Defined in `server/src/services/htmlBuilder.js` and mirrored in `ReportPreviewPage.jsx`.

### 5.1 `badge`
Status pill with title, subtitle, period. Styles: `green | amber | red | blue`.
**Use**: highlighting quarter performance, flagging status.

### 5.2 `notes`
Labeled bullet list with optional paragraph items.
**Use**: executive observations, free-form commentary.

### 5.3 `metrics`
Responsive grid (auto-fill, min 155px) of metric cards. Each: label, value, optional change %, optional trend (up/down/stable).
**Use**: KPI snapshots inside sections.

### 5.4 `table`
Branded data table — brand-colored header row, zebra striping, negative values auto-colored red.
**Use**: breakdowns by region, product, time period.

### 5.5 `keyvalue`
Vertical list of key/value rows inside rounded gray cards.
**Use**: operational KPIs, settings summaries.

### 5.6 `comparison`
Dual-column side-by-side with brand-colored headers and per-row key/value.
**Use**: A vs B comparisons (Production vs Logistics, Region A vs Region B).

### 5.7 `callout`
Bold hero-style announcement: icon + title + big value, bordered in brand color, gradient background.
**Use**: Net Promoter Score highlight, milestone announcement.

### 5.8 `image`
Image URL + optional caption, max-width 100%, soft shadow.
**Use**: photos, diagrams, external charts.

### 5.9 `chart`
Chart.js canvas (bar/line/pie/doughnut) with data configured inline.
**Use**: time-series trends, distribution breakdowns.

Plus a 10th rendered-only block:

### 5.10 `link`
Branded external link card with icon tile.
**Use**: cross-links to related reports or external dashboards.

---

## 6. Rendered Report Structure

Every report renders as:

```
┌─────────────────────────────────────────────┐
│  Green gradient header                      │
│  ┌──────────────┐                           │
│  │ CALO (SVG)   │                           │
│  └──────────────┘                           │
│  Report Title (h1, Lato 900)                │
│  Subtitle / date / period pill              │
└─────────────────────────────────────────────┘
  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
  │ KPI │ │ KPI │ │ KPI │ │ KPI │ │ KPI │   ← Elevated over header
  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘

┌─────────────────────────────────────────────┐
│ 🎯 Section Title                       ▼    │
├─────────────────────────────────────────────┤
│  [ blocks render here ]                     │
└─────────────────────────────────────────────┘

… more sections …

┌─────────────────────────────────────────────┐
│ Executive Summary                           │
│ Paragraph in brand-tinted gradient box      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 💡 Key Insights                             │
│ • Insight 1 (brand-left-border)             │
│ • Insight 2                                 │
└─────────────────────────────────────────────┘

        CALO (SVG, gray)  Reports Platform
```

- Max width 960px, centered.
- Section headers are clickable to collapse/expand.
- Print styles expand everything, hide chevrons, remove hover transitions.

---

## 7. Interaction Patterns

### 7.1 Auth
- Company-code gate on registration prevents public signups.
- JWT (7-day) in `localStorage['calo-token']`; attached as Bearer header by `ApiClient`.

### 7.2 Sharing Model (3-state)
- **Private**: owner + admins only.
- **Team (shared)**: all authenticated users.
- **Specific**: explicit list of user IDs stored in `shared_with` JSON array.
- UI shows a read-only status pill next to a prominent Share button; panel has a toggle + search + checkboxes.

### 7.3 Publishing
- One-click deploy to Netlify using the user's access token.
- Existing `netlify_site_id` is reused for re-publishes (not a new site every time).
- Password protection is optional; hash is embedded in the exported HTML.

### 7.4 AI Chat
- Structured `{ message, updates }` response — model returns updates to merge, not full replacements.
- Sparse arrays (`null` means "don't touch this section") keep merges surgical.
- Last 6 messages sent for context; report data truncated to 8000 chars.

---

## 8. Responsive Behavior

- **Sidebar**: collapses to drawer below `lg` (1024px). Hamburger opens it.
- **KPI grid in reports**: 5 columns → 3 columns (<768px) → 2 columns (<480px).
- **Report cards**: grid auto-fills down to 1 column on mobile.
- **Tables**: horizontal scroll inside rounded container below their natural width.
- **Editor**: AI chat sidebar becomes a tab (not split) below `lg`.

---

## 9. Known Design Rough Edges

Honest list — things I'd push on if designing a v2:

1. **Dashboard AI-usage chart**: barebones bars, could use proper date binning and hover tooltips.
2. **New Report wizard step indicator**: currently a breadcrumb of numbers; no progress animation.
3. **Report editor block picker**: modal-style dropdown with emoji icons; would benefit from illustrated previews of each block type.
4. **Empty states**: most pages show plain text + button. Could use friendly illustrations.
5. **Mobile editor UX**: works but cramped — the AI chat tab vs the block editor doesn't feel great on phone.
6. **Templates browsing**: flat list, no thumbnails. Rendered previews would help choose.
7. **Dark mode**: not yet considered. All surfaces assume light.
8. **Table of contents** for long reports: not rendered; long reports require scrolling.
9. **Loading skeletons**: currently spinners. Skeleton screens would feel faster.
10. **Toast stacking**: default react-hot-toast, could be themed to brand.

---

## 10. Open Design Questions

For the design team — prioritized:

1. Should the rendered report get a **table of contents** pill bar under the KPI strip that deep-links to sections?
2. Do we want an **icon set beyond emoji** for section headers? Emojis render inconsistently across platforms.
3. Should **charts use brand palette** by default (e.g. gradient from brand-500 → brand-300 for multi-series bars)?
4. What's the story for **multi-language** reports (Arabic RTL support for the KSA market)?
5. How should **revision history** be visualized (sidebar timeline vs diff view)?
6. Do we need a **branded PDF cover page** distinct from the HTML header?
7. Should the **password gate** show a small "Powered by CALO" mark or stay minimal?
8. **Print/export typography**: do we want tighter line-height and smaller KPI cards for dense print pages?

---

## 11. Technical Stack Summary

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + Vite 6 |
| Routing | React Router 6 |
| Styling | TailwindCSS 3 + custom CSS layer |
| Icons | lucide-react |
| Forms | Native + react-dropzone |
| Toast | react-hot-toast |
| Charts | Chart.js 4 |
| Date | date-fns |
| Server | Node.js 24 + Express 4 (ESM) |
| DB | sql.js (SQLite, in-memory + file persistence) |
| Auth | bcryptjs + jsonwebtoken |
| File parsing | xlsx (SheetJS), native CSV/JSON |
| Email | Resend |
| Deploy | Render.com (auto-deploy on push to master) |
| AI | Gemini 2.0 Flash / Claude Sonnet 4.5 / Perplexity Sonar Pro |

---

## 12. File Map (Design-Relevant Only)

```
client/src/
├── index.css                 # CSS variables, component layer, gradient-header
├── main.jsx                  # react-hot-toast theme config
├── components/
│   ├── CaloLogo.jsx          # Official wordmark SVG
│   └── Layout.jsx            # Sidebar + topbar + drawer
├── contexts/
│   └── AuthContext.jsx       # User state
├── utils/
│   └── api.js                # ApiClient (~30 methods)
└── pages/
    ├── LoginPage.jsx         # Split-screen login + register
    ├── DashboardPage.jsx     # Home / stats
    ├── ReportsListPage.jsx   # Browse reports
    ├── NewReportPage.jsx     # 3-step create wizard
    ├── ReportEditorPage.jsx  # Main editor (812 LOC)
    ├── ReportPreviewPage.jsx # Preview + share + publish (634 LOC)
    ├── TemplatesPage.jsx     # Template browser/manager
    ├── GuidePage.jsx         # How-to reference
    └── SettingsPage.jsx      # Profile + admin users

server/src/
├── services/
│   └── htmlBuilder.js        # Standalone HTML renderer (9 block types)
├── db/
│   └── seedTemplates.js      # Default HR + Production templates
└── routes/                   # REST endpoints

client/index.html             # Lato font link + root div
client/tailwind.config.js     # Brand palette + Lato font-family
```

---

## 13. Sample Reports for Review

Two live sample reports demonstrating the current state:

1. **Q1 2026 Performance Report**
   https://calo-reports-hub.onrender.com/reports/eb3f6fdf-1cf2-4870-8cce-c27c5b17aaec
   *Exercises 7 of 9 block types with realistic CALO business data.*

2. **Brand Identity Showcase**
   *(create fresh — see section 14 below)*

Log in with admin credentials provided separately to browse the app.

---

## 14. How to Regenerate a Sample Report

If you want a fresh sample after any design change, hit the live API:

```bash
# 1. Login
curl -X POST https://calo-reports-hub.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin-email>","password":"<password>"}'
# → returns { token: "..." }

# 2. Create report
curl -X POST https://calo-reports-hub.onrender.com/api/reports \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"...","reportData":{...}}'
# → returns { id: "..." }

# 3. View
open https://calo-reports-hub.onrender.com/reports/<id>
```

See `server/src/db/seedTemplates.js` for the full `reportData` schema with every block type.

---

*Last updated: April 2026 — aligned with commit `724ee78` (official CALO logo SVG + Lato typography live across all placements).*
