import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from 'react';
import api from '../utils/api';
import { Icon, Btn, Card, Pill, Eyebrow, KpiTile, PageHeader } from '../components/ui';
import { buildBrandedWorkbook } from '../utils/tnaWorkbook';

/**
 * TimeAttendancePage — upload an attendance export (+ optional HR master files),
 * run the per-country overtime engine (UAE 10h; KSA/Kuwait/Bahrain 9h), and view
 * a per-country summary + per-employee detail with Excel/CSV download.
 *
 * Masters are uploaded each run (not stored). Country is resolved from the
 * attendance Department, falling back to the master entity/location.
 */
export default function TimeAttendancePage() {
  const [attendance, setAttendance] = useState(null);   // File
  const [masters, setMasters] = useState([]);           // [{ file, sheet }]
  const [month, setMonth] = useState('');               // 'YYYY-MM' or ''
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'otDays', dir: 'desc' });
  const [inScopeOnly, setInScopeOnly] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpand = (code) => setExpanded((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });

  // Zelt roster (optional source for names + scope, instead of uploading masters)
  const [zeltOn, setZeltOn] = useState(false);
  const [entityOptions, setEntityOptions] = useState([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entities, setEntities] = useState([]); // selected entity names

  useEffect(() => {
    let alive = true;
    api.zeltStatus()
      .then((s) => {
        if (!alive || !s?.connected) return;
        setZeltOn(true);
        setEntitiesLoading(true);
        return api.zeltEntities()
          .then((r) => { if (alive) setEntityOptions(r.entities || []); })
          .finally(() => { if (alive) setEntitiesLoading(false); });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const addMasters = (fileList) => {
    const incoming = Array.from(fileList || []).map((file) => ({ file, sheet: '' }));
    setMasters((m) => [...m, ...incoming].slice(0, 8));
  };
  const removeMaster = (i) => setMasters((m) => m.filter((_, idx) => idx !== i));
  const setMasterSheet = (i, sheet) => setMasters((m) => m.map((x, idx) => idx === i ? { ...x, sheet } : x));

  const run = useCallback(async () => {
    if (!attendance) { setError('Choose an attendance file first.'); return; }
    setLoading(true); setError(null);
    try {
      const result = await api.runTimeAttendance(
        attendance,
        masters.map((m) => m.file),
        { month: month || undefined, masterSheets: masters.map((m) => m.sheet || ''), entities }
      );
      setData(result);
    } catch (e) {
      setError(e?.message || 'Run failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [attendance, masters, month, entities]);

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    let rows = data.rows;
    if (inScopeOnly) rows = rows.filter((r) => r.inScope);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.empCode || '').toLowerCase().includes(q) ||
      (r.dept || '').toLowerCase().includes(q) ||
      (r.position || '').toLowerCase().includes(q)
    );
    const { key, dir } = sort, mul = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
      return String(av ?? '').localeCompare(String(bv ?? '')) * mul;
    });
  }, [data, search, sort, inScopeOnly]);

  const handleSort = (key) => setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  // Downloads honor the "In-scope only" toggle (but not the search box) so the
  // exported file matches the scope you've chosen. The Summary always reports the
  // in-scope per-country OT — that's the deliverable regardless of detail filter.
  const exportRows = useMemo(
    () => (data?.rows || []).filter((r) => !inScopeOnly || r.inScope),
    [data, inScopeOnly]
  );
  const downloadExcel = async () => {
    if (!data) return;
    const mod = await import('exceljs');
    const ExcelJS = mod.default ?? mod;
    const wb = buildBrandedWorkbook(ExcelJS, data, { inScopeOnly, month });
    const buf = await wb.xlsx.writeBuffer();
    triggerDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `calo-time-attendance-${month || 'period'}.xlsx`);
  };
  const downloadCsv = () => {
    if (!data) return;
    const cols = ['empCode', 'name', 'country', 'dept', 'present', 'otDays', 'otHours', 'otDays9', 'source', 'position', 'inScope', 'nameMismatch'];
    const csv = [cols.join(','), ...exportRows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `calo-time-attendance-${month || 'period'}.csv`);
  };

  const flagLines = data ? buildFlagLines(data) : [];
  const hasMasters = data?.masters?.length > 0;

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <PageHeader
        eyebrow="HR · Time & Attendance"
        title="Overtime"
        subtitle="Turn a biometric export into a per-country overtime report. UAE counts OT after 10h; KSA, Kuwait & Bahrain after 9h."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

        {/* Upload + options */}
        <Card padding={26}>
          <details style={{ marginBottom: 18, border: '1px solid var(--ink-200)', borderRadius: 'var(--r-md)', padding: '12px 16px', background: 'var(--ink-50)' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 800, color: 'var(--calo-700)' }}>
              How it works &amp; what the terms mean
            </summary>
            <div style={{ fontSize: 13, color: 'var(--ink-700)', lineHeight: 1.65, marginTop: 12, display: 'grid', gap: 8 }}>
              <div><b>Overtime rule</b> — OT after <b>10h/day in the UAE</b> and <b>9h/day in KSA, Kuwait &amp; Bahrain</b>. Country is read from each employee's Department (or master entity).</div>
              <div><b>In scope</b> — blue-collar production staff counted for OT: matched to a master, with a non-manager/admin position. Only these feed the cards and totals.</div>
              <div><b>Excluded / No position / Unmatched</b> — managers &amp; admins; matched but blank position; or not found in any master.</div>
              <div><b>Days / Nights</b> — click a row for a per-person calendar (hours + check-in/out). <b>Nights</b> = shifts crossing midnight.</div>
              <div><b>Absent (inferred)</b> — no roster, so a work day = most of the team badged in; absence = a work day in the person's span with no badge. On 7-day sites this includes rest days — a review list, not final.</div>
              <div><b>Downloads</b> — Excel &amp; CSV follow the "In-scope only" toggle.</div>
            </div>
          </details>

          <div style={{ display: 'grid', gap: 18 }}>
            <Field label="Attendance export — required (.csv / .xlsx)">
              <FilePicker accept=".csv,.xlsx,.xls" label="Choose attendance file" onPick={(files) => setAttendance(files?.[0] || null)} />
              {attendance && <div style={{ marginTop: 10 }}><FileChip name={attendance.name} onRemove={() => setAttendance(null)} /></div>}
            </Field>

            <Field label="Roster — optional, adds names, blue-collar scope & per-entity filtering">
              <div style={{ display: 'grid', gap: 14 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Pill tone={zeltOn ? 'green' : 'neutral'} size="sm" icon="Plug">Zelt</Pill>
                    <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>
                      {zeltOn ? 'pick the entities you’re reporting — pulls their live roster' : 'not connected — upload master files below instead'}
                    </span>
                  </div>
                  {zeltOn && (
                    <>
                      <EntityPicker options={entityOptions} selected={entities} onChange={setEntities} loading={entitiesLoading} />
                      {entities.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {entities.map((e) => (
                            <span key={e} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', background: 'var(--calo-50)', color: 'var(--calo-800)', border: '1px solid var(--calo-100)', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 700 }}>
                              {e}
                              <button onClick={() => setEntities(entities.filter((x) => x !== e))} title="Remove" style={{ border: 'none', background: 'rgba(0,0,0,.06)', color: 'inherit', cursor: 'pointer', width: 16, height: 16, borderRadius: '50%', fontSize: 12, lineHeight: 1 }}>×</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-400, #9aa6a0)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--ink-100)' }} /> OR UPLOAD FILES <div style={{ flex: 1, height: 1, background: 'var(--ink-100)' }} />
                </div>

                <div>
                  <FilePicker accept=".csv,.xlsx,.xls" multiple label="Add master file(s)" onPick={addMasters} />
                  {masters.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {masters.map((m, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <FileChip name={m.file.name} onRemove={() => removeMaster(i)} />
                          <input
                            value={m.sheet}
                            onChange={(e) => setMasterSheet(i, e.target.value)}
                            placeholder="sheet (optional, e.g. Luqmat Active)"
                            className="input-field"
                            style={{ width: 250, height: 38, fontSize: 13 }}
                            title="Pin a specific sheet to avoid contaminated tabs. Leave blank to auto-detect."
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Field>

            <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Month filter — optional (YYYY-MM)">
                <input value={month} onChange={(e) => setMonth(e.target.value.trim())} placeholder="2026-05 — blank = whole file" className="input-field" style={{ width: 230 }} />
              </Field>
              <Btn variant="primary" size="lg" icon={loading ? undefined : 'Play'} onClick={run} disabled={!attendance || loading}>
                {loading ? 'Running…' : 'Run report'}
              </Btn>
            </div>
          </div>
        </Card>

        {data && (
          <>
            {/* Flags */}
            {flagLines.map((f, i) => (
              <div key={i} style={{ background: '#FEF5E4', border: '1px solid #F6E0B6', borderRadius: 'var(--r-lg)', padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Icon name="TriangleAlert" size={16} color="#8A5A1A" style={{ marginTop: 1, flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: 13, color: '#7A4F12', lineHeight: 1.5 }}>{f}</p>
              </div>
            ))}

            {/* KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
              <KpiTile label="In scope" value={data.scope.inScope} unit="emp" />
              <KpiTile label="OT-days" value={data.totals.otDays} accent />
              <KpiTile label="OT-hours" value={Math.round(data.totals.otHours)} />
              <KpiTile label="Absences" value={data.daily?.totalAbsences ?? 0} />
              <KpiTile label="Overnight" value={data.daily?.totalOvernight ?? 0} />
            </div>

            {/* Executive summary (AI) */}
            {data.narrative && (data.narrative.execSummary || (data.narrative.insights || []).length > 0) && (
              <Card padding={24}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <Eyebrow style={{ margin: 0 }}>Executive Summary</Eyebrow>
                  <Pill tone={data.narrative.ai ? 'green' : 'neutral'} size="sm" icon={data.narrative.ai ? 'Sparkles' : undefined}>{data.narrative.ai ? 'AI' : 'auto'}</Pill>
                </div>
                {data.narrative.execSummary && <p style={{ margin: 0, fontSize: 15, color: 'var(--ink-900)', lineHeight: 1.6 }}>{data.narrative.execSummary}</p>}
                {(data.narrative.insights || []).length > 0 && (
                  <ul style={{ margin: '14px 0 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>
                    {data.narrative.insights.map((ins, i) => (
                      <li key={i} style={{ fontSize: 13.5, color: 'var(--ink-700)', lineHeight: 1.55 }}>{ins}</li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {/* Per-country cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
              {data.byCountry.map((g) => (
                <Card key={g.country} hover padding={22}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Eyebrow style={{ margin: 0, color: 'var(--ink-900)' }}>{g.country}</Eyebrow>
                    <Pill tone="green" size="sm">OT &gt; {g.rule}</Pill>
                  </div>
                  <div className="num" style={{ fontSize: 36, fontWeight: 900, color: 'var(--calo-600)', letterSpacing: '-0.03em', marginTop: 12, lineHeight: 1 }}>
                    {g.otDays}<span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-500)', marginLeft: 6 }}>OT-days</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-600)', marginTop: 8 }}>
                    {g.otHours.toFixed(1)} hours · {g.emps} emp · {g.present} present-days
                  </div>
                  {g.country === 'UAE' && (
                    <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--ink-100)' }}>
                      A flat 9h rule would show {g.otDays9} ({g.otDays9 - g.otDays} more).
                    </div>
                  )}
                </Card>
              ))}
            </div>

            {/* Calendar summary */}
            {data.daily?.periodStart && (
              <Card padding={22}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'center' }}>
                  <div>
                    <Eyebrow style={{ margin: 0 }}>Calendar</Eyebrow>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)', marginTop: 4 }}>{fmtDay(data.daily.periodStart)} → {fmtDay(data.daily.periodEnd)}</div>
                  </div>
                  <Stat label="work-days" value={data.daily.workDays.length} note="inferred" />
                  <Stat label="off-days" value={data.daily.offDays.length} note="inferred" />
                  <Stat label="absences" value={data.daily.totalAbsences} />
                  <Stat label="overnight" value={data.daily.totalOvernight} />
                </div>
                {data.daily.offDays.length === 0 && (
                  <div style={{ marginTop: 14, fontSize: 12.5, color: '#7A4F12', background: '#FEF5E4', border: '1px solid #F6E0B6', borderRadius: 'var(--r-md)', padding: '10px 14px', lineHeight: 1.5 }}>
                    No company-wide off-days detected — this looks like a <b>7-day operation</b>. The absences include individual rest days; review against the roster before acting on them.
                  </div>
                )}
              </Card>
            )}

            {/* Per-employee table */}
            <Card padding={0}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '18px 22px', borderBottom: '1px solid var(--ink-100)' }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.02em' }}>
                    {data.totals.otDays} <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-500)' }}>OT-days</span> · {data.totals.otHours.toFixed(1)} <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-500)' }}>hours</span>
                  </div>
                  {hasMasters && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <Pill tone="green" size="sm">{data.scope.inScope} in scope</Pill>
                      <Pill tone="neutral" size="sm">{data.scope.excluded} excluded</Pill>
                      {data.scope.noPosition > 0 && <Pill tone="amber" size="sm">{data.scope.noPosition} no-position</Pill>}
                      {data.scope.unmatched > 0 && <Pill tone="amber" size="sm">{data.scope.unmatched} unmatched</Pill>}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Btn variant="leaf" size="sm" icon="Download" onClick={downloadExcel}>Excel report</Btn>
                  <Btn variant="secondary" size="sm" icon="Download" onClick={downloadCsv}>CSV</Btn>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 22px' }}>
                <label style={{ fontSize: 13, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontWeight: 600 }}>
                  <input type="checkbox" checked={inScopeOnly} onChange={(e) => setInScopeOnly(e.target.checked)} style={{ accentColor: 'var(--calo-500)', width: 15, height: 15 }} />
                  In-scope only <span style={{ color: 'var(--ink-400, #9aa6a0)', fontWeight: 500 }}>· exports follow this</span>
                </label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID, dept…" className="input-field" style={{ width: 260, height: 38 }} />
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 34, background: 'var(--ink-50)', borderBottom: '1px solid var(--ink-200)' }} />
                      <Th onClick={() => handleSort('empCode')} active={sort.key === 'empCode'} dir={sort.dir}>Emp Code</Th>
                      <Th onClick={() => handleSort('name')} active={sort.key === 'name'} dir={sort.dir}>Name</Th>
                      <Th onClick={() => handleSort('country')} active={sort.key === 'country'} dir={sort.dir}>Country</Th>
                      <Th onClick={() => handleSort('dept')} active={sort.key === 'dept'} dir={sort.dir}>Department</Th>
                      <Th onClick={() => handleSort('position')} active={sort.key === 'position'} dir={sort.dir}>Position</Th>
                      <Th onClick={() => handleSort('daysWorked')} active={sort.key === 'daysWorked'} dir={sort.dir} align="right">Days</Th>
                      <Th onClick={() => handleSort('absentDays')} active={sort.key === 'absentDays'} dir={sort.dir} align="right">Absent</Th>
                      <Th onClick={() => handleSort('overnightDays')} active={sort.key === 'overnightDays'} dir={sort.dir} align="right">Nights</Th>
                      <Th onClick={() => handleSort('otDays')} active={sort.key === 'otDays'} dir={sort.dir} align="right">OT-days</Th>
                      <Th onClick={() => handleSort('otHours')} active={sort.key === 'otHours'} dir={sort.dir} align="right">OT-hours</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={11} style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--ink-500)' }}>No employees match.</td></tr>
                    ) : filtered.map((r, i) => {
                      const open = expanded.has(r.empCode);
                      return (
                        <Fragment key={r.empCode || i}>
                          <tr onClick={() => toggleExpand(r.empCode)} style={{ background: open ? 'var(--calo-50)' : (i % 2 === 0 ? '#fff' : 'var(--ink-50)'), cursor: 'pointer' }}>
                            <Td><span style={{ color: 'var(--ink-500)', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span></Td>
                            <Td mono>{r.empCode}</Td>
                            <Td bold>{r.name || '—'}{r.nameMismatch && <span title="Name disagrees with master — possible ID collision" style={{ marginLeft: 6, color: '#9A6F0E' }}>⚠</span>}</Td>
                            <Td>{r.country}</Td>
                            <Td>{r.dept || '—'}</Td>
                            <Td>{r.position || (r.matched ? <span style={{ color: 'var(--ink-500)' }}>(blank)</span> : '—')}</Td>
                            <Td align="right">{r.daysWorked}</Td>
                            <Td align="right">{r.absentDays ? <span style={{ color: '#9A6F0E', fontWeight: 700 }}>{r.absentDays}</span> : '0'}</Td>
                            <Td align="right">{r.overnightDays || 0}</Td>
                            <Td align="right" bold>{r.otDays}</Td>
                            <Td align="right">{r.otHours.toFixed(1)}</Td>
                          </tr>
                          {open && (
                            <tr><td colSpan={11} style={{ padding: 0, borderBottom: '1px solid var(--ink-200)' }}><EmployeeCalendar row={r} /></td></tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ---- subcomponents -----------------------------------------------

function FilePicker({ accept, multiple, onPick, label }) {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} multiple={multiple} style={{ display: 'none' }}
        onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
      <Btn variant="secondary" size="sm" icon="Upload" onClick={() => ref.current?.click()}>{label}</Btn>
    </>
  );
}
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}
const miniBtn = { background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--ink-700)' };
function EntityPicker({ options, selected, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const toggle = (e) => onChange(selected.includes(e) ? selected.filter((x) => x !== e) : [...selected, e]);
  const label = loading ? 'Loading entities…' : selected.length === 0 ? 'Select entities…' : selected.length === 1 ? selected[0] : `${selected.length} entities selected`;
  return (
    <div ref={ref} style={{ position: 'relative', maxWidth: 420 }}>
      <button type="button" disabled={loading} onClick={() => setOpen((o) => !o)} className="input-field"
        style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', cursor: loading ? 'wait' : 'pointer' }}>
        <span style={{ color: selected.length ? 'var(--ink-900)' : 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: 'var(--ink-500)', marginLeft: 8 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30, background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)', maxHeight: 320, overflowY: 'auto', padding: 6 }}>
          <div style={{ display: 'flex', gap: 6, padding: '4px 6px 8px', borderBottom: '1px solid var(--ink-100)' }}>
            <button type="button" onClick={() => onChange([...options])} style={miniBtn}>Select all</button>
            <button type="button" onClick={() => onChange([])} style={miniBtn}>Clear</button>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => setOpen(false)} style={miniBtn}>Done</button>
          </div>
          {options.length === 0 ? <div style={{ padding: 10, fontSize: 13, color: 'var(--ink-500)' }}>No entities found.</div> :
            options.map((e) => {
              const checked = selected.includes(e);
              return (
                <label key={e} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', cursor: 'pointer', borderRadius: 'var(--r-sm)', background: checked ? 'var(--calo-50)' : 'transparent', fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(e)} style={{ accentColor: 'var(--calo-500)' }} />
                  {e}
                </label>
              );
            })}
        </div>
      )}
    </div>
  );
}
function FileChip({ name, onRemove }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 12px', background: 'var(--calo-50)', color: 'var(--calo-800)', border: '1px solid var(--calo-100)', borderRadius: 'var(--r-pill)', fontSize: 13, fontWeight: 700 }}>
      <Icon name="FileSpreadsheet" size={14} /> {name}
      <button onClick={onRemove} title="Remove" style={{ border: 'none', background: 'rgba(0,0,0,.06)', color: 'inherit', cursor: 'pointer', fontWeight: 900, fontSize: 13, lineHeight: 1, width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
    </span>
  );
}
function ErrorBanner({ message, onClose }) {
  return (
    <div style={{ background: '#FDECEC', border: '1px solid #F5CFCF', color: '#8C2929', borderRadius: 'var(--r-lg)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 14, fontWeight: 600 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="CircleAlert" size={16} /> {message}</span>
      <button onClick={onClose} style={{ border: 'none', background: 'none', color: '#8C2929', cursor: 'pointer', fontWeight: 700, fontSize: 16 }}>×</button>
    </div>
  );
}
function Th({ children, onClick, active, dir, align = 'left' }) {
  return (
    <th onClick={onClick} style={{ textAlign: align, padding: '12px 14px', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: active ? 'var(--ink-900)' : 'var(--ink-500)', background: 'var(--ink-50)', borderBottom: '1px solid var(--ink-200)', cursor: onClick ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {children}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );
}
function Td({ children, align = 'left', mono, bold }) {
  return <td style={{ padding: '11px 14px', borderBottom: '1px solid var(--ink-100)', textAlign: align, fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit', fontWeight: bold ? 700 : 400, color: 'var(--ink-900)' }}>{children}</td>;
}
function Stat({ label, value, note }) {
  return (
    <div>
      <span className="num" style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.02em' }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--ink-500)', marginLeft: 6 }}>{label}{note ? ` (${note})` : ''}</span>
    </div>
  );
}

const legendHd = { fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase' };
const dayChip = (bg, bd) => ({ display: 'inline-flex', flexDirection: 'column', gap: 1, padding: '6px 10px', borderRadius: 'var(--r-md)', background: bg, border: `1px solid ${bd}`, fontSize: 12, minWidth: 76, lineHeight: 1.35 });

function EmployeeCalendar({ row }) {
  const present = row.days || [], absences = row.absences || [];
  return (
    <div style={{ padding: '16px 20px', display: 'grid', gap: 16, background: 'var(--ink-50)' }}>
      <div>
        <div style={legendHd}>Days worked — {present.length}{row.overnightDays ? ` · ${row.overnightDays} overnight 🌙` : ''}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {present.length === 0 ? <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>No attendance recorded.</span> :
            present.map((d) => (
              <div key={d.date} style={dayChip(d.ot ? 'var(--calo-50)' : '#fff', d.ot ? 'var(--calo-100)' : 'var(--ink-200)')} title={`${d.checkIn || '?'}–${d.checkOut || '?'}${d.overnight ? ' (overnight)' : ''}`}>
                <span style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{fmtDay(d.date)} {d.overnight ? '🌙' : ''}</span>
                <span style={{ color: 'var(--ink-700)' }}>{d.hours != null ? `${d.hours.toFixed(2)}h` : '—'}{d.ot ? <span style={{ color: 'var(--calo-700)', fontWeight: 700 }}> ·OT</span> : ''}</span>
                {(d.checkIn || d.checkOut) ? <span style={{ color: 'var(--ink-500)', fontSize: 11 }}>{d.checkIn || '?'}–{d.checkOut || '?'}</span> : null}
              </div>
            ))}
        </div>
      </div>
      {absences.length > 0 && (
        <div>
          <div style={legendHd}>Absent — {absences.length} <span style={{ textTransform: 'none', fontWeight: 600, color: '#9A6F0E' }}>(inferred — review)</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {absences.map((a) => (
              <span key={a.date} style={dayChip('#FEF5E4', '#F6E0B6')}>
                <span style={{ fontWeight: 700, color: '#6B5008' }}>{fmtDay(a.date)}</span>
                <span style={{ color: '#6B5008' }}>{a.weekday}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- helpers ------------------------------------------------------

function buildFlagLines(data) {
  const f = data.flags || {}, s = data.scope || {}, out = [];
  if (f.mastersMatchedNone) out.push(`Master file(s) were uploaded but matched 0 employees — check the file or pin the right sheet. Everyone shows as unmatched and the totals are zero.`);
  if (f.unknownCountry) out.push(`${f.unknownCountry} in-scope employees have an UNKNOWN country (scored at the 9h default) — fix their Department/entity; their OT may be wrong.`);
  if (s.noPosition) out.push(`${s.noPosition} matched employees have a blank position and were NOT counted — fix the master or include them manually.`);
  if (f.ambiguousIds) out.push(`${f.ambiguousIds} IDs map to conflicting people across the masters (left unmatched) — check for reused/duplicate IDs.`);
  if (f.nameMismatches) out.push(`${f.nameMismatches} matched rows have a name that disagrees with the master (possible ID collision) — flagged with ⚠ in the table.`);
  return out;
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function fmtDay(ymd) {
  if (!ymd) return '—';
  return new Date(ymd + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
