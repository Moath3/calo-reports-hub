import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { Icon, Btn, Card, Pill, KpiTile } from '../../components/ui';
import { mergeSettings, DEFAULTS, ROLES, compute, buildView, buildMasterFromRoster, PAYOPT, EXCL_REASONS } from './engine';
import { readPunchFile, readMasterFile, readScheduleFile } from './files';
import { COMPANIES, companyByKey, fmtMoney, DEFAULT_COMPANY } from './companies';
import { buildOtWorkbook } from './exportXlsx';
import { buildOtPdf } from './exportPdf';

const SUBTABS = [
  { k: 'upload', label: 'Upload & Rules', icon: 'Upload' },
  { k: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { k: 'daily', label: 'Daily Attendance', icon: 'CalendarDays' },
  { k: 'summary', label: 'Employee Summary', icon: 'Users' },
  { k: 'exceptions', label: 'Exceptions', icon: 'AlertTriangle' },
  { k: 'raw', label: 'Raw Transactions', icon: 'List' },
  { k: 'history', label: 'OT History', icon: 'History', always: true },
];

// ---- small format helpers ----
const hhmm = (min) => { if (min == null || Number.isNaN(min)) return '—'; const m = Math.round(min); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const fmtH = (min, S) => (min == null || Number.isNaN(min) ? '—' : S.fmt === 'dec' ? (min / 60).toFixed(2) : hhmm(min));
const tsTime = (ts) => { if (ts == null) return ''; const d = new Date(ts * 1000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };

const LS = {
  get(k, f) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota/private */ } },
};

// Per-company (per-country) rule defaults. UAE = the original calculator's
// values; KSA seeds the statutory 1.5x OT multiplier. All editable + saved per
// company, so each country's OT rules + multiplier can differ ("per-group pay").
function companyDefaults(key) {
  const base = mergeSettings({});
  if (String(key).startsWith('ksa')) base.otMult = 1.5; // KSA OT = 150% (confirm vs policy)
  return base;
}
const loadRules = (key) => mergeSettings(LS.get('otcalc.rules.' + key, null) || companyDefaults(key));

export default function OtCalculator() {
  const { user } = useAuth();
  const canSeeSalary = user?.role === 'admin' || user?.role === 'hr';

  const [company, setCompany] = useState(() => LS.get('otcalc.company', DEFAULT_COMPANY));
  const [settings, setSettings] = useState(() => loadRules(LS.get('otcalc.company', DEFAULT_COMPANY)));
  const [punch, setPunch] = useState(null);     // { fileName, rows, hdrIdx, rowOffset, headers, map }
  const [master, setMaster] = useState(null);   // built master directory
  const [masterName, setMasterName] = useState('');
  const [sched, setSched] = useState(null);     // schedule fill map
  const [schedName, setSchedName] = useState('');
  const [entityOpts, setEntityOpts] = useState([]);   // Zelt entities for the pull
  const [pickedEntities, setPickedEntities] = useState([]);
  const [committed, setCommitted] = useState(null); // { punch, master, settings }
  const [tab, setTab] = useState('upload');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [filters, setFilters] = useState({ q: '', dept: '', otOnly: false, status: '', from: '', to: '' });
  const [savedRun, setSavedRun] = useState(null);   // { id, status } of the run this calc is saved as
  const [runs, setRuns] = useState([]);             // saved-run list
  const [loadingRuns, setLoadingRuns] = useState(false);

  const comp = companyByKey(company);

  // eligibility / allowance overrides, persisted per company
  const [excl, setExcl] = useState(() => LS.get('otcalc.excl.' + company, {}));
  const [special, setSpecial] = useState(() => LS.get('otcalc.special.' + company, {}));
  useEffect(() => { setExcl(LS.get('otcalc.excl.' + company, {})); setSpecial(LS.get('otcalc.special.' + company, {})); }, [company]);
  useEffect(() => { LS.set('otcalc.company', company); setSettings(loadRules(company)); }, [company]);
  useEffect(() => { LS.set('otcalc.rules.' + company, settings); }, [settings, company]);
  useEffect(() => { LS.set('otcalc.excl.' + company, excl); }, [excl, company]);
  useEffect(() => { LS.set('otcalc.special.' + company, special); }, [special, company]);

  const setS = (k) => (v) => setSettings((s) => ({ ...s, [k]: v }));

  // D recomputes only from the committed snapshot (click Calculate to commit).
  const D = useMemo(() => {
    if (!committed?.punch) return null;
    try { return compute({ rows: committed.punch.rows, hdrIdx: committed.punch.hdrIdx, rowOffset: committed.punch.rowOffset, map: committed.punch.map, master: committed.master, sched: committed.sched, settings: committed.settings }); }
    catch (e) { console.error(e); return null; }
  }, [committed]);

  const view = useMemo(() => {
    if (!D) return { summary: [], kpis: {}, byDept: [] };
    return buildView(D, { settings: committed.settings, master: committed.master, excl, special, dec: comp.dec });
  }, [D, committed, excl, special, comp.dec]);

  const pickPunch = async (file) => {
    if (!file) return; setBusy(true); setMsg(null);
    try { const p = await readPunchFile(file); setPunch(p); if (p.map.id < 0 || p.map.date < 0 || p.map.time < 0) setMsg({ tone: 'warn', text: 'Some required columns were not auto-detected. Set them under "Column mapping" below.' }); }
    catch (e) { setMsg({ tone: 'bad', text: e.message || 'Could not read that file.' }); }
    finally { setBusy(false); }
  };
  const pickMaster = async (file) => {
    if (!file) return; setBusy(true); setMsg(null);
    try { const m = await readMasterFile(file, comp.tab, settings.dateOrder); if (!m) { setMsg({ tone: 'bad', text: 'No sheet with an Employee ID + Basic Salary column was found in that master.' }); return; } setMaster(m); setMasterName(file.name); }
    catch (e) { setMsg({ tone: 'bad', text: e.message || 'Could not read the master file.' }); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (!canSeeSalary) return; api.zeltEntities().then((r) => setEntityOpts(r.entities || [])).catch(() => {}); }, [canSeeSalary]);

  const pullFromZelt = async () => {
    if (!pickedEntities.length) { setMsg({ tone: 'warn', text: 'Pick at least one Zelt entity to pull salary + job family.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api.zeltOtRoster(pickedEntities.join(','));
      if (!r.employees?.length) { setMsg({ tone: 'warn', text: 'Zelt returned no employees for those entities.' }); return; }
      const m = buildMasterFromRoster(r.employees);
      setMaster(m); setMasterName(`Zelt · ${pickedEntities.length} ${pickedEntities.length === 1 ? 'entity' : 'entities'} · ${m.rows} staff${m.hasFamily ? ' · job family' : ''}`);
      setMsg({ tone: 'ok', text: `Pulled ${m.rows} employees from Zelt (salary${m.hasFamily ? ' + job family' : ''}). Re-run Calculate.` });
    } catch (e) {
      const txt = /index is still building/i.test(e.message || '') ? 'Zelt people index is warming up — try again in a moment.' : (e.message || 'Zelt pull failed');
      setMsg({ tone: 'bad', text: txt });
    } finally { setBusy(false); }
  };

  const pickSched = async (file) => {
    if (!file) return; setBusy(true); setMsg(null);
    try { const sc = await readScheduleFile(file); if (!sc) { setMsg({ tone: 'warn', text: 'No month tab (e.g. "September 2026") with ≥20 day columns was found in that schedule.' }); return; } setSched(sc); setSchedName(file.name); }
    catch (e) { setMsg({ tone: 'bad', text: e.message || 'Could not read the schedule file.' }); }
    finally { setBusy(false); }
  };

  const calculate = () => {
    if (!punch) { setMsg({ tone: 'bad', text: 'Choose a punch/transaction file first.' }); return; }
    if (punch.map.id < 0 || punch.map.date < 0 || punch.map.time < 0) { setMsg({ tone: 'bad', text: 'Employee ID, Date and Time columns must all be mapped.' }); return; }
    setCommitted({ punch, master, sched, settings });
    setSavedRun(null);
    setMsg(null); setTab('dashboard');
  };

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try { const r = await api.otRunsList(); setRuns(r.runs || []); }
    catch (e) { setMsg({ tone: 'bad', text: e.message || 'Could not load saved runs.' }); }
    finally { setLoadingRuns(false); }
  }, []);
  useEffect(() => { if (tab === 'history') loadRuns(); }, [tab, loadRuns]);

  // Build the save payload from the current view (amounts/totals only, no raw basic pay).
  const runPayload = () => ({
    company, company_name: comp.name, currency: comp.cur,
    label: `${comp.name} · ${D.period?.min || ''}${D.period?.max ? ' → ' + D.period.max : ''}`,
    period_from: D.period?.min || '', period_to: D.period?.max || '',
    totals: view.kpis, rules: committed.settings,
    data: view.summary.map((s) => ({ id: s.id, name: s.name, dept: s.dept, desig: s.desig, days: s.days, otDays: s.otDays, ot: s.ot, amount: s.amount, special: s.special, total: s.total, factor: s.factor })),
  });

  const saveRun = async (asNew = false) => {
    if (!D) return; setBusy(true); setMsg(null);
    try {
      const payload = runPayload();
      let saved;
      if (savedRun?.id && savedRun.status === 'draft' && !asNew) saved = await api.otRunUpdate(savedRun.id, payload);
      else saved = await api.otRunSave(payload);
      setSavedRun({ id: saved.id, status: saved.status });
      setMsg({ tone: 'ok', text: `Run saved as a draft (${saved.label}). See the OT History tab.` });
    } catch (e) { setMsg({ tone: 'bad', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  };

  const exportPdf = async () => {
    if (!D) return; setBusy(true);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = buildOtPdf(jsPDF, autoTable, { D, view, company: comp, showSalary: canSeeSalary, status: savedRun?.status });
      doc.save(`${comp.name.replace(/\s+/g, '_')}_OT_${D.period?.min || 'period'}.pdf`);
    } catch (e) { setMsg({ tone: 'bad', text: 'PDF export failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  };

  const exportExcel = async () => {
    if (!D) return; setBusy(true);
    try {
      const ExcelJS = (await import('exceljs')).default || (await import('exceljs'));
      const wb = buildOtWorkbook(ExcelJS, { D, view, settings: committed.settings, company: comp, master: committed.master, showSalary: canSeeSalary });
      const buf = await wb.xlsx.writeBuffer();
      const period = (D.period?.min || 'period');
      download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${comp.name.replace(/\s+/g, '_')}_OT_${period}.xlsx`);
    } catch (e) { setMsg({ tone: 'bad', text: 'Export failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  };

  return (
    <div>
      {/* company + sub-tabs */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-600)' }}>Company</label>
        <select className="input-field" style={{ width: 'auto' }} value={company} onChange={(e) => setCompany(e.target.value)}>
          {COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.name} ({c.cur})</option>)}
        </select>
        {D && <Pill tone="green" size="sm">{D.period?.min} → {D.period?.max}</Pill>}
        {savedRun && <Pill tone={savedRun.status === 'final' ? 'blue' : 'amber'} size="sm">{savedRun.status === 'final' ? 'finalized' : 'draft saved'}</Pill>}
        <div style={{ flex: 1 }} />
        {D && <Btn variant="secondary" size="sm" icon="Save" onClick={() => saveRun(false)} disabled={busy}>{savedRun?.status === 'draft' ? 'Update draft' : 'Save run'}</Btn>}
        {D && <Btn variant="secondary" size="sm" icon="Download" onClick={exportExcel} disabled={busy}>Export Excel</Btn>}
        {D && <Btn variant="secondary" size="sm" icon="FileText" onClick={exportPdf} disabled={busy}>Export PDF</Btn>}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18, borderBottom: '1px solid var(--ink-100)', paddingBottom: 10 }}>
        {SUBTABS.map((t) => {
          const active = tab === t.k; const disabled = !t.always && t.k !== 'upload' && !D;
          return (
            <button key={t.k} onClick={() => !disabled && setTab(t.k)} disabled={disabled}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 'var(--r-pill)', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, background: active ? 'var(--calo-500)' : 'transparent', color: active ? '#fff' : disabled ? 'var(--ink-300)' : 'var(--ink-700)' }}>
              <Icon name={t.icon} size={15} />{t.label}
            </button>
          );
        })}
      </div>

      {msg && <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: 'var(--ink-50)', border: '1px solid var(--ink-200)', color: msg.tone === 'bad' ? 'var(--danger)' : msg.tone === 'warn' ? '#92700A' : 'var(--calo-700)', fontSize: 14, fontWeight: 600 }}>{msg.text}</div>}

      {tab === 'upload' && <UploadRules {...{ company, comp, punch, setPunch, pickPunch, master, masterName, setMaster, pickMaster, sched, schedName, setSched, pickSched, settings, setS, setSettings, calculate, busy, canSeeSalary, entityOpts, pickedEntities, setPickedEntities, pullFromZelt }} />}
      {['daily', 'summary', 'exceptions', 'raw'].includes(tab) && D && (
        <FilterBar filters={filters} setFilters={setFilters} departments={[...new Set((view.summary || []).map((s) => s.dept).filter(Boolean))].sort()} showOt={tab === 'daily' || tab === 'summary'} showStatus={tab === 'daily'} showDates={tab === 'daily' || tab === 'raw'} />
      )}
      {tab === 'dashboard' && D && <Dashboard {...{ view, comp, canSeeSalary, settings: committed.settings }} />}
      {tab === 'daily' && D && <DailyTab {...{ D, view, comp, settings: committed.settings, canSeeSalary, filters }} />}
      {tab === 'summary' && D && <SummaryTab {...{ view, comp, settings: committed.settings, excl, setExcl, special, setSpecial, master: committed.master, canSeeSalary, filters }} />}
      {tab === 'exceptions' && D && <ExceptionsTab {...{ D, filters }} />}
      {tab === 'raw' && D && <RawTab {...{ D, filters }} />}
      {tab === 'history' && <HistoryTab {...{ runs, loadingRuns, loadRuns, savedRun, setMsg }} />}
    </div>
  );
}

// ---- Raw Transactions (the uploaded punches + how each was used) ----
function RawTab({ D, filters }) {
  const rows = useMemo(() => D.recs.filter((r) => matchFilters({ name: r.name, id: r.id, dept: r.dept, date: r.dateKey }, filters)), [D, filters]);
  return (
    <Card>
      <CountLine count={rows.length} label="punches" />
      <div style={{ overflowX: 'auto' }}>
        <table style={tbl}>
          <thead><tr style={thr}>{['Row', 'ID', 'Name', 'Dept', 'Date', 'Time', 'Punch type', 'How used'].map((h, i) => <th key={i} style={th('left')}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 1000).map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--ink-100)', background: r.bad ? '#FDECEC' : r.use?.startsWith('Duplicate') ? 'var(--ink-50)' : 'transparent' }}>
                <td style={td}>{r.rowNo}</td><td style={td}>{r.id}</td><td style={td}>{r.name}</td><td style={td}>{r.dept}</td>
                <td style={td}>{r.dateKey || '—'}</td>
                <td style={td}>{r.ts != null ? tsTime(r.ts) : '—'}</td>
                <td style={td}>{r.state === 'ANY' ? 'punch' : r.state}</td>
                <td style={{ ...td, color: r.bad ? 'var(--danger)' : 'var(--ink-500)', fontSize: 12 }}>{r.bad ? 'Excluded: ' + r.bad : (r.use || 'Used')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 1000 && <div style={{ padding: 10, color: 'var(--ink-500)', fontSize: 13 }}>Showing first 1000 of {rows.length}.</div>}
      </div>
    </Card>
  );
}

// ---- OT History (saved runs) ----
function HistoryTab({ runs, loadingRuns, loadRuns, savedRun, setMsg }) {
  const [open, setOpen] = useState(null);     // loaded full run
  const [busyId, setBusyId] = useState('');
  const act = async (id, fn, okText) => {
    setBusyId(id); setMsg(null);
    try { await fn(); setMsg({ tone: 'ok', text: okText }); await loadRuns(); if (open?.id === id) setOpen(null); }
    catch (e) { setMsg({ tone: 'bad', text: e.message || 'Action failed' }); }
    finally { setBusyId(''); }
  };
  const openRun = async (id) => { try { setOpen(await api.otRunGet(id)); } catch (e) { setMsg({ tone: 'bad', text: e.message }); } };
  const fmtWhen = (iso) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(); };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={h3}>Saved runs <span style={{ color: 'var(--ink-400)', fontWeight: 600 }}>({runs.length})</span></h3>
          <Btn variant="secondary" size="sm" icon="RefreshCw" onClick={loadRuns} disabled={loadingRuns}>Refresh</Btn>
        </div>
        {loadingRuns ? <Empty>Loading…</Empty> : runs.length === 0 ? <Empty>No saved runs yet. Run a month and hit "Save run" to keep it here.</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead><tr style={thr}>{['Label', 'Company', 'Period', 'OT hours', 'Payable', 'Status', 'Saved by', 'When', ''].map((h, i) => <th key={i} style={th('left')}>{h}</th>)}</tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--ink-100)', background: savedRun?.id === r.id ? 'var(--calo-50)' : 'transparent' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.label}</td>
                    <td style={td}>{r.company_name}</td>
                    <td style={td}>{r.period_from}{r.period_to ? ' → ' + r.period_to : ''}</td>
                    <td style={tdR}>{r.totals?.otH != null ? (r.totals.otH / 60).toFixed(1) : '—'}</td>
                    <td style={tdR}>{r.totals?.totalPayable != null ? fmtMoney(r.totals.totalPayable, 2) + ' ' + (r.currency || '') : '—'}</td>
                    <td style={td}><Pill tone={r.status === 'final' ? 'blue' : 'amber'} size="sm">{r.status}</Pill></td>
                    <td style={td}>{r.created_by_name}</td>
                    <td style={td}>{fmtWhen(r.created_at)}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Btn variant="ghost" size="sm" icon="Eye" onClick={() => openRun(r.id)}>Open</Btn>
                      {r.status === 'draft' && <Btn variant="ghost" size="sm" icon="Lock" onClick={() => act(r.id, () => api.otRunFinalize(r.id), 'Run finalized (locked).')} disabled={busyId === r.id}>Finalize</Btn>}
                      {r.status === 'draft' && <Btn variant="ghost" size="sm" icon="Trash2" onClick={() => { if (window.confirm('Delete this draft run?')) act(r.id, () => api.otRunDelete(r.id), 'Draft deleted.'); }} disabled={busyId === r.id} style={{ color: 'var(--danger)' }}>Delete</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={h3}>{open.label} <Pill tone={open.status === 'final' ? 'blue' : 'amber'} size="sm">{open.status}</Pill></h3>
            <Btn variant="ghost" size="sm" icon="X" onClick={() => setOpen(null)}>Close</Btn>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Pill tone="neutral" size="sm">{open.totals?.emps ?? '—'} employees</Pill>
            <Pill tone="green" size="sm">{open.totals?.otH != null ? (open.totals.otH / 60).toFixed(1) : '—'} OT hours</Pill>
            {open.totals?.totalPayable != null && <Pill tone="blue" size="sm">{fmtMoney(open.totals.totalPayable, 2)} {open.currency} payable</Pill>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead><tr style={thr}>{['ID', 'Name', 'Dept', 'Days', 'OT days', 'OT min', 'Allowance %', 'OT amount', 'Special', 'Payable'].map((h, i) => <th key={i} style={th('left')}>{h}</th>)}</tr></thead>
              <tbody>
                {(open.data || []).slice(0, 800).map((s, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--ink-100)' }}>
                    <td style={td}>{s.id}</td><td style={td}>{s.name}</td><td style={td}>{s.dept}</td>
                    <td style={tdR}>{s.days}</td><td style={tdR}>{s.otDays}</td><td style={tdR}>{s.ot}</td>
                    <td style={tdR}>{Math.round((s.factor || 0) * 100)}%</td>
                    <td style={tdR}>{s.amount != null ? fmtMoney(s.amount, 2) : '—'}</td>
                    <td style={tdR}>{s.special || ''}</td>
                    <td style={{ ...tdR, fontWeight: 700 }}>{s.total != null ? fmtMoney(s.total, 2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---- Upload & Rules ----
function UploadRules({ company, comp, punch, setPunch, pickPunch, master, masterName, setMaster, pickMaster, sched, schedName, setSched, pickSched, settings, setS, setSettings, calculate, busy, canSeeSalary, entityOpts, pickedEntities, setPickedEntities, pullFromZelt }) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Card>
        <h3 style={h3}>1. Files</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
          <div>
            <FileBtn accept=".csv,.xlsx,.xls,.xlsm" label="Choose punch / transaction file" onPick={pickPunch} />
            {punch && <Chip name={`${punch.fileName} · ${punch.sheetName}`} onRemove={() => setPunch(null)} />}
          </div>
          {canSeeSalary && (
            <div>
              <FileBtn accept=".csv,.xlsx,.xls,.xlsm,.txt" label="Add salary master (optional)" onPick={pickMaster} />
              {master && <Chip name={`${masterName} · ${master.rows} rows`} onRemove={() => { setMaster(null); }} />}
              <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 6 }}>Salary stays in your browser. Needed for OT amounts + eligibility.</div>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--ink-200)' }}>
                <label className="label">…or pull salary + Job Family from Zelt</label>
                <select multiple className="input-field" style={{ height: 96, fontSize: 13 }} value={pickedEntities}
                  onChange={(e) => setPickedEntities([...e.target.selectedOptions].map((o) => o.value))}>
                  {entityOpts.map((en) => <option key={en} value={en}>{en}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <Btn variant="secondary" size="sm" icon="Cloud" onClick={pullFromZelt} disabled={busy || !pickedEntities.length}>Pull from Zelt</Btn>
                  <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>{pickedEntities.length ? `${pickedEntities.length} selected` : 'pick entities (Ctrl/Cmd-click for several)'}</span>
                </div>
              </div>
            </div>
          )}
          <div>
            <FileBtn accept=".csv,.xlsx,.xls,.xlsm,.txt" label="Add schedule (optional)" onPick={pickSched} />
            {sched && <Chip name={`${schedName} · ${sched.emps} staff, ${sched.cells} days`} onRemove={() => setSched(null)} />}
            <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 6 }}>Month tabs (e.g. "September 2026"). Fills one missing punch when a recorded punch matches the scheduled start/end.</div>
          </div>
        </div>
      </Card>

      {punch && (
        <Card>
          <h3 style={h3}>Column mapping <span style={{ fontWeight: 500, color: 'var(--ink-400)', fontSize: 13 }}>(auto-detected — override if wrong)</span></h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            {ROLES.map((r) => (
              <div key={r.k}>
                <label className="label">{r.l}{r.req ? ' *' : ''}</label>
                <select className="input-field" value={punch.map[r.k]} onChange={(e) => setPunch({ ...punch, map: { ...punch.map, [r.k]: +e.target.value } })}>
                  <option value={-1}>— none —</option>
                  {punch.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h3 style={h3}>2. Rules <span style={{ fontWeight: 500, color: 'var(--ink-400)', fontSize: 13 }}>— saved per company ({comp?.name})</span></h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
          <NumF label="Standard hours / day" v={settings.std} on={setS('std')} />
          <NumF label="Break (minutes)" v={settings.breakMin} on={setS('breakMin')} />
          <NumF label="Break applies when span ≥ (h)" v={settings.breakFrom} on={setS('breakFrom')} />
          <NumF label="Daily OT buffer (min, unpaid)" v={settings.buffer} on={setS('buffer')} />
          <SelF label="OT rounding" v={settings.otRound} on={setS('otRound')} opts={[['none', 'Exact'], ['d15', 'Down to 15 min'], ['d30', 'Down to 30 min'], ['n15', 'Nearest 15 min']]} />
          <NumF label="Minimum OT to count (min)" v={settings.minOT} on={setS('minOT')} />
          <NumF label="Rest gap → new shift (h)" v={settings.gap} on={setS('gap')} />
          <NumF label="Max shift / pairing window (h)" v={settings.win} on={setS('win')} />
          <NumF label="Long-shift flag over (h)" v={settings.maxShift} on={setS('maxShift')} />
          <NumF label="Very-short-span flag under (min)" v={settings.minSpan} on={setS('minSpan')} />
          <NumF label="Duplicate punch window (min)" v={settings.dupWin} on={setS('dupWin')} />
          <NumF label="Schedule match window (h)" v={settings.schedTol} on={setS('schedTol')} />
          <SelF label="Ambiguous date order" v={settings.dateOrder} on={setS('dateOrder')} opts={[['DMY', 'Day / Month / Year'], ['MDY', 'Month / Day / Year']]} />
          <SelF label="Broken shifts" v={settings.lenient} on={setS('lenient')} opts={[['strict', 'Strict (flag, no hours)'], ['lenient', 'Lenient (use first+last)']]} />
          <SelF label="Hours display" v={settings.fmt} on={setS('fmt')} opts={[['hhmm', 'HH:MM'], ['dec', 'Decimal']]} />
          {canSeeSalary && <SelF label="Hourly rate basis" v={settings.rateBasis} on={setS('rateBasis')} opts={[['30', 'Basic ÷ 30 ÷ hpd'], ['365', 'Basic × 12 ÷ 365 ÷ hpd']]} />}
          {canSeeSalary && <NumF label="Rate hours / day (hpd)" v={settings.rateHours} on={setS('rateHours')} />}
          {canSeeSalary && <NumF label="OT multiplier" v={settings.otMult} on={setS('otMult')} step="0.05" />}
          {canSeeSalary && <SelF label="OT pay scope" v={settings.prodOnly ? 'prod' : 'all'} on={(v) => setS('prodOnly')(v === 'prod')} opts={[['prod', 'Production job families only'], ['all', 'All employees in the sheet']]} />}
          {canSeeSalary && settings.prodOnly && <TxtF label="Production family keyword" v={settings.prodFamily} on={setS('prodFamily')} />}
        </div>
        {canSeeSalary && settings.prodOnly && <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 10, lineHeight: 1.5 }}>Only paid when the salary master has a <b>Job Family</b> column. Employees whose family doesn't contain "{settings.prodFamily}" get hours but no OT pay. No Job Family column → the whole sheet is treated as eligible.</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
          <Btn icon="Calculator" onClick={calculate} disabled={!punch || busy}>{busy ? 'Reading…' : 'Calculate'}</Btn>
          <Btn variant="ghost" size="sm" onClick={() => setSettings(companyDefaults(company))}>Reset {comp?.name} rules</Btn>
        </div>
      </Card>
    </div>
  );
}

// ---- Dashboard ----
function Dashboard({ view, comp, canSeeSalary, settings }) {
  const k = view.kpis; const sal = canSeeSalary && k.totalPayable != null;
  const topOt = view.summary.filter((s) => s.ot > 0).slice(0, 10);
  const maxOt = Math.max(1, ...topOt.map((s) => s.ot));
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <KpiTile label="Employees" value={k.emps} />
        <KpiTile label="Attendance days" value={k.attendanceDays} />
        <KpiTile label="Total hours" value={fmtH(k.totHours, settings)} />
        <KpiTile label="Normal hours" value={fmtH(k.normalH, settings)} />
        <KpiTile label="OT hours" value={fmtH(k.otH, settings)} accent />
        <KpiTile label="Payable OT hours" value={fmtH(k.payOtH, settings)} />
        <KpiTile label="Employees with OT" value={k.otEmps} />
        {sal && <KpiTile label={`Total OT payable (${comp.cur})`} value={fmtMoney(k.totalPayable, comp.dec)} accent />}
        <KpiTile label="Missing IN" value={k.missIn} />
        <KpiTile label="Missing OUT" value={k.missOut} />
        <KpiTile label="Exceptions" value={k.exceptions} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 18 }}>
        <Card>
          <h3 style={h3}>Highest OT employees</h3>
          {topOt.length === 0 ? <Empty>No overtime in this period.</Empty> : topOt.map((s) => (
            <div key={s.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}><span style={{ fontWeight: 600 }}>{s.name}</span><span style={{ color: 'var(--ink-500)' }}>{fmtH(s.ot, settings)}</span></div>
              <div style={{ height: 8, background: 'var(--ink-100)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: (s.ot / maxOt * 100) + '%', height: '100%', background: 'var(--calo-500)' }} /></div>
            </div>
          ))}
        </Card>
        <Card>
          <h3 style={h3}>OT by department</h3>
          <Table cols={[['Department', 'l'], ['OT hours', 'r'], ['Employees', 'r'], ...(sal ? [[`OT ${comp.cur}`, 'r']] : [])]}
            rows={view.byDept.map((d) => [d.dept, fmtH(d.ot, settings), d.otEmps + '/' + d.emps, ...(sal ? [fmtMoney(d.amount, comp.dec)] : [])])} />
        </Card>
      </div>
    </div>
  );
}

// ---- Daily Attendance ----
function DailyTab({ D, view, comp, settings, canSeeSalary, filters }) {
  const sal = canSeeSalary && !!view.summary.some((s) => s.rate != null);
  const rateById = useMemo(() => { const m = {}; view.summary.forEach((s) => { m[s.id] = s; }); return m; }, [view]);
  const rows = useMemo(() => D.daily.filter((d) => matchFilters({ name: d.name, id: d.id, dept: d.dept, ot: d.ot, status: d.status, date: d.date }, filters)), [D, filters]);
  return (
    <Card>
      <CountLine count={rows.length} label="shifts" />
      <div style={{ overflowX: 'auto' }}>
        <table style={tbl}>
          <thead><tr style={thr}>{['ID', 'Name', 'Dept', 'Date', 'IN', 'OUT', 'Total', 'Break', 'Buffer', 'Normal', 'OT', ...(sal ? ['OT amt'] : []), 'Status', 'Notes'].map((h, i) => <th key={i} style={th(i > 5 && i < (sal ? 12 : 11) ? 'right' : 'left')}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 500).map((d, i) => {
              const s = rateById[d.id]; const amt = sal && s && s.rate != null && d.ot > 0 ? Math.round(d.ot / 60 * s.otRate * (s.factor || 1) * Math.pow(10, comp.dec)) / Math.pow(10, comp.dec) : null;
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--ink-100)' }}>
                  <td style={td}>{d.id}</td><td style={td}>{d.name}</td><td style={td}>{d.dept}</td><td style={td}>{d.date}</td>
                  <td style={tdC}>{d.inTs != null ? tsTime(d.inTs) : '—'}</td>
                  <td style={tdC}>{d.outTs != null ? tsTime(d.outTs) : '—'}{d.overnight ? <span style={{ color: 'var(--calo-600)', fontSize: 10, marginLeft: 3 }}>+1</span> : ''}</td>
                  <td style={tdR}>{d.span != null ? fmtH(d.span, settings) : '—'}</td>
                  <td style={tdR}>{d.brk != null ? hhmm(d.brk) : '—'}</td>
                  <td style={tdR}>{d.buf != null ? hhmm(d.buf) : '—'}</td>
                  <td style={tdR}>{d.normal != null ? fmtH(d.normal, settings) : '—'}</td>
                  <td style={{ ...tdR, fontWeight: d.ot > 0 ? 700 : 400, color: d.ot > 0 ? 'var(--calo-700)' : 'inherit' }}>{d.ot != null ? fmtH(d.ot, settings) : '—'}</td>
                  {sal && <td style={tdR}>{amt != null ? fmtMoney(amt, comp.dec) : '—'}</td>}
                  <td style={td}><StatusPill status={d.status} /></td>
                  <td style={{ ...td, color: 'var(--ink-500)', maxWidth: 280, fontSize: 12 }}>{(d.flags || []).map((f) => f.type).join(', ') || (d.issueDetail ? d.issueDetail.split(' · ')[0] : '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 500 && <div style={{ padding: 10, color: 'var(--ink-500)', fontSize: 13 }}>Showing first 500 of {rows.length}. Export for the full list.</div>}
      </div>
    </Card>
  );
}

// ---- Employee Summary (with eligibility controls) ----
function SummaryTab({ view, comp, settings, excl, setExcl, special, setSpecial, master, canSeeSalary, filters }) {
  const sal = canSeeSalary && !!master;
  const rows = useMemo(() => view.summary.filter((s) => matchFilters(s, filters)), [view, filters]);
  const setPay = (id, pay) => setExcl((x) => { const n = { ...x }; const cur = typeof n[id] === 'string' ? { pay: 'none', reason: n[id] } : { ...(n[id] || {}) }; cur.pay = pay; if (pay === 'full') { delete cur.pay; delete cur.reason; } if (!cur.pay && !cur.reason && !cur.noElig) delete n[id]; else n[id] = cur; return n; });
  const setReason = (id, reason) => setExcl((x) => { const n = { ...x }; const cur = typeof n[id] === 'string' ? { pay: 'none', reason: n[id] } : { ...(n[id] || {}) }; cur.reason = reason; n[id] = cur; return n; });
  const toggleElig = (id, on) => setExcl((x) => { const n = { ...x }; const cur = typeof n[id] === 'string' ? { pay: 'none', reason: n[id] } : { ...(n[id] || {}) }; cur.noElig = !on; if (!cur.noElig) delete cur.noElig; if (!cur.pay && !cur.reason && !cur.noElig) delete n[id]; else n[id] = cur; return n; });
  const setSp = (id, v) => setSpecial((s) => { const n = { ...s }; const num = +v; if (!num) delete n[id]; else n[id] = num; return n; });

  return (
    <Card>
      <CountLine count={rows.length} label="employees" />
      <div style={{ overflowX: 'auto' }}>
        <table style={tbl}>
          <thead><tr style={thr}>{['ID', 'Name', 'Dept', 'Days', 'OT days', 'Total', 'Normal', 'OT', 'Miss IN', 'Miss OUT', 'Exc', ...(sal ? ['Basic', 'OT rate', 'Eligible', 'Allowance', 'Special', 'Payable'] : [])].map((h, i) => <th key={i} style={th('left')}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 600).map((s) => {
              const ex = typeof excl[s.id] === 'string' ? { pay: 'none', reason: excl[s.id] } : (excl[s.id] || {});
              const pay = ex.pay || 'full'; const noBasic = sal && !(s.basic > 0); const prodEx = s.prodExcluded;
              return (
                <tr key={s.id} style={{ borderTop: '1px solid var(--ink-100)' }}>
                  <td style={td}>{s.id}</td><td style={td}>{s.name}</td><td style={td}>{s.dept}</td>
                  <td style={tdR}>{s.days}</td><td style={tdR}>{s.otDays}</td>
                  <td style={tdR}>{fmtH(s.span, settings)}</td><td style={tdR}>{fmtH(s.normal, settings)}</td>
                  <td style={{ ...tdR, fontWeight: s.ot > 0 ? 700 : 400, color: s.ot > 0 ? 'var(--calo-700)' : 'inherit' }}>{fmtH(s.ot, settings)}</td>
                  <td style={tdR}>{s.missIn || ''}</td><td style={tdR}>{s.missOut || ''}</td><td style={tdR}>{s.exc || ''}</td>
                  {sal && <td style={tdR}>{noBasic ? <Pill tone="amber" size="sm">No basic</Pill> : fmtMoney(s.basic, comp.dec)}</td>}
                  {sal && <td style={tdR}>{s.otRate != null ? fmtMoney(s.otRate, comp.dec) : '—'}</td>}
                  {sal && <td style={td}>{prodEx ? <Pill tone="neutral" size="sm">Non-prod</Pill> : <input type="checkbox" checked={!ex.noElig && !noBasic} disabled={noBasic} onChange={(e) => toggleElig(s.id, e.target.checked)} />}</td>}
                  {sal && <td style={td}>
                    <select className="input-field" style={{ padding: '4px 6px', fontSize: 12, width: 'auto' }} value={pay} disabled={noBasic || ex.noElig || prodEx} onChange={(e) => setPay(s.id, e.target.value)}>
                      {PAYOPT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {pay !== 'full' && !ex.noElig && !noBasic && (
                      <select className="input-field" style={{ padding: '4px 6px', fontSize: 12, width: 'auto', marginTop: 4 }} value={ex.reason || ''} onChange={(e) => setReason(s.id, e.target.value)}>
                        <option value="">Reason…</option>{EXCL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </td>}
                  {sal && <td style={td}><input className="input-field" style={{ padding: '4px 6px', fontSize: 12, width: 80 }} type="number" value={special[s.id] || ''} onChange={(e) => setSp(s.id, e.target.value)} placeholder="0" /></td>}
                  {sal && <td style={{ ...tdR, fontWeight: 700 }}>{s.total != null ? fmtMoney(s.total, comp.dec) : '—'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Exceptions ----
function ExceptionsTab({ D, filters }) {
  const [sev, setSev] = useState('all');
  const rows = useMemo(() => D.exc.filter((x) => (sev === 'all' || x.sev === sev) && matchFilters({ name: x.name, id: x.id, dept: x.dept }, filters)).sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'action' ? -1 : 1)), [D, sev, filters]);
  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select className="input-field" style={{ width: 'auto' }} value={sev} onChange={(e) => setSev(e.target.value)}>
          <option value="all">All priorities</option><option value="action">Action needed</option><option value="info">Info</option>
        </select>
        <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>{rows.length} exceptions</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tbl}>
          <thead><tr style={thr}>{['Priority', 'Exception', 'ID', 'Name', 'Dept', 'Date', 'Details'].map((h, i) => <th key={i} style={th('left')}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 800).map((x, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--ink-100)' }}>
                <td style={td}><Pill tone={x.sev === 'action' ? 'red' : 'neutral'} size="sm">{x.sev === 'action' ? 'Action' : 'Info'}</Pill></td>
                <td style={{ ...td, fontWeight: 600 }}>{x.type}</td><td style={td}>{x.id}</td><td style={td}>{x.name}</td><td style={td}>{x.dept}</td><td style={td}>{x.date || '—'}</td>
                <td style={{ ...td, color: 'var(--ink-500)', fontSize: 12, maxWidth: 420 }}>{x.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- shared bits ----
const h3 = { margin: '0 0 14px', fontSize: 16, fontWeight: 800, color: 'var(--ink-900)' };
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thr = { textAlign: 'left', color: 'var(--ink-500)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' };
const th = (align) => ({ padding: '8px 10px', textAlign: align === 'right' ? 'right' : 'left', whiteSpace: 'nowrap' });
const td = { padding: '8px 10px', color: 'var(--ink-800)' };
const tdC = { ...td, textAlign: 'center' };
const tdR = { ...td, textAlign: 'right' };

function NumF({ label, v, on, step }) { return (<div><label className="label">{label}</label><input className="input-field" type="number" step={step || '1'} value={v} onChange={(e) => on(e.target.value === '' ? '' : +e.target.value)} /></div>); }
function TxtF({ label, v, on }) { return (<div><label className="label">{label}</label><input className="input-field" type="text" value={v} onChange={(e) => on(e.target.value)} /></div>); }
function SelF({ label, v, on, opts }) { return (<div><label className="label">{label}</label><select className="input-field" value={v} onChange={(e) => on(e.target.value)}>{opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></div>); }
function CountLine({ count, label }) { return <div style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 10 }}>{count} {label}</div>; }
// Shared employee filter (search + department + OT-only).
export function matchFilters(r, filters) {
  const t = (filters?.q || '').trim().toLowerCase();
  if (t && !(`${r.name || ''} ${r.id || ''} ${r.dept || ''}`).toLowerCase().includes(t)) return false;
  if (filters?.dept && r.dept !== filters.dept) return false;
  if (filters?.otOnly && !((r.ot > 0) || (r.otDays > 0))) return false;
  if (filters?.status && r.status && r.status !== filters.status) return false; // shift status (daily only)
  if (filters?.from && r.date && r.date < filters.from) return false;           // date range (rows with a date)
  if (filters?.to && r.date && r.date > filters.to) return false;
  return true;
}
function FilterBar({ filters, setFilters, departments, showOt, showStatus, showDates }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const active = filters.q || filters.dept || filters.otOnly || filters.status || filters.from || filters.to;
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
      <input className="input-field" style={{ maxWidth: 220 }} placeholder="Search name / ID / dept…" value={filters.q} onChange={(e) => set('q', e.target.value)} />
      <select className="input-field" style={{ width: 'auto' }} value={filters.dept} onChange={(e) => set('dept', e.target.value)}>
        <option value="">All departments</option>
        {departments.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      {showStatus && (
        <select className="input-field" style={{ width: 'auto' }} value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          {['OT', 'Normal', 'Below Standard', 'Missing IN', 'Missing OUT', 'Invalid'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {showDates && <input className="input-field" type="date" style={{ width: 'auto' }} value={filters.from} onChange={(e) => set('from', e.target.value)} title="From date" />}
      {showDates && <input className="input-field" type="date" style={{ width: 'auto' }} value={filters.to} onChange={(e) => set('to', e.target.value)} title="To date" />}
      {showOt && <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-700)' }}><input type="checkbox" checked={filters.otOnly} onChange={(e) => set('otOnly', e.target.checked)} /> OT only</label>}
      {active && <Btn variant="ghost" size="sm" icon="X" onClick={() => setFilters({ q: '', dept: '', otOnly: false, status: '', from: '', to: '' })}>Clear</Btn>}
    </div>
  );
}
function Empty({ children }) { return <div style={{ color: 'var(--ink-400)', fontSize: 14, padding: '8px 0' }}>{children}</div>; }
function Table({ cols, rows }) {
  return (<table style={tbl}><thead><tr style={thr}>{cols.map((c, i) => <th key={i} style={th(c[1] === 'r' ? 'right' : 'left')}>{c[0]}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: '1px solid var(--ink-100)' }}>{r.map((v, j) => <td key={j} style={cols[j][1] === 'r' ? tdR : td}>{v}</td>)}</tr>)}</tbody></table>);
}
function StatusPill({ status }) {
  const tone = status === 'OT' ? 'green' : status === 'Normal' ? 'blue' : /Missing|Invalid/.test(status) ? 'red' : 'neutral';
  return <Pill tone={tone} size="sm">{status}</Pill>;
}
function FileBtn({ accept, label, onPick }) {
  const ref = useRef();
  return (<><input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
    <Btn variant="leaf" icon="Upload" onClick={() => ref.current?.click()}>{label}</Btn></>);
}
function Chip({ name, onRemove }) {
  return (<div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '6px 12px', background: 'var(--calo-50)', border: '1px solid var(--calo-100)', borderRadius: 'var(--r-pill)', fontSize: 13, maxWidth: '100%' }}>
    <Icon name="FileSpreadsheet" size={14} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    <button onClick={onRemove} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-500)', display: 'flex' }}><Icon name="X" size={14} /></button></div>);
}
function download(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
