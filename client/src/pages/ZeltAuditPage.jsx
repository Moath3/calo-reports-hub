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
  const isAdmin = user?.role === 'admin';
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [digestEmails, setDigestEmails] = useState('');
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.zeltAudit()
      .then(r => setReport(r))
      .catch(e => setError(e.message || 'Failed to load audit'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const sendDigest = async () => {
    const recipients = digestEmails.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!recipients.length) return setError('Enter at least one email');
    setSending(true);
    setError(null);
    setSentMsg(null);
    try {
      const r = await api.zeltAuditDigest(recipients);
      setSentMsg(`Digest sent to ${r.recipients.length} recipient(s).`);
      setDigestEmails('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

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
      <Header onRefresh={load} />

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

      {/* Send digest */}
      {isAdmin && (
        <div style={{ ...panel, padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>Email this digest to:</strong>
            <input
              type="text"
              value={digestEmails}
              onChange={e => setDigestEmails(e.target.value)}
              placeholder="email1@calo.app, email2@calo.app"
              style={{ ...input, flex: 1, minWidth: 260 }}
            />
            <button onClick={sendDigest} disabled={sending} style={primaryBtn(sending)}>
              {sending ? 'Sending…' : 'Send digest'}
            </button>
          </div>
          {sentMsg && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--calo-700, #1e8359)' }}>{sentMsg}</div>}
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
                      <div style={{ fontWeight: 700 }}>{it.name || it.employeeId || JSON.stringify(it).slice(0, 60)}</div>
                      {it.employeeId && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ID: {it.employeeId}</div>}
                      {it.leaveDate && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>leaveDate: {it.leaveDate}</div>}
                      {it.eventStatus && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>event: {it.eventStatus}</div>}
                      {it.startDate && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>start: {it.startDate}</div>}
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

function Header({ onRefresh }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.16em', color: 'var(--ink-500)' }}>HR · ZELT</div>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.025em', margin: '4px 0 0 0' }}>Data Hygiene</h1>
      </div>
      {onRefresh && <button onClick={onRefresh} style={ghostBtn}><Icon name="RefreshCw" size={14} /> Refresh</button>}
    </div>
  );
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
