import { useState, useMemo } from 'react';
import { Btn } from './ui';
import api from '../utils/api';
import toast from 'react-hot-toast';

// Full-employee Excel export — live, or any 2026 month (point-in-time). Test /
// payroll / ghost accounts are excluded server-side. Shared by the From-Zelt and
// Mobility tabs. `compact` drops the helper caption for tight headers.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function HeadcountButton({ compact = false }) {
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(''); // '' = current live; else '2026-MM'
  const months = useMemo(() => {
    const now = new Date();
    const max = now.getUTCFullYear() > 2026 ? 12 : now.getUTCMonth() + 1;
    return Array.from({ length: Math.min(12, max) }, (_, i) => ({ value: `2026-${String(i + 1).padStart(2, '0')}`, label: `${MONTHS[i]} 2026` }));
  }, []);

  const download = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await api.zeltHeadcount(month || undefined);
      if (data?.building) { toast.error('People index is still building — try again in a moment.'); return; }
      const rows = data?.rows || [];
      if (!rows.length) { toast.error('No employees returned.'); return; }
      const mod = await import('exceljs');
      const ExcelJS = mod.default ?? mod;
      const { buildHeadcountWorkbook } = await import('../utils/headcountWorkbook');
      const wb = buildHeadcountWorkbook(ExcelJS, data);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const period = month || new Date().toISOString().slice(0, 10);
      a.download = `CALO Headcount ${period}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Headcount exported — ${rows.length} employees${month ? ` as of ${month}` : ''}`);
    } catch (e) {
      toast.error(e.message || 'Headcount export failed');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      {!compact && <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>Full employee list (test &amp; payroll accounts excluded)</span>}
      <select value={month} onChange={(e) => setMonth(e.target.value)} disabled={loading}
        style={{ fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line, #d9e2dd)', background: '#fff', color: 'var(--ink-700, #1a2b23)' }}>
        <option value="">Current (live)</option>
        {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      <Btn variant="primary" size="sm" icon="Download" onClick={download} disabled={loading}>
        {loading ? 'Preparing…' : 'Headcount'}
      </Btn>
    </div>
  );
}
