import { useState } from 'react';
import { api } from '../utils/api';
import { Icon, Btn, Card } from './ui';

const panel = { background: '#fff', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)', padding: 24, boxShadow: 'var(--shadow-sm)' };

function interpret(res) {
  if (!res) return null;
  if (res.configured === false) {
    return { tone: 'amber', title: 'Workspace verification is not set up yet',
      lines: ['Ask an admin to enable it: service account with domain-wide delegation for admin.directory.user.readonly, the Admin SDK API enabled, and WORKSPACE_ADMIN_EMAIL set to a Workspace admin.'] };
  }
  if (res.reason === 'not_calo') return { tone: 'neutral', title: 'Enter a @calo.app address', lines: [] };
  if (res.found === false) {
    return { tone: 'red', title: 'No Workspace account found', lines: [`${res.email} is not a real CALO account. Treat this new joiner as unverified.`] };
  }
  if (res.found && res.active) {
    return { tone: 'green', title: 'Active Workspace account', lines: [
      res.name && `Name: ${res.name}`,
      res.orgUnitPath && `Org unit: ${res.orgUnitPath}`,
      res.creationTime && `Created: ${new Date(res.creationTime).toLocaleDateString('en-GB')}`,
      res.lastLoginTime && res.lastLoginTime !== '1970-01-01T00:00:00.000Z' && `Last login: ${new Date(res.lastLoginTime).toLocaleDateString('en-GB')}`,
    ].filter(Boolean) };
  }
  if (res.found && !res.active) {
    return { tone: 'amber', title: res.suspended ? 'Account exists but is suspended' : 'Account exists but is archived',
      lines: [res.name && `Name: ${res.name}`, 'Not an active employee account right now.'].filter(Boolean) };
  }
  return null;
}

const TONES = {
  green: { bg: '#eafaf3', bd: '#02B376', fg: '#0f5132', icon: 'CheckCircle' },
  red: { bg: '#FDECEC', bd: '#c0392b', fg: '#9f2f2f', icon: 'XCircle' },
  amber: { bg: '#FEF6E7', bd: '#E0A400', fg: '#92700A', icon: 'AlertTriangle' },
  neutral: { bg: 'var(--ink-50)', bd: 'var(--ink-300)', fg: 'var(--ink-700)', icon: 'Info' },
};

export default function WorkspaceEmailCheck() {
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
    <div style={{ ...panel, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>
        Verify a new joiner's @calo.app email
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 10 }}>
        Confirms the address is a real, active account in the CALO Google Workspace — not just any made-up word@calo.app.
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
