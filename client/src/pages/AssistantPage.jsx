// Read-only data assistant. Ask in plain language; the server turns it into a Zelt
// query plan and returns the real rows (salary admin-only). Push a result to a new
// report, an Excel file, or a Google Sheet. No writes to Zelt.
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Btn, Icon } from '../components/ui';

const SUGGESTIONS = [
  'How many staff in Luqmat by department?',
  'Headcount now',
  'Leave balances by business line',
  'Who left in the last 12 months?',
];

const filterChips = (filters = {}) =>
  Object.entries(filters).flatMap(([k, vals]) => (Array.isArray(vals) ? vals.map((v) => `${k}: ${v}`) : []));

function titleFor(r) {
  const d = r.interpreted?.dataset || 'data';
  const fs = filterChips(r.interpreted?.filters).join(', ');
  return `Zelt ${d}${fs ? ` — ${fs}` : ''}`.slice(0, 90);
}

function buildReportData(r) {
  const headers = r.columns.map((c) => c.label);
  const rows = r.rows.map((row) => r.columns.map((c) => String(row[c.key] ?? '')));
  const blocks = [];
  if (r.summary?.length) blocks.push({ type: 'metrics', label: 'Summary', items: r.summary.map((s) => ({ label: s.label, value: String(s.value), trend: 'stable' })) });
  blocks.push({ type: 'table', label: r.source || 'Data', headers, rows });
  return {
    generalInfo: {
      title: titleFor(r), reportDate: new Date().toISOString().slice(0, 10),
      companyName: 'CALO', brandColor: '#02B376',
      kpiStrip: (r.summary || []).slice(0, 4).map((s) => ({ label: s.label, value: String(s.value), trend: 'stable' })),
    },
    sections: [{ title: 'Data', icon: 'Table', blocks }],
  };
}

