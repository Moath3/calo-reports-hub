import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import { Icon, Btn, Card, Pill, PageHeader } from '../components/ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtWhen(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const EMPTY = { entity: '', hr_admin_name: '', hr_admin_email: '', slack_user_id: '' };

export default function EntityAdminsPage() {
  const [admins, setAdmins] = useState([]);
  const [entities, setEntities] = useState([]);
  const [watch, setWatch] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');       // which async action is running
  const [msg, setMsg] = useState(null);       // { tone, text }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ea, w] = await Promise.all([api.zeltEntityAdmins(), api.zeltWatch().catch(() => null)]);
      setAdmins(ea.admins || []);
      setEntities(ea.entities || []);
      setWatch(w);
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message || 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.entity) { setMsg({ tone: 'bad', text: 'Pick an entity first.' }); return; }
    setBusy('save');
    try {
      await api.zeltSaveEntityAdmin(form);
      setForm(EMPTY); setEditing(false);
      setMsg({ tone: 'ok', text: `Saved ${form.entity}.` });
      await load();
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message || 'Save failed' });
    } finally { setBusy(''); }
  };

  const edit = (row) => {
    setForm({ entity: row.entity, hr_admin_name: row.hr_admin_name || '', hr_admin_email: row.hr_admin_email || '', slack_user_id: row.slack_user_id || '' });
    setEditing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (entity) => {
    if (!window.confirm(`Remove the HR-admin mapping for ${entity}?`)) return;
    setBusy('del:' + entity);
    try {
      await api.zeltDeleteEntityAdmin(entity);
      setMsg({ tone: 'ok', text: `Removed ${entity}.` });
      await load();
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message || 'Delete failed' });
    } finally { setBusy(''); }
  };

  const runAction = async (key, fn, describe) => {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: r.sent || r.sent === 0 ? (r.skipped ? 'warn' : 'ok') : (r.skipped ? 'warn' : 'ok'), text: describe(r) });
      await load();
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message || 'Action failed' });
    } finally { setBusy(''); }
  };

  const sendEntityReports = () => runAction('entity', api.zeltWatchCompEntityReport.bind(api), (r) => {
    if (r.skipped) return `Not sent: ${r.skipped}`;
    const ok = (r.results || []).filter((x) => x.sent).length;
    const skipped = (r.results || []).filter((x) => !x.sent);
    const parts = [`DMed ${ok} admin${ok === 1 ? '' : 's'}.`];
    if (skipped.length) parts.push(`Skipped: ${skipped.map((x) => `${x.entity} (${x.skipped || x.error})`).join('; ')}`);
    return parts.join(' ');
  });

  const shortErr = (r) => {
    const e = r.skipped || r.error || 'unknown';
    if (/verify a domain|testing emails to your own/i.test(e)) {
      return 'Resend is on the sandbox sender — it only delivers to the Resend account-owner address. Verify a domain + set COMP_FROM_EMAIL to reach anyone else (see the setup guide).';
    }
    return String(e).slice(0, 200);
  };

  const sendTestEmail = () => {
    const to = window.prompt(
      'Send a sample reminder email to which address?\n\nUntil you verify a domain in Resend, only the Resend account-owner address is accepted.',
      ''
    );
    if (to === null) return; // cancelled
    return runAction('test', () => api.zeltCompEmailTest(to.trim() || undefined), (r) =>
      r.sent ? `Test email sent to ${r.to}. Check that inbox.` : `Not sent: ${shortErr(r)}`);
  };

  const sendTestDM = () => {
    const to = window.prompt(
      'Send a sample per-entity report as a Slack DM to whom?\n\nEnter a work email (looked up in Slack) or a Slack user ID (U...).',
      ''
    );
    if (to === null) return; // cancelled
    return runAction('dmtest', () => api.zeltCompDmTest(to.trim() || undefined), (r) =>
      r.sent ? `Test DM sent to ${r.to}. Check Slack.` : `Not sent: ${r.skipped || r.error || 'unknown'}`);
  };

  const sendReminderEmails = () => runAction('emails', api.zeltWatchCompEmails.bind(api), (r) =>
    r.skipped ? `Not sent: ${r.skipped}` : `Sent ${r.sent} reminder email${r.sent === 1 ? '' : 's'}${r.skippedNoEmail ? ` · ${r.skippedNoEmail} had no work email` : ''}${r.errors ? ` · ${r.errors} failed` : ''}.`);

  const mappedEntities = new Set(admins.map((a) => a.entity));
  const unmapped = entities.filter((e) => !mappedEntities.has(e));

  const botReady = watch?.slackBotConfigured;
  const emailsOn = watch?.compEmailRemindersEnabled;

  const toneColor = { ok: 'var(--calo-700)', bad: 'var(--danger)', warn: '#92700A' };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '8px 4px 60px' }}>
      <PageHeader
        eyebrow="People tools · admin"
        title="Entity HR admins"
        subtitle="Map each Zelt payroll entity to the People-Ops owner who should get its monthly compensatory-expiry report. The report is a private Slack DM listing that entity's people with comp days expiring within 30 days."
        actions={<Btn variant="secondary" icon="RefreshCw" onClick={load} disabled={loading}>Refresh</Btn>}
      />

      {msg && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: 'var(--ink-50)', border: '1px solid var(--ink-200)', color: toneColor[msg.tone] || 'var(--ink-700)', fontSize: 14, fontWeight: 600 }}>
          {msg.text}
        </div>
      )}

      {/* Readiness */}
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill tone={botReady ? 'green' : 'amber'} icon={botReady ? 'Check' : 'AlertTriangle'}>
            Slack bot token {botReady ? 'set' : 'missing'}
          </Pill>
          <Pill tone={emailsOn ? 'green' : 'neutral'} icon={emailsOn ? 'Check' : 'Minus'}>
            Email reminders {emailsOn ? 'on' : 'off'}
          </Pill>
          <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>
            Last entity DMs: <strong>{fmtWhen(watch?.lastCompEntityAt)}</strong> · last reminder emails: <strong>{fmtWhen(watch?.lastCompEmailAt)}</strong>
          </span>
        </div>
        {!botReady && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-500)', lineHeight: 1.5 }}>
            Per-admin DMs need a Slack bot token. In the HR Hub Slack app add the <code>chat:write</code> and <code>users:read.email</code> scopes, install it, and set <code>SLACK_BOT_TOKEN</code> on the server. Until then the monthly report will skip.
          </p>
        )}
      </Card>

      {/* Add / edit form */}
      <Card style={{ marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800, color: 'var(--ink-900)' }}>
          {editing ? `Edit ${form.entity}` : 'Add / update a mapping'}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <label className="label">Entity</label>
            <select
              className="input-field"
              value={form.entity}
              disabled={editing}
              onChange={(e) => set('entity')(e.target.value)}
            >
              <option value="">Select an entity…</option>
              {editing && <option value={form.entity}>{form.entity}</option>}
              {!editing && unmapped.map((e) => <option key={e} value={e}>{e}</option>)}
              {!editing && unmapped.length === 0 && <option value="" disabled>All entities mapped</option>}
            </select>
          </div>
          <div>
            <label className="label">HR admin name</label>
            <input className="input-field" value={form.hr_admin_name} onChange={(e) => set('hr_admin_name')(e.target.value)} placeholder="e.g. Sara Ahmed" />
          </div>
          <div>
            <label className="label">Work email</label>
            <input className="input-field" type="email" value={form.hr_admin_email} onChange={(e) => set('hr_admin_email')(e.target.value)} placeholder="sara@calo.app" />
          </div>
          <div>
            <label className="label">Slack user ID <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}>(optional)</span></label>
            <input className="input-field" value={form.slack_user_id} onChange={(e) => set('slack_user_id')(e.target.value)} placeholder="U0123ABC (overrides email lookup)" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Btn icon="Save" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : (editing ? 'Update' : 'Add mapping')}</Btn>
          {editing && <Btn variant="ghost" onClick={() => { setForm(EMPTY); setEditing(false); }}>Cancel</Btn>}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--ink-500)', lineHeight: 1.5 }}>
          The work email is used to resolve the admin's Slack account (<code>users.lookupByEmail</code>). If lookup ever fails, paste their Slack user ID to send directly.
        </p>
      </Card>

      {/* Current mappings */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--ink-900)' }}>
            Mappings <span style={{ color: 'var(--ink-400)', fontWeight: 600 }}>({admins.length} of {entities.length || '—'} entities)</span>
          </h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn variant="leaf" size="sm" icon="Send" onClick={sendEntityReports} disabled={busy === 'entity'}>
              {busy === 'entity' ? 'Sending…' : 'Send entity reports now'}
            </Btn>
            <Btn variant="secondary" size="sm" icon="MessageSquare" onClick={sendTestDM} disabled={busy === 'dmtest'}>
              {busy === 'dmtest' ? 'Sending…' : 'Slack me a test'}
            </Btn>
            <Btn variant="secondary" size="sm" icon="Mail" onClick={sendTestEmail} disabled={busy === 'test'}>
              {busy === 'test' ? 'Sending…' : 'Email me a test'}
            </Btn>
            <Btn variant="secondary" size="sm" icon="MailCheck" onClick={sendReminderEmails} disabled={busy === 'emails'}>
              {busy === 'emails' ? 'Sending…' : 'Send reminder emails now'}
            </Btn>
          </div>
        </div>

        {loading ? (
          <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>Loading…</p>
        ) : admins.length === 0 ? (
          <p style={{ color: 'var(--ink-500)', fontSize: 14 }}>No mappings yet. Add one above to start sending that entity's monthly report.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-500)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 10px' }}>Entity</th>
                  <th style={{ padding: '8px 10px' }}>HR admin</th>
                  <th style={{ padding: '8px 10px' }}>Work email</th>
                  <th style={{ padding: '8px 10px' }}>Slack ID</th>
                  <th style={{ padding: '8px 10px' }}></th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.entity} style={{ borderTop: '1px solid var(--ink-100)' }}>
                    <td style={{ padding: '10px', fontWeight: 700, color: 'var(--ink-900)' }}>{a.entity}</td>
                    <td style={{ padding: '10px', color: 'var(--ink-700)' }}>{a.hr_admin_name || <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                    <td style={{ padding: '10px', color: 'var(--ink-700)' }}>{a.hr_admin_email || <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                    <td style={{ padding: '10px', color: 'var(--ink-500)', fontFamily: 'monospace', fontSize: 12.5 }}>{a.slack_user_id || '—'}</td>
                    <td style={{ padding: '10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Btn variant="ghost" size="sm" icon="Pencil" onClick={() => edit(a)}>Edit</Btn>
                      <Btn variant="ghost" size="sm" icon="Trash2" onClick={() => remove(a.entity)} disabled={busy === 'del:' + a.entity} style={{ color: 'var(--danger)' }}>Remove</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
