import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { Icon } from '../components/ui';

/**
 * ZeltLeavePage — HR self-service leave balance lookup.
 *
 * Picks an entity from a dropdown, fetches "Available Now" via the hub backend
 * (which proxies the Zelt OAuth API). Sortable table, CSV export.
 *
 * Admin gets a "Connect Zelt" CTA when not yet bootstrapped.
 */
export default function ZeltLeavePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [status, setStatus] = useState({ loading: true, connected: false });
  const [entities, setEntities] = useState([]);
  const [entity, setEntity] = useState('');
  const [data, setData] = useState(null);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [bootstrap, setBootstrap] = useState(null);

  // Initial: probe status
  useEffect(() => {
    let alive = true;
    api.zeltStatus()
      .then(s => { if (alive) setStatus({ loading: false, ...s }); })
      .catch(() => { if (alive) setStatus({ loading: false, connected: false }); });
    return () => { alive = false; };
  }, []);

  // Once connected, load entities
  useEffect(() => {
    if (!status.connected) return;
    setLoadingEntities(true);
    api.zeltEntities()
      .then(({ entities }) => { setEntities(entities); setError(null); })
      .catch(e => setError(formatErr(e, 'Failed to load entities')))
      .finally(() => setLoadingEntities(false));
  }, [status.connected]);

  const handleGenerate = useCallback(async () => {
    if (!entity) return;
    setLoadingBalances(true);
    setError(null);
    try {
      const result = await api.zeltBalances(entity);
      setData(result);
    } catch (e) {
      setError(formatErr(e, 'Failed to load balances'));
      setData(null);
    } finally {
      setLoadingBalances(false);
    }
  }, [entity]);

  const handleConnect = useCallback(async () => {
    try {
      const instr = await api.zeltOauthInit();
      setBootstrap(instr);
    } catch (e) {
      setError(formatErr(e, 'Failed to fetch bootstrap instructions'));
    }
  }, []);

  const handleCheckConnected = useCallback(async () => {
    try {
      const s = await api.zeltStatus();
      setStatus({ loading: false, ...s });
      if (s.connected) setBootstrap(null);
    } catch (e) {
      setError(formatErr(e, 'Status check failed'));
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!confirm('Disconnect from Zelt? You will need to re-bootstrap to reconnect.')) return;
    try {
      await api.zeltDisconnect();
      setStatus({ loading: false, connected: false });
      setData(null);
      setEntities([]);
    } catch (e) {
      setError(formatErr(e, 'Disconnect failed'));
    }
  }, []);

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    const q = search.trim().toLowerCase();
    let rows = data.rows;
    if (q) {
      rows = rows.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.employeeId || '').toLowerCase().includes(q) ||
        (r.department || '').toLowerCase().includes(q) ||
        (r.jobTitle || '').toLowerCase().includes(q)
      );
    }
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
      return String(av).localeCompare(String(bv)) * mul;
    });
    return rows;
  }, [data, search, sort]);

  const handleSort = (key) => {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  // ---- render -----------------------------------------------------

  if (status.loading) return <PageWrap><Spinner /></PageWrap>;

  if (!status.connected) {
    return (
      <PageWrap>
        <Header />
        {bootstrap ? (
          <BootstrapCard
            instructions={bootstrap}
            onCheck={handleCheckConnected}
            onCancel={() => setBootstrap(null)}
          />
        ) : (
          <EmptyConnect onConnect={handleConnect} isAdmin={isAdmin} />
        )}
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      <Header
        connected
        lastRefresh={status.lastRefresh}
        onDisconnect={isAdmin ? handleDisconnect : null}
      />

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {/* Filter bar */}
      <div style={panel}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 280px', minWidth: 240 }}>
            <Label>Entity</Label>
            <select
              value={entity}
              onChange={e => setEntity(e.target.value)}
              disabled={loadingEntities}
              style={select}
            >
              <option value="">{loadingEntities ? 'Loading entities…' : 'Select entity'}</option>
              {entities.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <Label>As of</Label>
            <div style={{ ...select, color: 'var(--ink-700)', cursor: 'default' }}>Today</div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={!entity || loadingBalances}
            style={primaryBtn(!entity || loadingBalances)}
          >
            {loadingBalances ? 'Generating…' : 'Generate report'}
          </button>
        </div>
      </div>

      {/* Results */}
      {data && (
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--ink-500)', fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>
                {data.entity}
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.02em' }}>
                {data.count} employees · as of {fmtDate(data.asOf)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name, ID, dept…"
                style={searchInput}
              />
              <button onClick={async () => {
                try {
                  const blob = await api.zeltExportCsv(data.entity);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  const safe = data.entity.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                  a.download = `calo-available-now-${safe}-${data.asOf.slice(0, 10)}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  setError(formatErr(e, 'CSV export failed'));
                }
              }} style={ghostBtn}>
                <Icon name="Download" size={16} /> CSV
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <Th onClick={() => handleSort('employeeId')} active={sort.key === 'employeeId'} dir={sort.dir}>Emp ID</Th>
                  <Th onClick={() => handleSort('name')} active={sort.key === 'name'} dir={sort.dir}>Name</Th>
                  <Th onClick={() => handleSort('site')} active={sort.key === 'site'} dir={sort.dir}>Site</Th>
                  <Th onClick={() => handleSort('department')} active={sort.key === 'department'} dir={sort.dir}>Department</Th>
                  <Th onClick={() => handleSort('jobTitle')} active={sort.key === 'jobTitle'} dir={sort.dir}>Job Title</Th>
                  <Th onClick={() => handleSort('availableNow')} active={sort.key === 'availableNow'} dir={sort.dir} align="right">Available Now</Th>
                  <Th>Confidence</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-500)' }}>
                    No employees match the filter.
                  </td></tr>
                ) : filtered.map((r, i) => (
                  <tr key={r.userId || r.employeeId || i}
                      style={{ background: i % 2 === 0 ? '#fff' : 'var(--ink-50)' }}>
                    <Td mono>{r.employeeId || '—'}</Td>
                    <Td bold>{r.name}</Td>
                    <Td>{r.site || '—'}</Td>
                    <Td>{r.department || '—'}</Td>
                    <Td>{r.jobTitle || '—'}</Td>
                    <Td align="right" bold>
                      {r.availableNow != null ? `${r.availableNow.toFixed(1)}d` :
                        <span style={{ color: 'var(--ink-500)' }}>n/a</span>}
                    </Td>
                    <Td><ConfidenceBadge level={r.confidence} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageWrap>
  );
}

// ---- subcomponents -----------------------------------------------

function PageWrap({ children }) {
  return <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>{children}</div>;
}

function Header({ connected, lastRefresh, onDisconnect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.16em', color: 'var(--ink-500)' }}>HR · ZELT</div>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.025em', margin: '4px 0 0 0' }}>Leave Balances</h1>
      </div>
      {connected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', background: 'var(--calo-50, #d9f0e5)',
            color: 'var(--calo-700, #1e8359)', borderRadius: 999,
            fontSize: 12, fontWeight: 700,
          }}>
            <span style={{ width: 6, height: 6, background: 'var(--calo-500)', borderRadius: 999 }} />
            Connected
            {lastRefresh && <span style={{ fontWeight: 500, color: 'var(--ink-500)' }}>· refreshed {fmtRelative(lastRefresh)}</span>}
          </div>
          {onDisconnect && (
            <button onClick={onDisconnect} style={ghostBtn}>Disconnect</button>
          )}
        </div>
      )}
    </div>
  );
}

function BootstrapCard({ instructions, onCheck, onCancel }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(instructions.redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={{ ...panel, padding: 36 }}>
      <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink-900)', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
        Connect Zelt
      </h2>
      <p style={{ fontSize: 14, color: 'var(--ink-500)', margin: '0 0 24px' }}>
        Zelt's authorization is a manual flow. Follow these steps inside Zelt admin:
      </p>

      <ol style={{ paddingLeft: 22, margin: 0, color: 'var(--ink-900)', lineHeight: 1.7, fontSize: 14 }}>
        {instructions.steps.map((s, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{s}</li>
        ))}
      </ol>

      <div style={{ marginTop: 24, padding: 16, background: 'var(--ink-50)', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-500)', marginBottom: 8 }}>
          Redirection URI (must match Zelt app config exactly)
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code style={{ flex: 1, minWidth: 240, padding: '10px 12px', background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, color: 'var(--ink-900)', overflow: 'auto' }}>
            {instructions.redirectUri}
          </code>
          <button onClick={copy} style={ghostBtn}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onCheck} style={primaryBtn(false)}>I clicked Allow access — check connection</button>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--ink-500)' }}>
        Tip: open Zelt in a new tab. After clicking <b>Allow access</b>, you'll land on a "Zelt connected" page — you can close that tab and click the button above.
      </p>
    </div>
  );
}

function EmptyConnect({ onConnect, isAdmin }) {
  return (
    <div style={{ ...panel, padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px',
        background: 'var(--calo-50, #d9f0e5)', color: 'var(--calo-700, #1e8359)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="Plug" size={26} />
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink-900)', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
        Zelt not connected
      </h2>
      <p style={{ fontSize: 14, color: 'var(--ink-500)', maxWidth: 480, margin: '0 auto 24px' }}>
        {isAdmin
          ? 'Connect the hub to Zelt to load live leave balances. One-time setup.'
          : 'A hub admin needs to connect Zelt before you can view leave balances.'}
      </p>
      {isAdmin && (
        <button onClick={onConnect} style={primaryBtn(false)}>Connect Zelt</button>
      )}
    </div>
  );
}

function ErrorBanner({ message, onClose }) {
  return (
    <div style={{
      background: '#FDECEC', border: '1px solid #f5c6c6', color: '#9f2f2f',
      borderRadius: 'var(--r-md)', padding: '12px 16px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      fontSize: 14, fontWeight: 600,
    }}>
      <span>{message}</span>
      <button onClick={onClose} style={{ border: 'none', background: 'none', color: '#9f2f2f', cursor: 'pointer', fontWeight: 700 }}>×</button>
    </div>
  );
}

function ConfidenceBadge({ level }) {
  const map = {
    high: { bg: 'var(--calo-50, #d9f0e5)', fg: 'var(--calo-700, #1e8359)', label: 'High' },
    medium: { bg: '#FFF4D6', fg: '#9A6F0E', label: 'Medium' },
    low: { bg: '#FDECEC', fg: '#9f2f2f', label: 'Low' },
  };
  const m = map[level] || map.low;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', background: m.bg, color: m.fg,
      borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: '.02em',
    }}>{m.label}</span>
  );
}

function Th({ children, onClick, active, dir, align = 'left' }) {
  return (
    <th
      onClick={onClick}
      style={{
        textAlign: align, padding: '12px 14px',
        fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
        color: active ? 'var(--ink-900)' : 'var(--ink-500)',
        background: 'var(--ink-50)', borderBottom: '1px solid var(--ink-200)',
        cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );
}

function Td({ children, align = 'left', mono, bold }) {
  return (
    <td style={{
      padding: '11px 14px', borderBottom: '1px solid var(--ink-100)',
      textAlign: align, fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
      fontWeight: bold ? 700 : 400,
      color: 'var(--ink-900)',
    }}>{children}</td>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-500 border-t-transparent" />
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>
      {children}
    </div>
  );
}

// ---- inline styles ------------------------------------------------

const panel = {
  background: '#fff', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)',
  padding: 24, boxShadow: 'var(--shadow-sm)',
};

const select = {
  width: '100%', padding: '10px 12px', borderRadius: 'var(--r-sm)',
  border: '1px solid var(--ink-200)', background: '#fff',
  fontSize: 14, fontWeight: 600, color: 'var(--ink-900)',
};

const searchInput = {
  ...select, width: 240, fontWeight: 500,
};

const primaryBtn = (disabled) => ({
  background: disabled ? 'var(--ink-200)' : 'var(--calo-500)',
  color: disabled ? 'var(--ink-500)' : '#fff',
  border: 'none', borderRadius: 'var(--r-sm)',
  padding: '11px 22px', fontSize: 14, fontWeight: 800,
  cursor: disabled ? 'not-allowed' : 'pointer',
  letterSpacing: '-0.01em',
  transition: 'background .15s ease',
});

const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: '#fff', color: 'var(--ink-700)',
  border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)',
  padding: '9px 14px', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', textDecoration: 'none',
};

// ---- helpers ------------------------------------------------------

function formatErr(e, fallback) {
  if (e?.status === 503) return 'Zelt is not connected. Ask your admin to connect it.';
  if (e?.status === 403) return 'You do not have access to this action.';
  return e?.message || fallback;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtRelative(ts) {
  if (!ts) return '';
  const ms = Date.now() - ts;
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
