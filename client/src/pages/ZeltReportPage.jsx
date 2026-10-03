import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { Card, Pill, Eyebrow, Btn, Icon, PageHeader } from '../components/ui';

// Field catalogue — mirrors server ALL_FIELDS.
//   sensitive = admin-only, never sent to AI.  hidden = defined but not shown yet.
const FIELD_GROUPS = [
  { group: 'Core identity', fields: [
    ['employeeId', 'Emp ID'], ['name', 'Name'], ['department', 'Department'],
    ['jobTitle', 'Job Title'], ['site', 'Site'], ['entity', 'Entity'],
  ]},
  { group: 'Canon structure', fields: [
    ['businessLine', 'Business Line'], ['org', 'Organization'], ['jobFamily', 'Job Family'],
    ['workCountry', 'Work Country'], ['teamBranch', 'Team / Branch'],
    ['locationBranch', 'Location / Branch'], ['cityWork', 'City'],
  ]},
  { group: 'Dates & status', fields: [
    ['startDate', 'Start Date'], ['lengthOfServiceYears', 'Years of Service'], ['accountStatus', 'Status'],
  ]},
  { group: 'Leave balances', fields: [
    ['annualBalance', 'Annual Leave (days)'], ['compensatoryBalance', 'Compensatory (days)'],
  ]},
  { group: 'Personal', sensitive: true, fields: [
    ['age', 'Age'], ['gender', 'Gender'], ['nationality', 'Nationality'],
  ]},
  { group: 'Salary', sensitive: true, hidden: true, fields: [
    ['salaryMonthly', 'Monthly Salary'], ['basicSalary', 'Basic Salary'], ['currency', 'Currency'],
  ]},
];
const LABELS = Object.fromEntries(FIELD_GROUPS.flatMap(g => g.fields));
const SENSITIVE = new Set(['salaryMonthly', 'basicSalary', 'currency', 'age', 'gender', 'nationality']);
const NUMERIC = new Set(['salaryMonthly', 'basicSalary', 'age', 'lengthOfServiceYears', 'annualBalance', 'compensatoryBalance']);

const FILTERS = [
  ['businessLines', 'Business Line', 'businessLines'],
  ['entities', 'Entity', 'entities'],
  ['orgs', 'Organization', 'orgs'],
  ['departments', 'Department', 'departments'],
  ['sites', 'Site', 'sites'],
  ['jobFamilies', 'Job Family', 'jobFamilies'],
  ['workCountries', 'Work Country', 'workCountries'],
];

function fmtVal(key, v) {
  if (v == null || v === '') return '—';
  if (key === 'salaryMonthly' || key === 'basicSalary') return Number(v).toLocaleString();
  if (key === 'annualBalance' || key === 'compensatoryBalance') return `${v}d`;
  if (key === 'lengthOfServiceYears') return `${v}y`;
  if (key === 'startDate') return String(v).slice(0, 10);
  return String(v);
}

