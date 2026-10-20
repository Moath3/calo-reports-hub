import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../utils/api';
import { Icon, Btn, Card, PageHeader } from '../components/ui';

// Friendlier labels for the common audit actions; anything else is prettified
// from the raw code so new actions still read sensibly without a code change.
const ACTION_LABELS = {
  login: 'Signed in',
  logout: 'Signed out',
  register: 'Registered',
  'user.removed': 'Removed a user',
  'user.role': 'Changed a user role',
  'user.toggle': 'Activated / deactivated a user',
  'zelt.audit': 'Ran data hygiene audit',
  'zelt.otRoster': 'Pulled salary roster (Zelt)',
  'zelt.hrAccess.set': 'Changed HR salary access',
  'zelt.masterfileSheet': 'Pulled masterfile from Google Sheet',
  'zelt.report': 'Ran a Zelt report',
};

function prettyAction(a) {
  if (ACTION_LABELS[a]) return ACTION_LABELS[a];
  return String(a || '')
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtWhen(iso) {
  if (!iso) return { rel: '—', abs: '' };
  const d = new Date(iso.length === 10 || iso.includes(' ') ? iso.replace(' ', 'T') + 'Z' : iso);
  if (Number.isNaN(d.getTime())) return { rel: String(iso), abs: '' };
  const diff = (Date.now() - d.getTime()) / 1000;
  let rel;
  if (diff < 60) rel = 'just now';
  else if (diff < 3600) rel = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) rel = `${Math.floor(diff / 3600)}h ago`;
  else if (diff < 86400 * 7) rel = `${Math.floor(diff / 86400)}d ago`;
  else rel = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const abs = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  return { rel, abs };
}

function fmtDetails(raw) {
  if (!raw) return '';
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return raw.slice(0, 120); } }
  if (obj == null || typeof obj !== 'object') return String(obj);
  return Object.entries(obj)
    .filter(([, v]) => v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

export default function ActivityPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(200);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.getActivity(limit)
      .then((r) => setEvents(r.events || []))
      .catch((e) => setError(e.message || 'Failed to load activity'))
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  const actions = useMemo(() => [...new Set(events.map((e) => e.action))].sort(), [events]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (action && e.action !== action) return false;
      if (!needle) return true;
      return [e.user_name, e.user_email, e.action, e.resource_type, e.resource_id, e.details, e.ip_address]
        .filter(Boolean).join(' ').toLowerCase().includes(needle);
    });
  }, [events, q, action]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 4px 60px' }}>
      <PageHeader
        eyebrow="Admin"
        title="Activity log"
        subtitle="Who did what on the Hub — logins, Zelt salary pulls, HR access changes, user management and more. Read live from the audit trail, newest first."
        actions={<Btn variant="secondary" icon="RefreshCw" onClick={load} disabled={loading}>Refresh</Btn>}
      />

      {error && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: '#FDECEC', border: '1px solid #f5c6c6', color: '#9f2f2f', fontSize: 14, fontWeight: 600 }}>
          {error}
        </div>
      )}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 260px' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-400)' }}><Icon name="Search" size={15} /></span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search person, action, details, IP…"
              style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 14 }}
            />
          </div>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="input-field" style={{ flex: '0 0 auto', width: 'auto', padding: '8px 12px' }}>
            <option value="">All actions ({events.length})</option>
            {actions.map((a) => <option key={a} value={a}>{prettyAction(a)}</option>)}
          </select>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="input-field" style={{ flex: '0 0 auto', width: 'auto', padding: '8px 12px' }}>
            {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>Last {n}</option>)}
          </select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>{events.length ? 'No events match your filters.' : 'No activity recorded yet.'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-500)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>When</th>
                  <th style={{ padding: '8px 10px' }}>Who</th>
                  <th style={{ padding: '8px 10px' }}>Action</th>
                  <th style={{ padding: '8px 10px' }}>Details</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const w = fmtWhen(e.created_at);
                  return (
                    <tr key={e.id} style={{ borderTop: '1px solid var(--ink-100)' }}>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', color: 'var(--ink-500)' }} title={w.abs}>{w.rel}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{e.user_name || <span style={{ color: 'var(--ink-400)' }}>Unknown / removed</span>}</div>
                        {e.user_email && <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{e.user_email}</div>}
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{prettyAction(e.action)}</span>
                        <div style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'monospace' }}>{e.action}</div>
                      </td>
                      <td style={{ padding: '9px 10px', color: 'var(--ink-600)', maxWidth: 360 }}>
                        {fmtDetails(e.details) || (e.resource_type ? [e.resource_type, e.resource_id].filter(Boolean).join(' ') : <span style={{ color: 'var(--ink-300)' }}>—</span>)}
                      </td>
                      <td style={{ padding: '9px 10px', color: 'var(--ink-500)', fontFamily: 'monospace', fontSize: 12 }}>{e.ip_address || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
