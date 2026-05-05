import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { Icon } from '../components/ui';

const SEVERITY = {
  activeWithLeaveDate: 'high',
  activeButTerminated: 'high',
  duplicateEmployeeIds: 'high',
  brandDivisionAsEntity: 'high',
  legacySiteAssigned: 'high',
  currencyMismatch: 'high',
  placeholderEmails: 'high',
  missingEmployeeId: 'medium',
  duplicateNames: 'medium',
  missingEntity: 'medium',
  missingDepartment: 'low',
  missingSite: 'low',
  missingManager: 'medium',
  unapprovedEntity: 'medium',
  unapprovedDepartment: 'low',
  unclassifiedCountry: 'medium',
  unclassifiedOrganization: 'medium',
  duplicateJobTitleVariants: 'medium',
  rareJobTitles: 'low',
  futureJoiners: 'low',
  staleCreated: 'low',
  testUsers: 'medium',
  departmentList: 'info',
  entityList: 'info',
};

const LABELS = {
  activeWithLeaveDate: 'Active employees with leaveDate set',
  activeButTerminated: 'Active but marked Terminated/Resigned',
  duplicateEmployeeIds: 'Duplicate employee IDs',
  missingEmployeeId: 'Active users missing employee ID',
  duplicateNames: 'Duplicate display names',
  missingEntity: 'Missing entity',
  missingSite: 'Missing site',
  missingDepartment: 'Missing department',
  missingManager: 'Missing manager',
  futureJoiners: 'Future joiners (>90 days out)',
  staleCreated: 'Stale "Created" status (>90 days)',
  testUsers: 'Test users on Active status',
  // Guide-driven
  unapprovedEntity: 'Entity not in legal CR list',
  unapprovedDepartment: 'Department needs confirmation against approved list',
  legacySiteAssigned: 'Active user on a legacy "[Not in use]" site',
  currencyMismatch: 'Entity currency mismatch with country (e.g. KSA in GBP)',
  rareJobTitles: 'Job titles used by only 1 employee (typos / not in mastersheet)',
  duplicateJobTitleVariants: 'Job title case/spacing duplicates (LINE COOK vs Line Cook)',
  placeholderEmails: 'Active users with @dummy / @noreply emails',
  brandDivisionAsEntity: 'Brand-division name used as Entity (should be Organization tag)',
  unclassifiedCountry: 'Country can\'t be derived from entity/site',
  unclassifiedOrganization: 'Organization can\'t be derived (Basecamp / MP-XX)',
  departmentList: 'All active departments — review against approved list',
  entityList: 'All entities seen — confirm CR vs brand-division',
};

