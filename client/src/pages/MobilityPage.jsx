import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../utils/api';
import { Icon, Btn, Card, Pill, KpiTile, PageHeader } from '../components/ui';

/**
 * MobilityPage — headcount, joiners/leavers and turnover computed live from
 * Zelt over the trailing 12 months. Admin-only (route wrapped in AdminRoute).
 * Charts are pure CSS bars — no chart library.
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(ym) {
  const parts = String(ym || '').split('-');
  const idx = parseInt(parts[1], 10) - 1;
  return MONTH_NAMES[idx] || ym || '—';
}

function fmt1(v) {
  return (v == null || isNaN(Number(v))) ? '—' : Number(v).toFixed(1);
}

function fmtInt(v) {
  return (v == null || isNaN(Number(v))) ? '—' : Number(v).toLocaleString();
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Mirrors ZeltLeavePage's formatErr — translate transport errors into
// something a human can act on.
function formatErr(e, fallback) {
  if (e?.status === 503) return 'Zelt is not connected. Ask your admin to connect it.';
  if (e?.status === 403) return 'You do not have access to this page.';
  return e?.message || fallback;
}

function reasonTone(reason) {
  const r = String(reason || '').toLowerCase();
  if (r === 'voluntary') return 'green';
  if (r === 'involuntary') return 'red';
  return 'neutral';
}

// ---- shared table styles ----------------------------------------------------

const th = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.05em', textTransform: 'uppercase', borderBottom: '1px solid var(--ink-200)', whiteSpace: 'nowrap' };
const thNum = { ...th, textAlign: 'right' };
const td = { padding: '8px 12px', fontSize: 13, color: 'var(--ink-900)', borderBottom: '1px solid var(--ink-100)' };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const sectionHd = { fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 12 };

export default function MobilityPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.zeltMobility()
      .then(r => setData(r))
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredLeavers = useMemo(() => {
    const rows = data?.leavers || [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(l =>
      String(l.name || '').toLowerCase().includes(q) ||
      String(l.employeeId || '').toLowerCase().includes(q) ||
      String(l.dept || '').toLowerCase().includes(q)
    );
  }, [data, search]);

  if (loading) {
    return (
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <Header />
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-500 border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    const notConnected = error?.status === 503;
    return (
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <Header />
        <Card padding={48} style={{ textAlign: 'center' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px',
            background: 'var(--calo-50)', color: 'var(--calo-700)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={notConnected ? 'Plug' : 'CircleAlert'} size={26} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink-900)', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
            {notConnected ? 'Zelt not connected' : 'Couldn’t load mobility data'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--ink-500)', maxWidth: 480, margin: '0 auto 24px' }}>
            {formatErr(error, 'Failed to load mobility data')}
          </p>
          <Btn variant="secondary" size="sm" icon="RefreshCw" onClick={load}>Try again</Btn>
        </Card>
      </div>
    );
  }

  const totals = data.totals || {};
  const months = data.months || [];
  const coverage = data.coverage || {};
  const maxHeadcount = Math.max(...months.map(m => m.headcount || 0), 1);
  const tenure = data.tenure || [];
  const maxTenure = Math.max(...tenure.map(t => t.count || 0), 1);
  const showCoverage = (coverage.leaversNoDate > 0) || (coverage.activesNoStart > 0);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <Header
        actions={data.asOf && <Pill tone="neutral" size="sm" icon="Clock">as of {fmtDate(data.asOf)}</Pill>}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
          <KpiTile label="Headcount now" value={fmtInt(totals.headcountNow)} accent />
          <KpiTile label="Joiners 12m" value={fmtInt(totals.joiners12m)} />
          <KpiTile label="Leavers 12m" value={fmtInt(totals.leavers12m)} />
          <KpiTile label="Turnover" value={fmt1(totals.annualizedTurnoverPct)} unit="%" />
          <KpiTile label="Early attrition" value={fmt1(totals.earlyAttritionPct)} unit="%" />
        </div>

        {/* Monthly trend */}
        <Card padding={24}>
          <div style={sectionHd}>Monthly trend — headcount, trailing 12 months</div>

          {/* CSS bar chart */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150, padding: '0 4px' }}>
            {months.map(m => (
              <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }} title={`${m.month} — ${fmtInt(m.headcount)} headcount`}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-500)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(m.headcount)}</div>
                <div style={{
                  width: '100%', maxWidth: 44,
                  height: `${Math.max(3, Math.round(((m.headcount || 0) / maxHeadcount) * 100))}px`,
                  background: 'var(--calo-500)', borderRadius: '4px 4px 0 0',
                  transition: 'height .2s ease',
                }} />
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-500)' }}>{monthLabel(m.month)}</div>
              </div>
            ))}
          </div>

          {/* Compact monthly table */}
          <div style={{ overflowX: 'auto', marginTop: 18, borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Month</th>
                  <th style={thNum}>Headcount</th>
                  <th style={thNum}>Joiners</th>
                  <th style={thNum}>Leavers</th>
                  <th style={thNum}>Turnover %</th>
                </tr>
              </thead>
              <tbody>
                {months.map(m => (
                  <tr key={m.month}>
                    <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.month}</td>
                    <td style={tdNum}>{fmtInt(m.headcount)}</td>
                    <td style={{ ...tdNum, color: (m.joiners || 0) > 0 ? 'var(--calo-700)' : 'var(--ink-500)', fontWeight: 700 }}>
                      {(m.joiners || 0) > 0 ? `+${m.joiners}` : '0'}
                    </td>
                    <td style={tdNum}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                        <span style={{ color: (m.leavers || 0) > 0 ? '#8A5A1A' : 'var(--ink-500)', fontWeight: 700 }}>
                          {(m.leavers || 0) > 0 ? `−${m.leavers}` : '0'}
                        </span>
                        {(m.voluntary || 0) > 0 && <Pill tone="green" size="sm">{m.voluntary} vol</Pill>}
                        {(m.involuntary || 0) > 0 && <Pill tone="red" size="sm">{m.involuntary} invol</Pill>}
                      </span>
                    </td>
                    <td style={tdNum}>{fmt1(m.turnoverPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* By entity / by department */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20 }}>
          <BreakdownCard title="By entity" rows={data.byEntity || []} />
          <BreakdownCard title="By department" rows={data.byDept || []} />
        </div>

        {/* Tenure mix */}
        <Card padding={24}>
          <div style={sectionHd}>Tenure mix — active employees</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tenure.map(t => (
              <div key={t.bucket} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 110, fontSize: 12.5, fontWeight: 700, color: 'var(--ink-700)', flexShrink: 0, textAlign: 'right' }}>{t.bucket}</div>
                <div style={{ flex: 1, height: 20, background: 'var(--ink-100)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(1, ((t.count || 0) / maxTenure) * 100)}%`,
                    height: '100%', background: 'var(--calo-500)', borderRadius: 'var(--r-pill)',
                    transition: 'width .2s ease',
                  }} />
                </div>
                <div style={{ width: 52, fontSize: 13, fontWeight: 800, color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(t.count)}</div>
              </div>
            ))}
            {tenure.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-500)' }}>No tenure data.</div>}
          </div>
        </Card>

        {/* Leavers table */}
        <Card padding={24}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ ...sectionHd, marginBottom: 0 }}>Leavers (last 12 months) — {filteredLeavers.length}{search ? ` of ${(data.leavers || []).length}` : ''}</div>
            <input
              className="input-field"
              placeholder="Search name, ID or department…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ maxWidth: 280 }}
            />
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={th}>ID</th>
                  <th style={th}>Entity</th>
                  <th style={th}>Department</th>
                  <th style={th}>Position</th>
                  <th style={th}>Leave date</th>
                  <th style={thNum}>Tenure</th>
                  <th style={th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeavers.map((l, i) => (
                  <tr key={`${l.employeeId || l.name || 'row'}-${i}`}>
                    <td style={{ ...td, fontWeight: 700 }}>{l.name || '—'}</td>
                    <td style={{ ...td, color: 'var(--ink-500)' }}>{l.employeeId || '—'}</td>
                    <td style={td}>{l.entity || '—'}</td>
                    <td style={td}>{l.dept || '—'}</td>
                    <td style={td}>{l.position || '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(l.leaveDate)}</td>
                    <td style={tdNum}>{l.tenureMonths == null ? '—' : `${l.tenureMonths} mo`}</td>
                    <td style={td}><Pill tone={reasonTone(l.reason)} size="sm">{l.reason || 'unknown'}</Pill></td>
                  </tr>
                ))}
                {filteredLeavers.length === 0 && (
                  <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--ink-500)', padding: 24 }}>No leavers{search ? ' match your search' : ' in the last 12 months'}.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Coverage footnote — amber-tinted like the T&A caveat banners */}
        {showCoverage && (
          <div style={{ background: '#FEF5E4', border: '1px solid #F6E0B6', borderRadius: 'var(--r-lg)', padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="TriangleAlert" size={16} color="#8A5A1A" style={{ marginTop: 1, flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: 12.5, color: '#7A4F12', lineHeight: 1.5 }}>
              {coverage.leaversNoDate || 0} leavers missing leave date and {coverage.activesNoStart || 0} actives missing start date are excluded from the time series.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ actions }) {
  return (
    <PageHeader
      eyebrow="HR · Zelt"
      title="Mobility & Turnover"
      subtitle="Computed live from Zelt — headcount, joiners, leavers and annualized turnover over the trailing 12 months."
      actions={actions}
    />
  );
}

function BreakdownCard({ title, rows }) {
  return (
    <Card padding={24}>
      <div style={sectionHd}>{title}</div>
      <div style={{ overflowX: 'auto', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>{title === 'By entity' ? 'Entity' : 'Department'}</th>
              <th style={thNum}>Headcount</th>
              <th style={thNum}>Joiners</th>
              <th style={thNum}>Leavers</th>
              <th style={thNum}>Turnover %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.key || 'row'}-${i}`}>
                <td style={{ ...td, fontWeight: 700 }}>{r.key || '—'}</td>
                <td style={tdNum}>{fmtInt(r.headcount)}</td>
                <td style={{ ...tdNum, color: (r.joiners12m || 0) > 0 ? 'var(--calo-700)' : 'var(--ink-500)' }}>{fmtInt(r.joiners12m)}</td>
                <td style={{ ...tdNum, color: (r.leavers12m || 0) > 0 ? '#8A5A1A' : 'var(--ink-500)' }}>{fmtInt(r.leavers12m)}</td>
                <td style={tdNum}>{fmt1(r.turnoverPct)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--ink-500)', padding: 20 }}>No data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
