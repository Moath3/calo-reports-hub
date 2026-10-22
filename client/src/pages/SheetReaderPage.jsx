import { useState, useMemo, useCallback } from 'react';
import { Icon, Btn, Card, PageHeader } from '../components/ui';
import { matchHeaders, COMPLIANCE_FIELDS } from '../utils/sheetFieldMatcher';

const EXPIRY_KEYS = new Set(['iqamaExpiry', 'visaExpiry', 'permitExpiry', 'passportExpiry', 'eidExpiry']);
const PREVIEW_ROWS = 15;

// Parse an Excel cell (Date object, serial number, or common string formats) to a Date.
function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000); // Excel serial
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/); // dd/mm/yyyy (day-first)
  if (m) { let [, d, mo, y] = m; y = y.length === 2 ? '20' + y : y; const dt = new Date(Date.UTC(+y, +mo - 1, +d)); return Number.isNaN(dt.getTime()) ? null : dt; }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function fmtDate(d) {
  if (!d) return '';
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

// Pick the header row: the one in the first 12 rows that resolves the most fields.
function detectHeaderRow(aoa, targets) {
  let best = { idx: 0, n: -1 };
  for (let i = 0; i < Math.min(12, aoa.length); i++) {
    const hs = (aoa[i] || []).map((c) => String(c ?? ''));
    const matched = Object.values(matchHeaders(hs, targets)).filter(Boolean).length;
    if (matched > best.n) best = { idx: i, n: matched };
  }
  return best.idx;
}

export default function SheetReaderPage() {
  const [fileName, setFileName] = useState('');
  const [wbSheets, setWbSheets] = useState([]);   // [{ name, aoa }]
  const [sheetName, setSheetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [overrides, setOverrides] = useState({}); // fieldKey -> colIndex (manual)
  const [alertDays, setAlertDays] = useState(30);
  const [custom, setCustom] = useState({ label: '', synonyms: '' });
  const [customFields, setCustomFields] = useState([]);

  const targets = useMemo(() => [...COMPLIANCE_FIELDS, ...customFields], [customFields]);

  const sheet = wbSheets.find((s) => s.name === sheetName);
  const { headers, rows } = useMemo(() => {
    if (!sheet) return { headers: [], rows: [] };
    const hr = detectHeaderRow(sheet.aoa, targets);
    return { headers: (sheet.aoa[hr] || []).map((c) => String(c ?? '')), rows: sheet.aoa.slice(hr + 1) };
  }, [sheet, targets]);

  const auto = useMemo(() => matchHeaders(headers, targets), [headers, targets]);
  const colFor = (key) => (overrides[key] != null ? overrides[key] : (auto[key]?.index ?? -1));

  const onUpload = useCallback(async (file) => {
    setError(null); setBusy(true); setOverrides({});
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheets = wb.SheetNames.map((name) => ({ name, aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: false }) }));
      setFileName(file.name);
      setWbSheets(sheets);
      setSheetName(sheets[0]?.name || '');
    } catch (e) {
      setError(e.message || 'Could not read the sheet');
    } finally { setBusy(false); }
  }, []);

  const addCustom = () => {
    const label = custom.label.trim();
    if (!label) return;
    const key = 'custom_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    setCustomFields((f) => [...f.filter((x) => x.key !== key), { key, label, synonyms: custom.synonyms.split(',').map((s) => s.trim()).filter(Boolean) }]);
    setCustom({ label: '', synonyms: '' });
  };

  // Expiry roll-up for every mapped expiry field.
  const expirySummary = useMemo(() => {
    const now = Date.now();
    return targets.filter((t) => EXPIRY_KEYS.has(t.key)).map((t) => {
      const ci = colFor(t.key);
      if (ci < 0) return null;
      let valid = 0, expiring = 0, expired = 0, blank = 0;
      for (const r of rows) {
        const d = toDate(r[ci]);
        if (!d) { blank++; continue; }
        const days = Math.round((d.getTime() - now) / 86400000);
        if (days < 0) expired++;
        else if (days <= alertDays) expiring++;
        else valid++;
      }
      const known = valid + expiring + expired;
      return { key: t.key, label: t.label, valid, expiring, expired, blank, known, pct: known ? Math.round((valid / known) * 100) : null };
    }).filter(Boolean);
  }, [targets, rows, overrides, auto, alertDays]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 4px 60px' }}>
      <PageHeader
        eyebrow="HR · tools"
        title="Sheet field reader"
        subtitle="Point it at a masterfile and it finds columns like “iqama expiry” wherever they are in the header, however they're spelled. Read in your browser — nothing is uploaded."
      />

      {error && <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: '#FDECEC', border: '1px solid #f5c6c6', color: '#9f2f2f', fontSize: 14, fontWeight: 600 }}>{error}</div>}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: busy ? 'wait' : 'pointer', background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, fontWeight: 700 }}>
            <Icon name="Upload" size={14} /> {busy ? 'Reading…' : (fileName ? 'Replace sheet' : 'Upload XLSX / CSV')}
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
          </label>
          {wbSheets.length > 1 && (
            <select value={sheetName} onChange={(e) => { setSheetName(e.target.value); setOverrides({}); }} className="input-field" style={{ width: 'auto', padding: '8px 12px' }}>
              {wbSheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
          {fileName && <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>{fileName} · {rows.length} rows · {headers.length} columns</span>}
        </div>
      </Card>

      {headers.length > 0 && (
        <>
          {/* Field mapping */}
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 800, color: 'var(--ink-900)' }}>Detected fields</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
              {targets.map((t) => {
                const ci = colFor(t.key);
                const score = overrides[t.key] != null ? null : auto[t.key]?.score;
                const tone = ci < 0 ? '#c0392b' : score == null ? '#1e8359' : score >= 0.85 ? '#1e8359' : '#9A6F0E';
                return (
                  <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--ink-100)', borderRadius: 8 }}>
                    <div style={{ flex: '0 0 140px', fontSize: 13, fontWeight: 700, color: 'var(--ink-800)' }}>{t.label}</div>
                    <select
                      value={ci}
                      onChange={(e) => setOverrides((o) => ({ ...o, [t.key]: Number(e.target.value) }))}
                      className="input-field"
                      style={{ flex: 1, padding: '6px 8px', fontSize: 13, borderColor: tone }}
                    >
                      <option value={-1}>— not found —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
                    </select>
                    {ci >= 0 && score != null && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: tone }} title="match confidence">{Math.round(score * 100)}%</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={custom.label} onChange={(e) => setCustom((c) => ({ ...c, label: e.target.value }))} placeholder="Add a field (e.g. Contract End)" style={{ flex: '1 1 200px', padding: '7px 10px', border: '1px solid var(--ink-200)', borderRadius: 6, fontSize: 13 }} />
              <input value={custom.synonyms} onChange={(e) => setCustom((c) => ({ ...c, synonyms: e.target.value }))} placeholder="spellings, comma-separated" style={{ flex: '1 1 200px', padding: '7px 10px', border: '1px solid var(--ink-200)', borderRadius: 6, fontSize: 13 }} />
              <Btn variant="secondary" size="sm" icon="Plus" onClick={addCustom} disabled={!custom.label.trim()}>Add field</Btn>
            </div>
          </Card>

          {/* Expiry roll-up */}
          {expirySummary.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--ink-900)' }}>Compliance snapshot</h3>
                <label style={{ fontSize: 13, color: 'var(--ink-600)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  Alert window
                  <input type="number" value={alertDays} min={1} onChange={(e) => setAlertDays(Math.max(1, Number(e.target.value) || 30))} style={{ width: 64, padding: '6px 8px', border: '1px solid var(--ink-200)', borderRadius: 6, fontSize: 13 }} /> days
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
                {expirySummary.map((e) => (
                  <div key={e.key} style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-900)' }}>{e.label}</div>
                    <div style={{ fontSize: 26, fontWeight: 900, color: e.pct === 100 ? '#1e8359' : e.pct >= 90 ? '#9A6F0E' : '#c0392b', letterSpacing: '-0.02em', marginTop: 2 }}>
                      {e.pct == null ? '—' : e.pct + '%'} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-500)' }}>valid</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-600)', marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ color: '#c0392b', fontWeight: 700 }}>{e.expired} expired</span>
                      <span style={{ color: '#9A6F0E', fontWeight: 700 }}>{e.expiring} ≤{alertDays}d</span>
                      {e.blank > 0 && <span style={{ color: 'var(--ink-400)' }}>{e.blank} blank</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Extracted preview */}
          <Card>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 800, color: 'var(--ink-900)' }}>Extracted values <span style={{ color: 'var(--ink-400)', fontWeight: 600 }}>(first {Math.min(PREVIEW_ROWS, rows.length)} of {rows.length})</span></h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--ink-500)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {targets.filter((t) => colFor(t.key) >= 0).map((t) => <th key={t.key} style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{t.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_ROWS).map((r, ri) => (
                    <tr key={ri} style={{ borderTop: '1px solid var(--ink-100)' }}>
                      {targets.filter((t) => colFor(t.key) >= 0).map((t) => {
                        const v = r[colFor(t.key)];
                        const d = EXPIRY_KEYS.has(t.key) ? toDate(v) : null;
                        return <td key={t.key} style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--ink-700)' }}>{d ? fmtDate(d) : (v == null ? '' : String(v))}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