export default function ZeltAuditPage() {
  const { user } = useAuth();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback((force = false) => {
    setLoading(true);
    setError(null);
    api.zeltAudit({ force })
      .then(r => setReport(r))
      .catch(e => setError(e.message || 'Failed to load audit'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(false); }, [load]);

  const onRefresh = () => load(true);

  if (loading) return <Wrap><Spinner /></Wrap>;
  if (error) return <Wrap><Header /><div style={errBanner}>{error}</div></Wrap>;
  if (!report) return null;

  const checkKeys = Object.keys(report.summary).filter(k => !['ksaActiveCount'].includes(k));
  const sorted = checkKeys.sort((a, b) => {
    const sa = SEVERITY[a] || 'low';
    const sb = SEVERITY[b] || 'low';
    const order = { high: 0, medium: 1, low: 2 };
    return (order[sa] - order[sb]) || (report.summary[b] - report.summary[a]);
  });

  return (
    <Wrap>
      <Header onRefresh={onRefresh} report={report} />

      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <StatCard label="Total Zelt users" value={report.totalUsers} />
        <StatCard label="Unique entities" value={report.stats?.totalUniqueEntities ?? '—'} />
        <StatCard label="Unique departments" value={report.stats?.totalUniqueDepartments ?? '—'} />
        <StatCard label="Unique job titles" value={report.stats?.totalUniqueJobTitles ?? '—'} />
        <StatCard label="Countries detected" value={report.stats?.totalCountries ?? '—'} />
        <StatCard label="Organizations detected" value={report.stats?.totalOrganizations ?? '—'} />
        {Object.entries(report.statusCounts).map(([k, v]) => (
          <StatCard key={k} label={k} value={v} muted />
        ))}
      </div>

      {/* Active by country */}
      {report.byCountry && (
        <div style={{ ...panel, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            Active employees by country
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(report.byCountry).sort((a,b) => b[1] - a[1]).map(([c, n]) => (
              <span key={c} style={{
                padding: '6px 12px', borderRadius: 999,
                background: c === 'Unclassified' ? '#FDECEC' : 'var(--calo-50, #d9f0e5)',
                color: c === 'Unclassified' ? '#9f2f2f' : 'var(--calo-700, #1e8359)',
                fontSize: 13, fontWeight: 700,
              }}>{c} · {n}</span>
            ))}
          </div>
        </div>
      )}

      {/* Active by organization */}
      {report.byOrganization && (
        <div style={{ ...panel, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            Active employees by organization (Basecamp / MP-XX)
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(report.byOrganization).sort((a,b) => b[1] - a[1]).map(([o, n]) => (
              <span key={o} style={{
                padding: '6px 12px', borderRadius: 999,
                background: o === 'Unclassified' ? '#FDECEC' : 'var(--calo-50, #d9f0e5)',
                color: o === 'Unclassified' ? '#9f2f2f' : 'var(--calo-700, #1e8359)',
                fontSize: 13, fontWeight: 700,
              }}>{o} · {n}</span>
            ))}
          </div>
        </div>
      )}

      {/* Check cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {sorted.map(key => {
          const count = report.summary[key];
          const sev = SEVERITY[key] || 'low';
          const items = report.checks[key] || [];
          const isOpen = expanded === key;
          return (
            <div key={key} style={{ ...panel, padding: 0, overflow: 'hidden', borderLeft: `4px solid ${sevColor(sev)}` }}>
              <button
                onClick={() => setExpanded(isOpen ? null : key)}
                style={{ width: '100%', textAlign: 'left', padding: '14px 16px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-900)' }}>{LABELS[key] || key}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sevColor(sev), letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2 }}>
                    {sev}
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: count === 0 ? 'var(--ink-500)' : sevColor(sev), letterSpacing: '-0.02em' }}>
                  {count}
                </div>
              </button>
              {isOpen && Array.isArray(items) && items.length > 0 && (
                <div style={{ borderTop: '1px solid var(--ink-100)', maxHeight: 320, overflowY: 'auto' }}>
                  {items.slice(0, 50).map((it, i) => (
                    <div key={i} style={{ padding: '8px 16px', borderBottom: '1px solid var(--ink-100)', fontSize: 13 }}>
                      <div style={{ fontWeight: 700 }}>
                        {it.name || it.legalName || it.value || it.employeeId || it.email || prettyFallback(it)}
                      </div>
                      {it.employeeId && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ID: {it.employeeId}</div>}
                      {it.leaveDate && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>leaveDate: {it.leaveDate}</div>}
                      {it.eventStatus && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>event: {it.eventStatus}</div>}
                      {it.startDate && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>start: {it.startDate}</div>}
                      {it.suggestion && <div style={{ fontSize: 11, color: 'var(--ink-500)', fontStyle: 'italic' }}>{it.suggestion}</div>}
                      {it.count != null && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>{it.count} matches</div>}
                    </div>
                  ))}
                  {items.length > 50 && (
                    <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--ink-500)', textAlign: 'center' }}>
                      …and {items.length - 50} more
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Wrap>
  );
}

function Wrap({ children }) {
  return <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>;
}

// Last-resort renderer for audit-row shapes the explicit fields above don't cover.
// Joins primitive values from the object into "key: value · key: value" instead of
// dumping a truncated JSON.stringify, which read as gibberish in the UI.
function prettyFallback(it) {
  if (it == null) return '';
  if (typeof it !== 'object') return String(it);
  const pairs = Object.entries(it)
    .filter(([, v]) => v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${v}`);
  return pairs.join(' · ') || '(no displayable fields)';
}

function Header({ onRefresh, report }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.16em', color: 'var(--ink-500)' }}>HR · ZELT</div>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.025em', margin: '4px 0 0 0' }}>Data Hygiene</h1>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {report && (
          <>
            <button onClick={() => downloadHtmlReport(report)} style={ghostBtn} title="Download as a self-contained HTML report"><Icon name="FileText" size={14} /> Download HTML</button>
            <button onClick={() => downloadCsvReport(report)} style={ghostBtn} title="Download flagged items as a spreadsheet (.csv)"><Icon name="Table" size={14} /> Download CSV</button>
          </>
        )}
        {onRefresh && <button onClick={onRefresh} style={ghostBtn}><Icon name="RefreshCw" size={14} /> Refresh</button>}
      </div>
    </div>
  );
}

// ---- Client-side report builders ------------------------------------------

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isoDateTag(report) {
  return new Date(report.asOf || Date.now()).toISOString().slice(0, 10);
}

function downloadHtmlReport(report) {
  const html = buildHtmlReport(report);
  triggerDownload(`calo-zelt-data-hygiene-${isoDateTag(report)}.html`, html, 'text/html;charset=utf-8');
}

function downloadCsvReport(report) {
  const csv = buildCsvReport(report);
  triggerDownload(`calo-zelt-data-hygiene-${isoDateTag(report)}.csv`, csv, 'text/csv;charset=utf-8');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function compactDetails(it) {
  if (it == null || typeof it !== 'object') return '';
  const skip = new Set(['name', 'legalName', 'value', 'employeeId', 'email', 'entity', 'department', 'site', 'suggestion']);
  const pairs = Object.entries(it)
    .filter(([k, v]) => !skip.has(k) && v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .map(([k, v]) => `${k}=${v}`);
  return pairs.join('; ');
}

function buildCsvReport(report) {
  const cols = ['Check', 'Severity', 'Name', 'Employee ID', 'Entity', 'Department', 'Site', 'Suggestion', 'Details'];
  const rows = [cols];
  for (const [key, items] of Object.entries(report.checks || {})) {
    if (!Array.isArray(items) || !items.length) continue;
    const sev = SEVERITY[key] || 'low';
    const label = LABELS[key] || key;
    for (const it of items) {
      rows.push([
        label,
        sev,
        it.name || it.legalName || it.value || '',
        it.employeeId || '',
        it.entity || '',
        it.department || '',
        it.site || '',
        it.suggestion || '',
        compactDetails(it),
      ]);
    }
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

function buildHtmlReport(report) {
  const asOf = new Date(report.asOf || Date.now()).toLocaleString('en-GB');
  const checkBlocks = Object.entries(report.checks || {})
    .filter(([, items]) => Array.isArray(items) && items.length > 0)
    .sort(([a], [b]) => {
      const order = { high: 0, medium: 1, low: 2, info: 3 };
      return (order[SEVERITY[a] || 'low'] - order[SEVERITY[b] || 'low']);
    })
    .map(([key, items]) => {
      const sev = SEVERITY[key] || 'low';
      const sevColor = sev === 'high' ? '#c0392b' : sev === 'medium' ? '#9A6F0E' : sev === 'info' ? '#5b6ee1' : '#28b17b';
      const rows = items.map(it => {
        const title = it.name || it.legalName || it.value || it.employeeId || it.email || '(item)';
        const meta = [
          it.employeeId && `ID ${it.employeeId}`,
          it.entity, it.department, it.site,
          it.leaveDate && `leaveDate ${it.leaveDate}`,
          it.suggestion,
        ].filter(Boolean).map(escapeHtml).join(' · ');
        return `<li style="padding:6px 0;border-bottom:1px solid #eee"><strong>${escapeHtml(title)}</strong>${meta ? `<div style="font-size:12px;color:#777">${meta}</div>` : ''}</li>`;
      }).join('');
      return `
        <section style="margin-top:24px">
          <div style="border-left:4px solid ${sevColor};padding-left:12px">
            <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${sevColor}">${sev} · ${items.length} flagged</div>
            <h2 style="margin:4px 0 0;font-size:16px;color:#222">${escapeHtml(LABELS[key] || key)}</h2>
          </div>
          <ul style="list-style:none;padding:0;margin:8px 0 0">${rows}</ul>
        </section>`;
    })
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Calo · Zelt Data Hygiene · ${escapeHtml(asOf)}</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;background:#f7f7f7;margin:0;padding:24px;color:#222">
  <div style="max-width:820px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.06)">
    <header style="border-bottom:1px solid #eee;padding-bottom:16px">
      <div style="font-size:11px;font-weight:900;letter-spacing:.16em;color:#888">CALO · ZELT</div>
      <h1 style="margin:4px 0 0;font-size:24px;letter-spacing:-0.02em">Data Hygiene Report</h1>
      <div style="font-size:13px;color:#666;margin-top:6px">${escapeHtml(asOf)} · ${report.totalUsers} total Zelt users</div>
    </header>
    ${checkBlocks || '<p style="margin-top:24px;color:#666">No flagged items.</p>'}
    <footer style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#888">
      Generated from CALO Reports Hub · Data Hygiene
    </footer>
  </div>
</body></html>`;
}

function Comparison({ label, actual, expected, hint }) {
  const ratio = actual / expected;
  const bad = ratio > 2 || ratio < 0.5;
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-500)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 22, fontWeight: 900, color: bad ? '#c0392b' : 'var(--ink-900)', letterSpacing: '-0.02em' }}>{actual}</span>
        <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>vs <b>{expected}</b> expected</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>{hint}</div>
    </div>
  );
}

function StatCard({ label, value, muted }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-md)', padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-500)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: muted ? 'var(--ink-700)' : 'var(--ink-900)', letterSpacing: '-0.02em', marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Spinner() {
  return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-500 border-t-transparent" />
  </div>;
}

function sevColor(s) {
  if (s === 'high') return '#c0392b';
  if (s === 'medium') return '#9A6F0E';
  if (s === 'info') return '#5b6ee1';
  return '#28b17b';
}

const panel = { background: '#fff', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)', padding: 24, boxShadow: 'var(--shadow-sm)' };
const errBanner = { background: '#FDECEC', border: '1px solid #f5c6c6', color: '#9f2f2f', padding: 12, borderRadius: 8 };
const input = { padding: '9px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--ink-200)', fontSize: 14 };
const primaryBtn = (disabled) => ({ background: disabled ? 'var(--ink-200)' : 'var(--calo-500)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: disabled ? 'wait' : 'pointer' });
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: 'var(--ink-700)', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
