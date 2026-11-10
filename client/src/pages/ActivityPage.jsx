import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../utils/api';
import { Icon, Btn, Card, PageHeader } from '../components/ui';

const ACTION_LABELS = {
  login: 'Signed in',
  logout: 'Signed out',
  register: 'Registered',
  'tool.open': 'Opened a tool',
  'ai.generate': 'Generated with AI',
  'user.removed': 'Removed a user',
  'user.role': 'Changed a user role',
  'user.toggle': 'Activated / deactivated a user',
  'zelt.audit': 'Ran data hygiene audit',
  'zelt.otRoster': 'Pulled salary roster (Zelt)',
  'zelt.hrAccess.set': 'Changed HR salary access',
  'zelt.masterfileSheet': 'Pulled masterfile from Google Sheet',
  'zelt.report.run': 'Ran a Zelt report',
  'zelt.headcount': 'Exported headcount',
};

function prettyAction(a) {
  if (ACTION_LABELS[a]) return ACTION_LABELS[a];
  return String(a || '').replace(/[._]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parseDate(iso) {
  if (!iso) return null;
  const d = new Date(iso.length === 10 || iso.includes(' ') ? iso.replace(' ', 'T') + 'Z' : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtWhen(iso) {
  const d = parseDate(iso);
  if (!d) return { rel: iso ? String(iso) : '—', abs: '' };
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
function fmtDate(iso) {
  const d = parseDate(iso);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—';
}
function fmtDetails(raw) {
  if (!raw) return '';
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return raw.slice(0, 120); } }
  if (obj == null || typeof obj !== 'object') return String(obj);
  return Object.entries(obj)
    .filter(([, v]) => v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(' · ');
}
const chip = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--calo-50)', color: 'var(--calo-700)', border: '1px solid var(--calo-100)' };

export default function ActivityPage() {
  const [tab, setTab] = useState('people');

  // People view
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleErr, setPeopleErr] = useState(null);
  const [pq, setPq] = useState('');
  const [selected, setSelected] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [tlLoading, setTlLoading] = useState(false);

  // All-events view
  const [events, setEvents] = useState([]);
  const [evLoading, setEvLoading] = useState(false);
  const [limit, setLimit] = useState(200);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');

  const loadPeople = useCallback(() => {
    setPeopleLoading(true); setPeopleErr(null);
    api.getActivityPeople().then((r) => setPeople(r.people || [])).catch((e) => setPeopleErr(e.message || 'Failed to load')).finally(() => setPeopleLoading(false));
  }, []);
  const loadEvents = useCallback(() => {
    setEvLoading(true);
    api.getActivity(limit).then((r) => setEvents(r.events || [])).catch(() => {}).finally(() => setEvLoading(false));
  }, [limit]);

  useEffect(() => { if (tab === 'people') loadPeople(); }, [tab, loadPeople]);
  useEffect(() => { if (tab === 'events') loadEvents(); }, [tab, loadEvents]);

  const openUser = (u) => {
    setSelected(u); setTimeline(null); setTlLoading(true);
    api.getActivityUser(u.id).then((r) => setTimeline(r)).catch(() => setTimeline({ events: [] })).finally(() => setTlLoading(false));
  };

  const filteredPeople = useMemo(() => {
    const n = pq.trim().toLowerCase();
    if (!n) return people;
    return people.filter((p) => [p.name, p.email, p.role, p.department, p.tools].filter(Boolean).join(' ').toLowerCase().includes(n));
  }, [people, pq]);

  const actions = useMemo(() => [...new Set(events.map((e) => e.action))].sort(), [events]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (action && e.action !== action) return false;
      if (!needle) return true;
      return [e.user_name, e.user_email, e.action, e.resource_type, e.resource_id, e.details, e.ip_address].filter(Boolean).join(' ').toLowerCase().includes(needle);
    });
  }, [events, q, action]);

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{
      padding: '7px 14px', borderRadius: 'var(--r-pill)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
      background: tab === id ? '#fff' : 'transparent', color: tab === id ? 'var(--ink-900)' : 'var(--ink-600)', boxShadow: tab === id ? 'var(--shadow-sm)' : 'none',
    }}>{label}</button>
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 4px 60px' }}>
      <PageHeader
        eyebrow="Admin"
        title="Activity log"
        subtitle="Who signed up, who signed in, and which tools each person used on the Hub. Read live from the audit trail."
        actions={<Btn variant="secondary" icon="RefreshCw" onClick={tab === 'people' ? loadPeople : loadEvents} disabled={peopleLoading || evLoading}>Refresh</Btn>}
      />

      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--ink-100)', borderRadius: 'var(--r-pill)', width: 'fit-content', marginBottom: 16 }}>
        {tabBtn('people', 'By person')}
        {tabBtn('events', 'All events')}
      </div>

      {tab === 'people' ? (
        <>
          {peopleErr && <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: '#FDECEC', border: '1px solid #f5c6c6', color: '#9f2f2f', fontSize: 14, fontWeight: 600 }}>{peopleErr}</div>}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-400)' }}><Icon name="Search" size={15} /></span>
              <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Search person, role, tool…"
                style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 14 }} />
            </div>
          </Card>
          <Card>
            {peopleLoading ? <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>Loading…</p>
              : filteredPeople.length === 0 ? <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>No people found.</p>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--ink-500)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '8px 10px' }}>Person</th>
                        <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>First signup</th>
                        <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Last sign-in</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>Sign-ins</th>
                        <th style={{ padding: '8px 10px' }}>Tools used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPeople.map((p) => {
                        const tools = (p.tools ? p.tools.split(',') : []).filter(Boolean);
                        return (
                          <tr key={p.id} onClick={() => openUser(p)} style={{ borderTop: '1px solid var(--ink-100)', cursor: 'pointer' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--ink-50)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                            <td style={{ padding: '9px 10px' }}>
                              <div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{p.name || p.email} {p.is_active ? '' : <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>(inactive)</span>}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{p.email} · {p.role}{p.department ? ` · ${p.department}` : ''}</div>
                            </td>
                            <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(p.created_at)}</td>
                            <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', color: 'var(--ink-600)' }} title={fmtWhen(p.last_login).abs}>{fmtWhen(p.last_login).rel}</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums' }}>{p.signins || 0}</td>
                            <td style={{ padding: '9px 10px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {tools.length === 0 ? <span style={{ color: 'var(--ink-300)' }}>—</span> : tools.map((t) => <span key={t} style={chip}>{t}</span>)}
                                {p.ai_count > 0 && <span style={{ ...chip, background: 'var(--ink-100)', color: 'var(--ink-600)', border: '1px solid var(--ink-200)' }}>AI ×{p.ai_count}</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        </>
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: '1 1 260px' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-400)' }}><Icon name="Search" size={15} /></span>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person, action, details, IP…"
                  style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 14 }} />
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
            {evLoading ? <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>Loading…</p>
              : rows.length === 0 ? <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>{events.length ? 'No events match your filters.' : 'No activity recorded yet.'}</p>
              : (
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
                              {e.action === 'tool.open' && e.resource_type && <span style={{ ...chip, marginLeft: 6 }}>{e.resource_type}</span>}
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
        </>
      )}

      {/* Per-person drill-down */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,31,23,.4)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: 680, width: '100%', boxShadow: 'var(--shadow-xl)', padding: 0 }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink-900)' }}>{selected.name || selected.email}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>{selected.email} · {selected.role}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 4 }}>
                  First signup {fmtDate(selected.created_at)} · {selected.signins || 0} sign-ins · last seen {fmtWhen(selected.last_event || selected.last_login).rel}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-400)', padding: 4 }}><Icon name="X" size={20} /></button>
            </div>
            <div style={{ padding: '14px 22px 22px', maxHeight: '60vh', overflowY: 'auto' }}>
              {tlLoading ? <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>Loading timeline…</p>
                : !timeline?.events?.length ? <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>No recorded activity yet.</p>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {timeline.events.map((e, i) => {
                      const w = fmtWhen(e.created_at);
                      return (
                        <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 4px', borderBottom: '1px solid var(--ink-50)' }}>
                          <div style={{ width: 92, flexShrink: 0, fontSize: 12, color: 'var(--ink-500)' }} title={w.abs}>{w.rel}</div>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink-900)' }}>{prettyAction(e.action)}</span>
                            {(e.action === 'tool.open' || e.action === 'ai.generate') && e.resource_type && <span style={{ ...chip, marginLeft: 6 }}>{e.resource_type}</span>}
                            {fmtDetails(e.details) && <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>{fmtDetails(e.details)}</div>}
                          </div>
                          {e.ip_address && <div style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'monospace' }}>{e.ip_address}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
