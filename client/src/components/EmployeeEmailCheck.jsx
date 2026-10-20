import { useState } from 'react';
import { api } from '../utils/api';
import { Icon, Btn } from './ui';

const panel = { background: '#fff', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)', padding: 16, boxShadow: 'var(--shadow-sm)' };

function interpret(res) {
  if (!res || res.reason === 'no_email') return null;
  if (res.found === false) {
    return { tone: 'red', title: 'Not found in Zelt',
      lines: [`No employee account uses ${res.email}. Treat this new joiner as unverified.`] };
  }
  const base = [
    res.name && `Name: ${res.name}`,
    res.employeeId && `Employee ID: ${res.employeeId}`,
    res.entity && `Entity: ${res.entity}`,
    `Status: ${res.status}`,
    res.leaveDate && `Leave date: ${res.leaveDate}`,
  ].filter(Boolean);
  if (res.active) return { tone: 'green', title: 'Active employee in Zelt', lines: base };
  if (res.live) return { tone: 'amber', title: `In Zelt — onboarding (${res.status})`, lines: [...base, 'A real joiner, not yet an Active account.'] };
  return { tone: 'red', title: `In Zelt but not active (${res.status})`, lines: [...base, 'This account is not a live employee.'] };
}

const TONES = {
  green: { bg: '#eafaf3', bd: '#02B376', fg: '#0f5132', icon: 'CheckCircle' },
  red: { bg: '#FDECEC', bd: '#c0392b', fg: '#9f2f2f', icon: 'XCircle' },
  amber: { bg: '#FEF6E7', bd: '#E0A400', fg: '#92700A', icon: 'AlertTriangle' },
};

export default function EmployeeEmailCheck() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  const check = async () => {
    const e = email.trim();
    if (!e) return;
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await api.zeltVerifyEmail(e)); }
    catch (ex) { setErr(ex.message || 'Lookup failed'); }
    finally { setBusy(false); }
  };

  const view = interpret(res);
  const t = view && TONES[view.tone];

  return (
    <div style={panel}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>
        Verify a new joiner's email in Zelt
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 10 }}>
        Confirms the address belongs to a live employee account in Zelt — a fabricated word@calo.app matches nothing.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
          placeholder="firstname.lastname@calo.app"
          style={{ flex: '1 1 280px', padding: '9px 12px', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 14 }}
        />
        <Btn icon="Search" onClick={check} disabled={busy || !email.trim()}>{busy ? 'Checking…' : 'Verify'}</Btn>
      </div>

      {err && (
        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#FDECEC', border: '1px solid #f5c6c6', color: '#9f2f2f', fontSize: 13 }}>{err}</div>
      )}

      {view && t && (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: t.bg, borderLeft: `3px solid ${t.bd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: t.fg, fontWeight: 800, fontSize: 14 }}>
            <Icon name={t.icon} size={16} /> {view.title}
          </div>
          {view.lines.map((l, i) => (
            <div key={i} style={{ marginTop: 4, fontSize: 12.5, color: t.fg, opacity: 0.9 }}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
