import { useState, useMemo, useCallback } from 'react';
import api from '../utils/api';
import { Icon } from '../components/ui';

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
        { month: month || undefined, masterSheets: masters.map((m) => m.sheet || '') }
      );
      setData(result);
    } catch (e) {
      setError(e?.message || 'Run failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [attendance, masters, month]);

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

  const downloadExcel = () => {
    if (!data?.xlsxBase64) return;
    const bytes = atob(data.xlsxBase64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    triggerDownload(new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), data.xlsxFilename || 'time-attendance.xlsx');
  };
  const downloadCsv = () => {
    if (!data?.rows) return;
    const cols = ['empCode', 'name', 'country', 'dept', 'present', 'otDays', 'otHours', 'otDays9', 'source', 'position', 'inScope', 'nameMismatch'];
    const csv = [cols.join(','), ...data.rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `time-attendance-${month || 'period'}.csv`);
  };

  const flagLines = data ? buildFlagLines(data) : [];

  return (
    <PageWrap>
      <Header />

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {/* Upload + options */}
      <div style={panel}>
        <div style={{ fontSize: 13, color: 'var(--ink-700)', marginBottom: 16, lineHeight: 1.5 }}>
          Overtime rule: <b>UAE after 10h</b> · <b>KSA / Kuwait / Bahrain after 9h</b>. Upload the attendance
          export, plus the HR master file(s) so the report can name employees and scope to blue-collar production.
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          <Field label="Attendance export (required) — .csv / .xlsx">
            <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setAttendance(e.target.files?.[0] || null)} style={fileInput} />
            {attendance && <FileChip name={attendance.name} onRemove={() => setAttendance(null)} />}
          </Field>

          <Field label="HR master file(s) — optional, enables names + scope">
            <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={(e) => { addMasters(e.target.files); e.target.value = ''; }} style={fileInput} />
            {masters.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {masters.map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <FileChip name={m.file.name} onRemove={() => removeMaster(i)} />
                    <input
                      value={m.sheet}
                      onChange={(e) => setMasterSheet(i, e.target.value)}
                      placeholder="sheet (optional, e.g. Luqmat Active)"
                      style={{ ...select, width: 240, fontWeight: 500 }}
                      title="Pin a specific sheet to avoid contaminated tabs. Leave blank to auto-detect."
                    />
                  </div>
                ))}
              </div>
            )}
          </Field>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Month filter (optional) — YYYY-MM">
              <input value={month} onChange={(e) => setMonth(e.target.value.trim())} placeholder="e.g. 2026-05 (blank = whole file)" style={{ ...select, width: 220 }} />
            </Field>
            <button onClick={run} disabled={!attendance || loading} style={primaryBtn(!attendance || loading)}>
              {loading ? 'Running…' : 'Run report'}
            </button>
          </div>
        </div>
      </div>

      {data && (
        <>
          {/* Scope + flags */}
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ fontSize: 14, color: 'var(--ink-700)' }}>
                <b>{data.attendance.employees}</b> employees in the file
                {data.masters?.length > 0 && <>
                  {' · '}<b>{data.scope.inScope}</b> in scope · {data.scope.excluded} excluded (mgr/admin) · {data.scope.noPosition} no-position · {data.scope.unmatched} unmatched
                </>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={downloadExcel} style={ghostBtn}><Icon name="Download" size={16} /> Excel</button>
                <button onClick={downloadCsv} style={ghostBtn}><Icon name="Download" size={16} /> CSV</button>
              </div>
            </div>
          </div>

          {flagLines.map((f, i) => (
            <div key={i} style={{ ...panel, background: '#FFF8E5', borderColor: '#F1D785', padding: '12px 18px' }}>
              <p style={{ margin: 0, fontSize: 13, color: '#6B5008', lineHeight: 1.5 }}>⚠ {f}</p>
            </div>
          ))}

          {/* Per-country cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {data.byCountry.map((g) => (
              <div key={g.country} style={panel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink-900)' }}>{g.country}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-500)' }}>OT &gt; {g.rule}</div>
                </div>
                <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--calo-600, #02B376)', letterSpacing: '-0.02em', marginTop: 8 }}>
                  {g.otDays} <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-500)' }}>OT-days</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-700)', marginTop: 4 }}>
                  {g.otHours.toFixed(1)} OT-hours · {g.emps} emp · {g.present} present-days
                </div>
                {g.country === 'UAE' && (
                  <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 6 }}>
                    A flat 9h rule would show {g.otDays9} OT-days ({g.otDays9 - g.otDays} more).
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Per-employee table */}
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.02em' }}>
                {data.totals.otDays} OT-days · {data.totals.otHours.toFixed(1)} hours <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-500)' }}>({data.totals.employees} in scope)</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 13, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={inScopeOnly} onChange={(e) => setInScopeOnly(e.target.checked)} style={{ accentColor: 'var(--calo-500)' }} />
                  In-scope only
                </label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID, dept…" style={searchInput} />
              </div>
            </div>
            <div style={{ overflowX: 'auto', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <Th onClick={() => handleSort('empCode')} active={sort.key === 'empCode'} dir={sort.dir}>Emp Code</Th>
                    <Th onClick={() => handleSort('name')} active={sort.key === 'name'} dir={sort.dir}>Name</Th>
                    <Th onClick={() => handleSort('country')} active={sort.key === 'country'} dir={sort.dir}>Country</Th>
                    <Th onClick={() => handleSort('dept')} active={sort.key === 'dept'} dir={sort.dir}>Department</Th>
                    <Th onClick={() => handleSort('position')} active={sort.key === 'position'} dir={sort.dir}>Position</Th>
                    <Th onClick={() => handleSort('present')} active={sort.key === 'present'} dir={sort.dir} align="right">Present</Th>
                    <Th onClick={() => handleSort('otDays')} active={sort.key === 'otDays'} dir={sort.dir} align="right">OT-days</Th>
                    <Th onClick={() => handleSort('otHours')} active={sort.key === 'otHours'} dir={sort.dir} align="right">OT-hours</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-500)' }}>No employees match.</td></tr>
                  ) : filtered.map((r, i) => (
                    <tr key={r.empCode || i} style={{ background: i % 2 === 0 ? '#fff' : 'var(--ink-50)' }}>
                      <Td mono>{r.empCode}</Td>
                      <Td bold>{r.name || '—'}{r.nameMismatch && <span title="Name disagrees with master — possible ID collision" style={{ marginLeft: 6, color: '#9A6F0E' }}>⚠</span>}</Td>
                      <Td>{r.country}</Td>
                      <Td>{r.dept || '—'}</Td>
                      <Td>{r.position || (r.matched ? <span style={{ color: 'var(--ink-500)' }}>(blank)</span> : '—')}</Td>
                      <Td align="right">{r.present}</Td>
                      <Td align="right" bold>{r.otDays}</Td>
                      <Td align="right">{r.otHours.toFixed(1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </PageWrap>
  );
}

// ---- subcomponents -----------------------------------------------

function PageWrap({ children }) {
  return <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>{children}</div>;
}
function Header() {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.16em', color: 'var(--ink-500)' }}>HR · TIME &amp; ATTENDANCE</div>
      <h1 style={{ fontSize: 32, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.025em', margin: '4px 0 0 0' }}>Overtime</h1>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
function FileChip({ name, onRemove }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', background: 'var(--calo-50, #d9f0e5)', color: 'var(--calo-700, #1e8359)', borderRadius: 999, fontSize: 13, fontWeight: 700 }}>
      <Icon name="FileText" size={14} /> {name}
      <button onClick={onRemove} style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 900, fontSize: 15, lineHeight: 1 }}>×</button>
    </span>
  );
}
function ErrorBanner({ message, onClose }) {
  return (
    <div style={{ background: '#FDECEC', border: '1px solid #f5c6c6', color: '#9f2f2f', borderRadius: 'var(--r-md)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, fontWeight: 600 }}>
      <span>{message}</span>
      <button onClick={onClose} style={{ border: 'none', background: 'none', color: '#9f2f2f', cursor: 'pointer', fontWeight: 700 }}>×</button>
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

// ---- helpers ------------------------------------------------------

function buildFlagLines(data) {
  const f = data.flags || {}, s = data.scope || {}, out = [];
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

// ---- inline styles ------------------------------------------------

const panel = { background: '#fff', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)', padding: 24, boxShadow: 'var(--shadow-sm)' };
const select = { width: '100%', padding: '10px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--ink-200)', background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' };
const searchInput = { ...select, width: 240, fontWeight: 500 };
const fileInput = { fontSize: 13, color: 'var(--ink-700)' };
const primaryBtn = (disabled) => ({ background: disabled ? 'var(--ink-200)' : 'var(--calo-500)', color: disabled ? 'var(--ink-500)' : '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '11px 22px', fontSize: 14, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer', letterSpacing: '-0.01em' });
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: 'var(--ink-700)', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
