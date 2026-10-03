import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { Card, Pill, Eyebrow, Btn, Icon, PageHeader } from '../components/ui';

// Field catalogue — mirrors server ALL_FIELDS. `sensitive` = admin-only, never to AI.
const FIELD_GROUPS = [
  { group: 'Core identity', fields: [
    ['employeeId', 'Emp ID'], ['name', 'Name'], ['department', 'Department'],
    ['jobTitle', 'Job Title'], ['site', 'Site'], ['entity', 'Entity'],
  ]},
  { group: 'Canon structure', fields: [
    ['businessLine', 'Business Line'], ['org', 'Organization'], ['jobFamily', 'Job Family'],
    ['workCountry', 'Work Country'], ['teamBranch', 'Team / Branch'],
  ]},
  { group: 'Dates & status', fields: [
    ['startDate', 'Start Date'], ['lengthOfServiceYears', 'Years of Service'], ['accountStatus', 'Status'],
  ]},
  { group: 'Salary, age & gender', sensitive: true, fields: [
    ['salaryMonthly', 'Monthly Salary'], ['basicSalary', 'Basic Salary'], ['currency', 'Currency'],
    ['age', 'Age'], ['gender', 'Gender'],
  ]},
];
const LABELS = Object.fromEntries(FIELD_GROUPS.flatMap(g => g.fields));
const SENSITIVE = new Set(['salaryMonthly', 'basicSalary', 'currency', 'age', 'gender']);

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
  const wantsSensitive = fields.some(f => SENSITIVE.has(f));

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

  // Push to the report builder as a private report (table block + PII-free KPI strip).
  const pushToReport = async () => {
    if (!result) return;
    const cols = result.fields;
    const agg = result.aggregates || {};
    const kpiStrip = [
      { label: 'Headcount', value: String(agg.headcount ?? result.count) },
      ...(agg.byBusinessLine || []).slice(0, 3).map(b => ({ label: b.key, value: String(b.count) })),
    ];
    const blocks = [{
      type: 'table',
      headers: cols.map(c => LABELS[c] || c),
      rows: result.rows.map(row => cols.map(c => fmtVal(c, row[c]))),
    }];
    // Headcount-by-BL as a metrics block too (always safe, no PII).
    if ((agg.byBusinessLine || []).length) {
      blocks.unshift({
        type: 'metrics',
        items: agg.byBusinessLine.slice(0, 8).map(b => ({ label: b.key, value: String(b.count) })),
      });
    }
    const filterText = FILTERS.filter(([k]) => filters[k]?.length).map(([k, label]) => `${label}: ${filters[k].join(', ')}`).join(' · ') || 'All employees';
    const title = `Zelt report — ${filterText}`.slice(0, 90);
    try {
      const res = await api.createReport({
        title,
        description: `Generated from live Zelt · ${result.count} employees · ${new Date().toLocaleDateString()}`,
        reportData: {
          generalInfo: { title, brandColor: '#02B376', kpiStrip },
          sections: [{ title: 'People', icon: 'Users', blocks }],
        },
        tags: ['zelt', 'people'],
      });
      toast.success('Report created');
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
                Pick your filters and columns on the left, then Generate. Example: Business Line = Retail + Calo Now, column = Monthly Salary.
              </div>
            </Card>
          ) : (
            <Card padding={0}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ink-200)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 900 }}>{result.count} employees</div>
                {wantsSensitive && isAdmin && <Pill tone="amber" size="sm">contains salary/personal · keep private</Pill>}
                <div style={{ flex: 1 }} />
                <Btn variant="secondary" size="sm" icon="Download" onClick={downloadCsv}>CSV</Btn>
                <Btn variant="primary" size="sm" icon="FileText" onClick={pushToReport}>Create report</Btn>
              </div>

              {/* KPI strip (PII-free) */}
              {result.aggregates?.byBusinessLine?.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 18px', borderBottom: '1px solid var(--ink-100)', background: 'var(--ink-50)' }}>
                  {result.aggregates.byBusinessLine.slice(0, 6).map(b => (
                    <span key={b.key} style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-700)', background: '#fff', border: '1px solid var(--ink-200)', padding: '4px 10px', borderRadius: 999 }}>
                      {b.key}: <b>{b.count}</b>
                    </span>
                  ))}
                  {result.aggregates?.salary?.map(s => (
                    <span key={s.currency} style={{ fontSize: 12, fontWeight: 700, color: '#7A4F12', background: '#FEF5E4', border: '1px solid #F6E0B6', padding: '4px 10px', borderRadius: 999 }}>
                      {s.currency}: total {s.totalMonthly.toLocaleString()}/mo · avg {s.avgMonthly.toLocaleString()}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ overflowX: 'auto', maxHeight: '64vh', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--ink-900)', color: '#fff', zIndex: 1 }}>
                    <tr>{result.fields.map(c => (
                      <th key={c} style={{ textAlign: SENSITIVE.has(c) && c !== 'currency' && c !== 'gender' ? 'right' : 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{LABELS[c] || c}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {result.rows.length === 0 ? (
                      <tr><td colSpan={result.fields.length} style={{ padding: '28px', textAlign: 'center', color: 'var(--ink-500)' }}>No employees match these filters.</td></tr>
                    ) : result.rows.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 ? 'var(--ink-50)' : '#fff' }}>
                        {result.fields.map(c => (
                          <td key={c} style={{ padding: '9px 14px', whiteSpace: 'nowrap', textAlign: (c === 'salaryMonthly' || c === 'basicSalary' || c === 'age' || c === 'lengthOfServiceYears') ? 'right' : 'left', fontWeight: c === 'name' ? 700 : 400 }}>
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