export default function AssistantPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]); // {role, content}
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, result]);

  async function ask(q) {
    const question = (q ?? input).trim();
    if (!question || loading) return;
    setErr(''); setInput('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: question }]);
    setLoading(true);
    try {
      const r = await api.assistantQuery(question, history);
      if (r.reply) {
        setMessages((m) => [...m, { role: 'assistant', content: r.reply }]);
        setResult(null);
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: r.interpreted?.note || `${r.total} row(s)` }]);
        setResult(r);
      }
    } catch (e) {
      const msg = e?.message || 'Something went wrong.';
      setMessages((m) => [...m, { role: 'assistant', content: msg }]);
      setErr(msg);
    } finally { setLoading(false); }
  }

  async function toReport() {
    if (!result) return;
    setBusy('report'); setErr('');
    try {
      const { id } = await api.createReport({ title: titleFor(result), reportData: buildReportData(result), reportType: 'assistant' });
      navigate(`/reports/${id}`);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  async function toExcel() {
    if (!result) return;
    setBusy('excel'); setErr('');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Data');
      ws.addRow(result.columns.map((c) => c.label));
      ws.getRow(1).font = { bold: true };
      for (const row of result.rows) ws.addRow(result.columns.map((c) => row[c.key] ?? ''));
      ws.columns.forEach((col) => { col.width = 18; });
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${titleFor(result).replace(/[^\w -]/g, '')}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  async function toSheet() {
    if (!result) return;
    const url = window.prompt('Paste the Google Sheet link to append these rows to.\nShare it with the service account (Editor) first.');
    if (!url) return;
    setBusy('sheet'); setErr('');
    try {
      const out = await api.assistantSheetAppend(url, result.columns, result.rows);
      window.alert(`Appended ${out.updatedRows} row(s)${out.updatedRange ? ` to ${out.updatedRange}` : ''}.`);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  const i = result?.interpreted;
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 16px' }}>
      <div style={{ padding: '20px 0 12px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="Sparkles" size={22} color="var(--calo-500)" /> Data Assistant
        </h1>
        <p style={{ color: 'var(--ink-500)', margin: '6px 0 0', fontSize: 14 }}>
          Ask for live Zelt people data in plain language. Read-only, every answer carries its source.
          {user?.role !== 'admin' && ' Salary figures are hidden for your role.'}
        </p>
      </div>

      {/* Ask box */}
      <div style={{ background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-lg, 16px)', padding: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
            placeholder="e.g. active headcount in KSA by department"
            style={{ flex: 1, padding: '11px 14px', borderRadius: 'var(--r-pill)', border: '1px solid var(--ink-200)', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
          />
          <Btn onClick={() => ask()} disabled={loading || !input.trim()} icon="Send">{loading ? 'Asking…' : 'Ask'}</Btn>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={loading}
              style={{ background: 'var(--calo-50)', color: 'var(--calo-800)', border: '1px solid var(--calo-100)', borderRadius: 'var(--r-pill)', padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, background: '#FDF3F3', border: '1px solid #F5D5D5', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{err}</div>
      )}

      {/* Result */}
      {result && (
        <div style={{ marginTop: 16, background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-lg, 16px)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ink-100)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ background: 'var(--ink-900)', color: '#fff', borderRadius: 'var(--r-pill)', padding: '3px 10px', fontWeight: 700 }}>{i?.dataset}</span>
              {filterChips(i?.filters).map((c) => (
                <span key={c} style={{ background: 'var(--ink-50)', color: 'var(--ink-700)', borderRadius: 'var(--r-pill)', padding: '3px 10px' }}>{c}</span>
              ))}
              {i?.groupBy && <span style={{ background: 'var(--calo-50)', color: 'var(--calo-800)', borderRadius: 'var(--r-pill)', padding: '3px 10px' }}>by {i.groupBy}</span>}
              {i?.view && i.view !== 'summary' && <span style={{ background: 'var(--calo-50)', color: 'var(--calo-800)', borderRadius: 'var(--r-pill)', padding: '3px 10px' }}>{i.view}</span>}
            </div>
            {i?.note && <p style={{ margin: '8px 0 0', color: 'var(--ink-500)', fontSize: 13 }}>Read as: {i.note}</p>}
          </div>

          {/* Summary chips */}
          {result.summary?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--ink-100)' }}>
              {result.summary.map((s) => (
                <div key={s.label} style={{ minWidth: 110 }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink-900)' }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          {result.notes?.length > 0 && (
            <div style={{ padding: '8px 16px', background: '#FFFBEB', borderBottom: '1px solid var(--ink-100)', fontSize: 12.5, color: '#92400E' }}>
              {result.notes.map((n, k) => <div key={k}>⚠ {n}</div>)}
            </div>
          )}

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr>{result.columns.map((c) => (
                  <th key={c.key} style={{ textAlign: 'left', padding: '9px 14px', borderBottom: '2px solid var(--ink-100)', color: 'var(--ink-500)', fontWeight: 700, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff' }}>{c.label}</th>
                ))}</tr>
              </thead>
              <tbody>
                {result.rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 ? '#fff' : 'var(--ink-25, #FAFAFA)' }}>
                    {result.columns.map((c) => (
                      <td key={c.key} style={{ padding: '8px 14px', borderBottom: '1px solid var(--ink-50)', whiteSpace: 'nowrap' }}>{String(row[c.key] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer: source + exports */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--ink-100)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>
              Source: {result.source}
              {result.capped && <span> · showing first {result.rows.length} of {result.total}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn size="sm" variant="secondary" icon="FileText" onClick={toReport} disabled={!!busy}>{busy === 'report' ? '…' : 'To report'}</Btn>
              <Btn size="sm" variant="secondary" icon="Download" onClick={toExcel} disabled={!!busy}>{busy === 'excel' ? '…' : 'Excel'}</Btn>
              <Btn size="sm" variant="secondary" icon="Sheet" onClick={toSheet} disabled={!!busy}>{busy === 'sheet' ? '…' : 'Google Sheet'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Transcript */}
      {messages.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {messages.map((m, k) => (
            <div key={k} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.role === 'user' ? 'var(--calo-500)' : '#fff', color: m.role === 'user' ? '#fff' : 'var(--ink-800)', border: m.role === 'user' ? 'none' : '1px solid var(--ink-200)', borderRadius: 14, padding: '8px 13px', fontSize: 13.5 }}>
              {m.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