export default function ZeltReportPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [dims, setDims] = useState(null);
  const [index, setIndex] = useState({ ready: false, building: false, progress: { done: 0, total: 0 } });
  const [filters, setFilters] = useState({});
  const [fields, setFields] = useState(['name', 'department', 'businessLine', 'entity']);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const pollRef = useRef(null);

  // Warm the people index on mount, then poll dimensions until ready.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await api.zeltReportDimensions();
        if (!alive) return;
        setIndex(d.status || { ready: d.ready });
        if (d.ready) { setDims(d.dimensions); if (pollRef.current) clearInterval(pollRef.current); }
      } catch { /* keep polling */ }
    };
    api.zeltReportWarm(false).catch(() => {});
    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { alive = false; if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const toggleFilter = (dimKey, value) => setFilters(f => {
    const cur = new Set(f[dimKey] || []);
    cur.has(value) ? cur.delete(value) : cur.add(value);
    return { ...f, [dimKey]: [...cur] };
  });
  const toggleField = (key) => setFields(f => f.includes(key) ? f.filter(x => x !== key) : [...f, key]);
  const clearFilters = () => setFilters({});

  const activeFilterCount = Object.values(filters).reduce((n, a) => n + (a?.length || 0), 0);

  const run = async () => {
    if (!fields.length) { toast.error('Pick at least one field'); return; }
    setRunning(true); setResult(null);
    try {
      const r = await api.zeltReportRun(filters, fields);
      if (r.building) { toast('Still building the people index — try again in a moment.'); setIndex(r.status); return; }
      setResult(r);
      if (r.sensitiveDenied) toast('Salary / age / gender need admin access — those columns were dropped.', { icon: '🔒' });
    } catch (err) { toast.error(err.message || 'Report failed'); }
    finally { setRunning(false); }
  };

  const downloadCsv = () => {
    if (!result) return;
    const cols = result.fields;
    const head = cols.map(c => LABELS[c] || c).join(',');
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = result.rows.map(row => cols.map(c => esc(row[c])).join(',')).join('\n');
    const blob = new Blob([head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `calo-zelt-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // Push a SMART SUMMARY report (not the raw row list): headline KPIs, a written
  // overview, and clean breakdown tables by business line / department / entity —
  // built from PII-free aggregates.
  const pushToReport = async () => {
    if (!result) return;
    const agg = result.aggregates || {};
    const clean = (arr) => (arr || []).filter(x => x.key && x.key !== '(none)');
    const bl = clean(agg.byBusinessLine), dep = clean(agg.byDepartment), ent = clean(agg.byEntity), org = clean(agg.byOrg);
    const total = agg.headcount ?? result.count;
    const pct = (n) => total ? Math.round((n / total) * 100) : 0;

    const filterText = FILTERS.filter(([k]) => filters[k]?.length).map(([k, label]) => `${label}: ${filters[k].join(' / ')}`).join('  ·  ') || 'All employees';
    const title = (bl.length === 1 ? `${bl[0].key} — people summary` : `People summary — ${filterText}`).slice(0, 90);

    // Written overview bullets (deterministic, no AI, no PII).
    const bullets = [`${total} employees in scope (${filterText}).`];
    if (bl.length) bullets.push(`Largest business line: ${bl[0].key} with ${bl[0].count} people (${pct(bl[0].count)}% of the group).`);
    if (dep.length) bullets.push(`Top department: ${dep[0].key} (${dep[0].count}). ${dep.length} departments represented.`);
    if (ent.length > 1) bullets.push(`Spread across ${ent.length} entities; ${ent[0].key} is the biggest (${ent[0].count}).`);
    if (bl.length && pct(bl[0].count) >= 60) bullets.push(`Concentration: ${pct(bl[0].count)}% sit in a single business line.`);
    if (agg.annualBalance) bullets.push(`Average annual-leave balance: ${agg.annualBalance.avgDays} days (${agg.annualBalance.totalDays} days of liability across ${agg.annualBalance.employees} people).`);
    if (agg.compensatoryBalance) bullets.push(`Compensatory days outstanding: ${agg.compensatoryBalance.totalDays} across ${agg.compensatoryBalance.employees} people.`);

    const kpiStrip = [
      { label: 'Headcount', value: String(total) },
      bl.length ? { label: 'Business lines', value: String(bl.length) } : null,
      dep.length ? { label: 'Departments', value: String(dep.length) } : null,
      ent.length ? { label: 'Entities', value: String(ent.length) } : null,
    ].filter(Boolean);

    const breakdownTable = (rows) => ({
      type: 'table', headers: ['', 'Headcount', 'Share'],
      rows: rows.map(r => [r.key, String(r.count), `${pct(r.count)}%`]),
    });

    const sections = [{
      title: 'Overview', icon: 'Users',
      blocks: [
        { type: 'callout', title: 'In scope', value: `${total} employees`, bgColor: '#0A1F17' },
        { type: 'badge', style: 'green', title: filterText, period: `Live from Zelt · ${new Date().toLocaleDateString()}` },
        { type: 'notes', label: 'Summary', items: bullets },
      ],
    }];
    if (bl.length) sections.push({ title: 'By business line', icon: 'Layers', blocks: [
      { type: 'metrics', items: bl.slice(0, 8).map(b => ({ label: b.key, value: String(b.count), change: `${pct(b.count)}%` })) },
      breakdownTable(bl),
    ]});
    if (dep.length) sections.push({ title: 'By department', icon: 'Building', blocks: [breakdownTable(dep.slice(0, 15))] });
    if (ent.length > 1) sections.push({ title: 'By entity', icon: 'MapPin', blocks: [breakdownTable(ent)] });
    if (org.length > 1) sections.push({ title: 'By organization', icon: 'Network', blocks: [breakdownTable(org)] });
    if (agg.annualBalance || agg.compensatoryBalance) {
      const items = [];
      if (agg.annualBalance) items.push({ label: 'Avg annual leave', value: `${agg.annualBalance.avgDays}d` }, { label: 'Total annual liability', value: `${agg.annualBalance.totalDays}d` });
      if (agg.compensatoryBalance) items.push({ label: 'Compensatory outstanding', value: `${agg.compensatoryBalance.totalDays}d` });
      sections.push({ title: 'Leave balances', icon: 'CalendarCheck', blocks: [{ type: 'metrics', items }] });
    }

    try {
      const res = await api.createReport({
        title,
        description: `Summary from live Zelt · ${total} employees · ${new Date().toLocaleDateString()}`,
        reportData: { generalInfo: { title, brandColor: '#02B376', kpiStrip }, sections },
        tags: ['zelt', 'people'],
      });
      toast.success('Summary report created');
      navigate(`/reports/${res.id}`);
    } catch (err) { toast.error(err.message || 'Failed to create report'); }
  };

  return (
    <div className="animate-slide-up" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader
        eyebrow="REPORTS"
        title="Report from Zelt"
        subtitle="Filter live Zelt people by business line, org, department or entity — then generate a report or export."
      />

      {/* Index building banner */}
      {!index.ready && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 20, height: 20, borderRadius: 10, border: '3px solid var(--calo-100)', borderTopColor: 'var(--calo-500)', animation: 'spinner 1s linear infinite', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Building the people index…</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
                Pulling business line / org / job family from Zelt once (cached 6h after this).
                {index.progress?.total ? ` ${index.progress.done}/${index.progress.total}` : ''}
                {index.error ? ` · ${index.error}` : ''}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="zr-grid" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, alignItems: 'start' }}>
        {/* Left: filters + fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Eyebrow>Filters</Eyebrow>
              {activeFilterCount > 0 && <button onClick={clearFilters} style={linkBtn}>Clear ({activeFilterCount})</button>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', margin: '6px 0 10px' }}>
              Pick none to include everyone. Multiple values in a filter = any of them (e.g. Retail + Calo Now).
            </div>
            {!dims ? <div style={{ fontSize: 13, color: 'var(--ink-400)' }}>Loading options…</div> :
              FILTERS.map(([key, label, dimKey]) => {
                const opts = dims[dimKey] || [];
                if (!opts.length) return null;
                return (
                  <div key={key} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-700)', marginBottom: 6 }}>
                      {label} {filters[key]?.length ? <span style={{ color: 'var(--calo-600)' }}>· {filters[key].length}</span> : ''}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 132, overflowY: 'auto' }}>
                      {opts.map(o => {
                        const on = (filters[key] || []).includes(o);
                        return (
                          <button key={o} onClick={() => toggleFilter(key, o)}
                            style={{
                              fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                              border: `1px solid ${on ? 'var(--calo-500)' : 'var(--ink-200)'}`,
                              background: on ? 'var(--calo-500)' : '#fff', color: on ? '#fff' : 'var(--ink-700)',
                            }}>{o}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </Card>

          <Card>
            <Eyebrow>Columns</Eyebrow>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {FIELD_GROUPS.map(g => {
                if (g.hidden) return null;            // Salary hidden until the bot gets payroll access
                if (g.sensitive && !isAdmin) return null;
                return (
                  <div key={g.group}>
                    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase', color: g.sensitive ? '#B45309' : 'var(--ink-400)', marginBottom: 6 }}>
                      {g.group}{g.sensitive ? ' · admin, never sent to AI' : ''}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {g.fields.map(([key, label]) => {
                        const on = fields.includes(key);
                        return (
                          <button key={key} onClick={() => toggleField(key)}
                            style={{
                              fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                              border: `1px solid ${on ? (g.sensitive ? '#B45309' : 'var(--calo-500)') : 'var(--ink-200)'}`,
                              background: on ? (g.sensitive ? '#FEF3E2' : 'var(--calo-50)') : '#fff',
                              color: on ? (g.sensitive ? '#B45309' : 'var(--calo-700)') : 'var(--ink-600)',
                            }}>{on ? '✓ ' : ''}{label}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <Btn variant="primary" icon="Play" full onClick={run} disabled={running || !index.ready}
              style={{ marginTop: 16 }}>
              {running ? 'Generating…' : 'Generate report'}
            </Btn>
          </Card>
        </div>

        {/* Right: results */}
        <div>
          {!result ? (
            <Card style={{ textAlign: 'center', padding: '56px 24px' }}>
              <Icon name="Table" size={32} color="var(--ink-300)" />
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 12, color: 'var(--ink-700)' }}>No report yet</div>
              <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 4, maxWidth: 420, marginInline: 'auto' }}>
                Pick your filters and columns on the left, then Generate. Example: Business Line = Retail + Calo Now, columns = Name, Department, Entity.
              </div>
            </Card>
          ) : (
            <Card padding={0}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ink-200)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 900 }}>{result.count} employees</div>
                <div style={{ flex: 1 }} />
                <Btn variant="secondary" size="sm" icon="Download" onClick={downloadCsv}>CSV</Btn>
                <Btn variant="primary" size="sm" icon="FileText" onClick={pushToReport}>Create summary report</Btn>
              </div>

              {/* KPI strip (PII-free) */}
              {result.aggregates?.byBusinessLine?.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 18px', borderBottom: '1px solid var(--ink-100)', background: 'var(--ink-50)' }}>
                  {result.aggregates.byBusinessLine.slice(0, 6).map(b => (
                    <span key={b.key} style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-700)', background: '#fff', border: '1px solid var(--ink-200)', padding: '4px 10px', borderRadius: 999 }}>
                      {b.key}: <b>{b.count}</b>
                    </span>
                  ))}
                  {result.aggregates?.annualBalance && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--calo-700)', background: 'var(--calo-50)', border: '1px solid var(--calo-200)', padding: '4px 10px', borderRadius: 999 }}>
                      avg annual leave: <b>{result.aggregates.annualBalance.avgDays}d</b>
                    </span>
                  )}
                  {result.aggregates?.compensatoryBalance && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--calo-700)', background: 'var(--calo-50)', border: '1px solid var(--calo-200)', padding: '4px 10px', borderRadius: 999 }}>
                      comp outstanding: <b>{result.aggregates.compensatoryBalance.totalDays}d</b>
                    </span>
                  )}
                </div>
              )}

              <div style={{ overflowX: 'auto', maxHeight: '64vh', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--ink-900)', color: '#fff', zIndex: 1 }}>
                    <tr>{result.fields.map(c => (
                      <th key={c} style={{ textAlign: NUMERIC.has(c) ? 'right' : 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{LABELS[c] || c}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {result.rows.length === 0 ? (
                      <tr><td colSpan={result.fields.length} style={{ padding: '28px', textAlign: 'center', color: 'var(--ink-500)' }}>No employees match these filters.</td></tr>
                    ) : result.rows.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 ? 'var(--ink-50)' : '#fff' }}>
                        {result.fields.map(c => (
                          <td key={c} style={{ padding: '9px 14px', whiteSpace: 'nowrap', textAlign: NUMERIC.has(c) ? 'right' : 'left', fontWeight: c === 'name' ? 700 : 400 }}>
                            {fmtVal(c, row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>

      <style>{`@media (max-width: 900px) { .zr-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

const linkBtn = { background: 'none', border: 'none', color: 'var(--calo-600)', fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: 0 };
