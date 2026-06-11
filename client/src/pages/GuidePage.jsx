import { useNavigate } from 'react-router-dom';
import { Card, Pill, Btn, Icon, Eyebrow, PageHeader, Leaf } from '../components/ui';
import CaloLogo from '../components/CaloLogo';

// ─── Illustrated mockups ─────────────────────────────────────────────────────
// These mimic the actual UI so users can recognize screens at a glance.

function MockDashboardHero() {
  return (
    <div style={{
      borderRadius: 18, overflow: 'hidden', position: 'relative',
      background: 'linear-gradient(135deg, #01432D 0%, #016040 45%, #02B376 100%)',
      color: '#fff', padding: '22px 24px',
    }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: .08 }} viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="gleaf" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <circle cx="30" cy="30" r="1.2" fill="#fff" />
            <path d="M10 50 Q 30 35 50 50" stroke="#fff" strokeWidth="1" fill="none" opacity=".4" />
          </pattern>
        </defs>
        <rect width="400" height="160" fill="url(#gleaf)" />
      </svg>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.18em', opacity: .8 }}>START HERE</div>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', marginTop: 4, lineHeight: 1.15 }}>
            Create a report in <span style={{ color: '#CFF3E3' }}>under a minute</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, background: '#fff', color: 'var(--ink-900)', fontSize: 12, fontWeight: 900 }}>
            <Icon name="Sparkles" size={13} color="var(--calo-700)" /> Chat with Calo AI
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', fontSize: 12, fontWeight: 900 }}>
            <Icon name="Upload" size={13} /> Upload data
          </div>
        </div>
      </div>
    </div>
  );
}

function MockChatBubbles() {
  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--ink-200)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ alignSelf: 'flex-end', maxWidth: '80%' }}>
        <div style={{ padding: '8px 12px', background: 'var(--ink-900)', color: '#fff', borderRadius: '12px 12px 2px 12px', fontSize: 12, fontWeight: 700 }}>
          Weekly production report for our KSA kitchens
        </div>
      </div>
      <div style={{ alignSelf: 'flex-start', maxWidth: '80%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: 'linear-gradient(135deg, var(--calo-500), var(--calo-700))', display: 'grid', placeItems: 'center' }}>
            <Icon name="Sparkles" size={9} color="#fff" />
          </div>
          <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--calo-700)' }}>Calo AI</span>
        </div>
        <div style={{ padding: '8px 12px', background: 'var(--calo-50)', border: '1px solid var(--calo-100)', color: 'var(--calo-900)', borderRadius: '2px 12px 12px 12px', fontSize: 12, lineHeight: 1.45 }}>
          Which kitchens should I include — all 6, or a subset?
        </div>
      </div>
      <div style={{ alignSelf: 'flex-end', maxWidth: '80%' }}>
        <div style={{ padding: '8px 12px', background: 'var(--ink-900)', color: '#fff', borderRadius: '12px 12px 2px 12px', fontSize: 12, fontWeight: 700 }}>
          All 6. Focus on waste and on-time delivery.
        </div>
      </div>
      <div style={{ padding: '8px 12px', background: '#FAFAF7', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, color: 'var(--ink-700)' }}>
        <Pill tone="solid" size="sm" icon="Check">Ready</Pill>
        <span style={{ flex: 1, color: 'var(--ink-600)' }}>"KSA Kitchen Weekly — Waste & Delivery"</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'var(--calo-500)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 900 }}>
          <Icon name="Sparkles" size={10} /> Build report
        </span>
      </div>
    </div>
  );
}

function MockVariantThumb({ variant }) {
  const configs = {
    editorial: {
      label: 'Editorial',
      desc: 'Magazine-style hero, big type, collapsible sections. Use when you want the report to feel like a polished story.',
    },
    dashboard: {
      label: 'Dashboard',
      desc: 'Compact 6-col KPI strip and numbered section grid. Use for operational reviews where data density matters.',
    },
    minimal: {
      label: 'Minimal',
      desc: 'Paper-like, print-ready. Use for formal internal documents and executive packets.',
    },
    brief: {
      label: 'Brief',
      desc: 'One-page summary — hero + KPIs + insights, no sections. Use for Slack-shareable one-pagers.',
    },
  };
  const c = configs[variant];
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--ink-200)', background: '#fff' }}>
      {/* Mini rendered report */}
      <div style={{ height: 150, overflow: 'hidden', position: 'relative', background: '#fff' }}>
        {variant === 'editorial' && (
          <>
            <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg, #01432D, #02B376)', color: '#fff' }}>
              <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: '.16em', opacity: .8 }}>QUARTERLY · Q1 2026</div>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.03em', marginTop: 4, lineHeight: 1 }}>Record quarter</div>
            </div>
            <div style={{ padding: '10px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {['1.24M','98.7%','3.1%','72'].map((v,i) => (
                <div key={i}>
                  <div style={{ fontSize: 6, color: '#787C72', fontWeight: 900, letterSpacing: '.1em' }}>METRIC</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#0A1F17', letterSpacing: '-0.03em' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: '8px 16px' }}>
              <div style={{ height: 4, background: '#F4F4F0', borderRadius: 2, marginBottom: 3 }} />
              <div style={{ height: 4, width: '90%', background: '#F4F4F0', borderRadius: 2, marginBottom: 3 }} />
              <div style={{ height: 4, width: '75%', background: '#F4F4F0', borderRadius: 2 }} />
            </div>
          </>
        )}
        {variant === 'dashboard' && (
          <>
            <div style={{ padding: '10px 14px', background: '#0A1F17', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CaloLogo size={9} color="#fff" />
              <div style={{ width: 1, height: 10, background: 'rgba(255,255,255,.2)' }} />
              <div style={{ fontSize: 11, fontWeight: 900 }}>Q1 2026</div>
              <div style={{ marginLeft: 'auto', padding: '2px 8px', background: '#02B376', color: '#fff', borderRadius: 999, fontSize: 7, fontWeight: 900 }}>LIVE</div>
            </div>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid #F4F4F0', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
              {['1.24M','98.7%','3.1%','72','6','412'].map((v,i) => (
                <div key={i}>
                  <div style={{ fontSize: 5, color: '#787C72', fontWeight: 900 }}>K</div>
                  <div style={{ fontSize: 10, fontWeight: 900, color: '#0A1F17' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: '8px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div style={{ padding: 6, background: '#FAFAF7', borderRadius: 4 }}>
                <div style={{ height: 3, width: 20, background: '#02B376', borderRadius: 2, marginBottom: 3 }} />
                <div style={{ height: 3, background: '#E8E9E3', borderRadius: 2, marginBottom: 2 }} />
                <div style={{ height: 3, width: '80%', background: '#E8E9E3', borderRadius: 2 }} />
              </div>
              <div style={{ padding: 6, background: '#FAFAF7', borderRadius: 4 }}>
                <div style={{ height: 3, width: 18, background: '#02B376', borderRadius: 2, marginBottom: 3 }} />
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 20 }}>
                  {[60,80,45,90,65,75].map((h,i) => (<div key={i} style={{ flex: 1, height: `${h}%`, background: i === 3 ? '#02B376' : '#CFF3E3', borderRadius: 1 }} />))}
                </div>
              </div>
            </div>
          </>
        )}
        {variant === 'minimal' && (
          <div style={{ padding: '14px 18px', background: '#FDFDFA', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <CaloLogo size={8} color="#027D53" />
              <div style={{ fontSize: 6, fontWeight: 700, color: '#787C72', letterSpacing: '.2em' }}>INTERNAL</div>
            </div>
            <div style={{ fontSize: 6, fontWeight: 900, color: '#027D53', letterSpacing: '.2em', marginBottom: 4 }}>QUARTERLY</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#0A1F17', letterSpacing: '-0.04em', lineHeight: 1.05, marginBottom: 10 }}>Production &<br/>operations, Q1 2026</div>
            <div style={{ borderTop: '2px solid #0A1F17', borderBottom: '1px solid #D5D6CF', padding: '6px 0', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {['1.24M','3.1%','98.7%','72'].map((v,i) => (
                <div key={i}>
                  <div style={{ fontSize: 5, color: '#787C72', fontWeight: 700 }}>K</div>
                  <div style={{ fontSize: 9, fontWeight: 900, color: '#0A1F17', letterSpacing: '-0.02em' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {variant === 'brief' && (
          <>
            <div style={{ padding: '12px 14px', background: 'linear-gradient(135deg, #01432D, #02B376)', color: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <CaloLogo size={9} color="#fff" />
                <div style={{ fontSize: 7, fontWeight: 900, opacity: .8, letterSpacing: '.14em' }}>BRIEF · APR 2026</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Record quarter</div>
            </div>
            <div style={{ padding: '6px 14px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, borderBottom: '1px solid #F4F4F0' }}>
              {['1.24M','3.1%','98.7%','72'].map((v,i) => (
                <div key={i}>
                  <div style={{ fontSize: 5, color: '#787C72', fontWeight: 900 }}>K</div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: '#0A1F17', letterSpacing: '-0.03em' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: '8px 14px' }}>
              <div style={{ fontSize: 5, fontWeight: 900, color: '#027D53', letterSpacing: '.14em' }}>SUMMARY</div>
              <div style={{ height: 3, background: '#E8E9E3', borderRadius: 2, marginTop: 3, marginBottom: 2 }} />
              <div style={{ height: 3, width: '85%', background: '#E8E9E3', borderRadius: 2 }} />
            </div>
          </>
        )}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--ink-100)' }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>{c.label}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 4, lineHeight: 1.45 }}>{c.desc}</div>
      </div>
    </div>
  );
}

function MockTweaksPanel() {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 14, padding: 14, boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon name="Sliders" size={13} color="var(--calo-700)" />
        <span style={{ fontSize: 12, fontWeight: 900 }}>Tweaks</span>
        <Pill tone="green" size="sm">Live preview</Pill>
      </div>
      <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--ink-500)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>LAYOUT</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 10 }}>
        {['Editorial', 'Dashboard', 'Minimal', 'Brief'].map((l, i) => (
          <div key={l} style={{ padding: '6px 8px', border: i === 0 ? '1px solid var(--calo-500)' : '1px solid var(--ink-200)', background: i === 0 ? 'var(--calo-50)' : '#fff', borderRadius: 6, fontSize: 10, fontWeight: 900, color: i === 0 ? 'var(--calo-800)' : 'var(--ink-700)' }}>
            {l}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--ink-500)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>DENSITY</div>
      <div style={{ display: 'flex', gap: 3, padding: 2, background: 'var(--ink-100)', borderRadius: 999, marginBottom: 10 }}>
        {['Compact', 'Comfortable', 'Spacious'].map((l, i) => (
          <div key={l} style={{ flex: 1, padding: '4px 0', textAlign: 'center', fontSize: 10, fontWeight: 700, background: i === 1 ? 'var(--ink-900)' : 'transparent', color: i === 1 ? '#fff' : 'var(--ink-600)', borderRadius: 999 }}>{l}</div>
        ))}
      </div>
      <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--ink-500)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>ACCENT COLOR</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {['#02B376', '#027D53', '#0A1F17', '#4F7CD9', '#E8A33D', '#8C2929'].map((c, i) => (
          <div key={c} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: i === 0 ? '2px solid var(--ink-900)' : '1px solid var(--ink-200)' }} />
        ))}
      </div>
      <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--ink-500)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>SHOW IN REPORT</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {['Hero', 'KPIs', 'Summary', 'Sections', 'Insights', 'Footer'].map(c => (
          <div key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', background: 'var(--calo-50)', border: '1px solid var(--calo-200)', borderRadius: 999, fontSize: 10, fontWeight: 700, color: 'var(--calo-800)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--calo-500)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 7, fontWeight: 900 }}>✓</span>
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

function MockSharePanel() {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 14, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--ink-900)', marginBottom: 10 }}>Who should see this report?</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { id: 'private',  icon: 'LockKeyhole', label: 'Private',       desc: 'Only me + admins', active: false },
          { id: 'shared',   icon: 'Users',       label: 'Whole team',    desc: 'Everyone on Calo',  active: true },
          { id: 'specific', icon: 'UserCheck',   label: 'Specific people', desc: 'Pick who can view', active: false },
        ].map(o => (
          <div key={o.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 8,
            background: o.active ? 'var(--calo-50)' : 'var(--ink-50)',
            border: o.active ? '1px solid var(--calo-200)' : '1px solid transparent',
          }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: o.active ? 'var(--calo-500)' : 'var(--ink-200)', color: o.active ? '#fff' : 'var(--ink-600)', display: 'grid', placeItems: 'center' }}>
              <Icon name={o.icon} size={12} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ink-900)' }}>{o.label}</div>
              <div style={{ fontSize: 10, color: 'var(--ink-500)' }}>{o.desc}</div>
            </div>
            {o.active && <Icon name="Check" size={14} color="var(--calo-700)" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function MockEditorAITab() {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 14, overflow: 'hidden' }}>
      {/* Tab row */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--ink-100)', padding: '0 14px' }}>
        {['Sections', 'Report info', 'AI Assistant'].map((t, i) => (
          <div key={t} style={{
            padding: '10px 14px', fontSize: 11, fontWeight: 700,
            color: i === 2 ? 'var(--ink-900)' : 'var(--ink-500)',
            borderBottom: i === 2 ? '2px solid var(--calo-500)' : '2px solid transparent',
            marginBottom: -1,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            {t}
            {i === 2 && <span style={{ background: 'var(--calo-500)', color: '#fff', fontSize: 7, fontWeight: 900, padding: '1px 5px', borderRadius: 6 }}>NEW</span>}
          </div>
        ))}
      </div>
      {/* AI chat chips */}
      <div style={{ padding: 14, background: 'linear-gradient(135deg, #01432D, #02B376)', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,.15)', display: 'grid', placeItems: 'center' }}>
            <Icon name="Sparkles" size={14} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '-0.01em' }}>Calo AI</div>
            <div style={{ fontSize: 9, opacity: .8 }}>Ready to help with your report</div>
          </div>
        </div>
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--calo-700)', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 8 }}>DO SOMETHING — NO TYPING NEEDED</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            { icon: 'Zap', title: 'Polish the whole report' },
            { icon: 'FileText', title: 'Write exec summary' },
            { icon: 'BarChart3', title: 'Recalculate metrics' },
            { icon: 'Languages', title: 'Translate to Arabic' },
          ].map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, border: '1px solid var(--ink-200)', borderRadius: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: 5, background: 'var(--calo-50)', color: 'var(--calo-700)', display: 'grid', placeItems: 'center' }}>
                <Icon name={a.icon} size={10} />
              </div>
              <div style={{ fontSize: 10, fontWeight: 700 }}>{a.title}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepBullet({ n }) {
  return (
    <div style={{
      width: 24, height: 24, borderRadius: 12,
      background: 'var(--calo-500)', color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 900, flexShrink: 0,
      boxShadow: '0 2px 6px rgba(2,179,118,.3)',
    }}>{n}</div>
  );
}

function SectionHeader({ eyebrow, title, desc }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="eyebrow" style={{ color: 'var(--calo-700)' }}>{eyebrow}</div>
      <h2 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', margin: '2px 0 6px', color: 'var(--ink-900)' }}>{title}</h2>
      {desc && <p style={{ fontSize: 14, color: 'var(--ink-500)', margin: 0, lineHeight: 1.55, maxWidth: 560 }}>{desc}</p>}
    </div>
  );
}

// ─── Main Guide page ─────────────────────────────────────────────────────────

export default function GuidePage() {
  const navigate = useNavigate();

  return (
    <div className="animate-slide-up" style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        eyebrow="GUIDE"
        title="How Calo Reports works"
        subtitle="Everything you need to make great reports — from your first prompt to a published, branded deliverable."
        actions={
          <Btn variant="primary" icon="Sparkles" onClick={() => navigate('/new?mode=chat')}>
            Try it now
          </Btn>
        }
      />

      {/* TOC */}
      <Card padding={18} style={{ marginBottom: 28 }}>
        <Eyebrow>ON THIS PAGE</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 10 }}>
          {[
            { h: '#start',   n: '01', t: 'Start a report' },
            { h: '#chat',    n: '02', t: 'The chat flow' },
            { h: '#layouts', n: '03', t: 'Four layouts' },
            { h: '#tweaks',  n: '04', t: 'Tweak the look' },
            { h: '#refine',  n: '05', t: 'Refine with AI' },
            { h: '#share',   n: '06', t: 'Share & publish' },
            { h: '#blocks',  n: '07', t: 'Block types' },
            { h: '#tips',    n: '08', t: 'Tips & shortcuts' },
          ].map(s => (
            <a key={s.n} href={s.h} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 8,
              background: 'var(--ink-50)', color: 'var(--ink-800)',
              textDecoration: 'none', fontSize: 13, fontWeight: 700,
              border: '1px solid transparent',
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--calo-50)'; e.currentTarget.style.borderColor = 'var(--calo-100)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--ink-50)'; e.currentTarget.style.borderColor = 'transparent'; }}
            >
              <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--calo-700)', letterSpacing: '-0.01em' }}>{s.n}</span>
              <span>{s.t}</span>
              <Icon name="ChevronRight" size={13} color="var(--ink-400)" style={{ marginLeft: 'auto' }} />
            </a>
          ))}
        </div>
      </Card>

      {/* ───── 01 Start ─────────────────────────────────────────────── */}
      <section id="start" style={{ marginBottom: 40 }}>
        <SectionHeader
          eyebrow="01 · GETTING STARTED"
          title="Three ways to start a report"
          desc="Every new report begins from the home dashboard. You have three paths — pick whichever fits how you're thinking today."
        />

        <Card padding={20} style={{ marginBottom: 14 }}>
          <Eyebrow>WHAT YOU'LL SEE ON HOME</Eyebrow>
          <div style={{ marginTop: 10 }}>
            <MockDashboardHero />
          </div>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <Card padding={18}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', background: 'var(--calo-500)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 900 }}>
              <Icon name="Zap" size={11} /> FASTEST
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-0.01em', marginTop: 10 }}>Chat with Calo AI</div>
            <p style={{ fontSize: 13, color: 'var(--ink-600)', marginTop: 6, lineHeight: 1.5 }}>
              Describe what you need in plain English. AI asks up to 3 clarifying questions, then builds the whole report. No file required.
            </p>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 10, fontWeight: 700 }}>Best for: quick drafts, anyone</div>
          </Card>

          <Card padding={18}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', background: 'var(--ink-100)', color: 'var(--ink-700)', borderRadius: 999, fontSize: 11, fontWeight: 900 }}>
              <Icon name="Upload" size={11} /> DATA-DRIVEN
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-0.01em', marginTop: 10 }}>Upload a file</div>
            <p style={{ fontSize: 13, color: 'var(--ink-600)', marginTop: 6, lineHeight: 1.5 }}>
              Drop an Excel, CSV, JSON, or text file. The platform parses it, previews the shape, then Claude turns it into a structured report.
            </p>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 10, fontWeight: 700 }}>Best for: real operational data, up to 25 MB</div>
          </Card>

          <Card padding={18}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', background: 'var(--ink-100)', color: 'var(--ink-700)', borderRadius: 999, fontSize: 11, fontWeight: 900 }}>
              <Icon name="FilePlus" size={11} /> MANUAL
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-0.01em', marginTop: 10 }}>Start blank</div>
            <p style={{ fontSize: 13, color: 'var(--ink-600)', marginTop: 6, lineHeight: 1.5 }}>
              Click Blank report in the New Report page. You get an empty canvas and the block editor — good for fully hand-crafted reports.
            </p>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 10, fontWeight: 700 }}>Best for: templated workflows, full control</div>
          </Card>
        </div>
      </section>

      {/* ───── 02 Chat flow ─────────────────────────────────────────── */}
      <section id="chat" style={{ marginBottom: 40 }}>
        <SectionHeader
          eyebrow="02 · ZERO EFFORT"
          title="The chat flow, end to end"
          desc="You land in a textbox. Type what you want. Calo AI might ask 1–3 quick questions, then generates the full report — sections, KPIs, summary, insights."
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'start' }} className="guide-2col">
          <Card padding={18}>
            <Eyebrow>TYPICAL CONVERSATION</Eyebrow>
            <div style={{ marginTop: 10 }}>
              <MockChatBubbles />
            </div>
          </Card>

          <Card padding={18}>
            <Eyebrow>WHAT HAPPENS</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
              {[
                { t: 'Open the chat', d: 'Dashboard → "Chat with Calo AI" (the big white pill on the green hero), or sidebar → New Report.' },
                { t: 'Describe what you need', d: 'One sentence is enough. You can also click a recent prompt chip to refill.' },
                { t: 'Answer clarifying Qs', d: 'AI asks at most 3 short questions — period, scope, focus. Skip answering by typing "just build it".' },
                { t: 'Build report', d: 'When AI says "Ready", the green "Build report" button appears. Claude Opus runs ~30–60s to generate.' },
                { t: 'Refine in editor', d: 'You land in the editor with the chat history preserved — keep talking to refine.' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 12 }}>
                  <StepBullet n={i + 1} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>{s.t}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-600)', marginTop: 2, lineHeight: 1.5 }}>{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card padding={14} style={{ marginTop: 14, background: 'var(--calo-50)', borderColor: 'var(--calo-100)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--calo-800)', fontWeight: 700 }}>
            <Icon name="Sparkles" size={14} color="var(--calo-700)" />
            <span><strong>Tip:</strong> the textarea sends on <kbd style={{ padding: '2px 6px', background: '#fff', border: '1px solid var(--calo-200)', borderRadius: 6, fontSize: 11, fontWeight: 900, fontFamily: 'inherit' }}>⏎ Enter</kbd> and adds a new line on <kbd style={{ padding: '2px 6px', background: '#fff', border: '1px solid var(--calo-200)', borderRadius: 6, fontSize: 11, fontWeight: 900, fontFamily: 'inherit' }}>⇧ + ⏎</kbd>.</span>
          </div>
        </Card>
      </section>

      {/* ───── 03 Four layouts ──────────────────────────────────────── */}
      <section id="layouts" style={{ marginBottom: 40 }}>
        <SectionHeader
          eyebrow="03 · VISUAL OUTPUT"
          title="Four ways your report can look"
          desc="Every report can be rendered in four different layouts. Same data — different container. Switch anytime in the Tweaks panel."
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <MockVariantThumb variant="editorial" />
          <MockVariantThumb variant="dashboard" />
          <MockVariantThumb variant="minimal" />
          <MockVariantThumb variant="brief" />
        </div>

        <Card padding={14} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-600)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--ink-900)' }}>Content differs by layout.</strong> Editorial shows everything in full; Dashboard is compact and can auto-filter notes-heavy sections (see the "Summarize sections" toggle); Minimal keeps the full content in a quiet paper format; Brief hides sections entirely and distills the report into a single page (hero + KPIs + summary + numbered takeaways).
          </div>
        </Card>
      </section>

      {/* ───── 04 Tweaks ────────────────────────────────────────────── */}
      <section id="tweaks" style={{ marginBottom: 40 }}>
        <SectionHeader
          eyebrow="04 · MODULAR"
          title="Tweak how your report looks"
          desc="Click the Tweaks button on any preview page. Changes render live — save to lock them into exports, publishes, and password-gated copies."
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }} className="guide-2col">
          <Card padding={18}>
            <Eyebrow>WHAT THE PANEL LOOKS LIKE</Eyebrow>
            <div style={{ marginTop: 10 }}>
              <MockTweaksPanel />
            </div>
          </Card>

          <Card padding={18}>
            <Eyebrow>WHAT YOU CAN CHANGE</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {[
                { t: 'Layout', d: 'Editorial, Dashboard, Minimal, Brief — changes visual structure AND content density.' },
                { t: 'Density', d: 'Compact (0.82×), Comfortable (1.0×), Spacious (1.18×) — scales hero paddings, h1 size, card padding.' },
                { t: 'Page width', d: 'Narrow 760 / Medium 960 / Wide 1120 px — max content width.' },
                { t: 'Accent color', d: '6 presets (Calo green, Forest, Ink, Ocean, Ember, Burgundy) + custom hex.' },
                { t: 'Show / hide', d: 'Toggle Hero, KPIs, Summary, Sections, Insights, Footer individually.' },
                { t: 'Summarize sections', d: 'Dashboard / Editorial only — filters out notes-heavy sections and trims long note blocks.' },
              ].map(s => (
                <div key={s.t} style={{ display: 'flex', gap: 10, padding: '8px 10px', background: 'var(--ink-50)', borderRadius: 8 }}>
                  <Pill tone="green" size="sm">{s.t}</Pill>
                  <div style={{ fontSize: 12, color: 'var(--ink-600)', lineHeight: 1.5, flex: 1 }}>{s.d}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* ───── 05 Refine ────────────────────────────────────────────── */}
      <section id="refine" style={{ marginBottom: 40 }}>
        <SectionHeader
          eyebrow="05 · REFINE WITH AI"
          title="Keep editing with Claude"
          desc="After generation you land in the editor. Your chat history carries through — the AI Assistant tab is open and ready to keep iterating."
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }} className="guide-2col">
          <Card padding={18}>
            <Eyebrow>THE AI ASSISTANT TAB</Eyebrow>
            <div style={{ marginTop: 10 }}>
              <MockEditorAITab />
            </div>
          </Card>

          <Card padding={18}>
            <Eyebrow>HOW TO USE IT</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              <div style={{ padding: 10, background: 'var(--ink-50)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ink-900)' }}>Quick actions (no typing)</div>
                <div style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 3, lineHeight: 1.45 }}>Polish all sections · Add exec summary · Recalculate metrics · Translate to Arabic · Make it shorter · Suggest insights</div>
              </div>
              <div style={{ padding: 10, background: 'var(--ink-50)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ink-900)' }}>Say it in your words</div>
                <div style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 3, lineHeight: 1.45 }}>Type plain-English edits: "make the waste section bigger", "add a KPI for customer retention", "translate to Arabic".</div>
              </div>
              <div style={{ padding: 10, background: 'var(--ink-50)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ink-900)' }}>Upload additional files</div>
                <div style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 3, lineHeight: 1.45 }}>Paperclip icon → attach another Excel/CSV mid-report. AI reads it and merges the data.</div>
              </div>
              <div style={{ padding: 10, background: 'var(--ink-50)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ink-900)' }}>Smart routing</div>
                <div style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 3, lineHeight: 1.45 }}>Chat defaults to <strong>Claude Sonnet</strong> (fast + cheap). Initial generation uses <strong>Claude Opus</strong> (deeper reasoning). You can override per-call.</div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ───── 06 Share ─────────────────────────────────────────────── */}
      <section id="share" style={{ marginBottom: 40 }}>
        <SectionHeader
          eyebrow="06 · SHARE & PUBLISH"
          title="Who should see this report?"
          desc="Every report has a 3-state share preference — and a Netlify publish button for making it live on the web with an optional password."
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }} className="guide-2col">
          <Card padding={18}>
            <Eyebrow>SHARE OPTIONS</Eyebrow>
            <div style={{ marginTop: 10 }}>
              <MockSharePanel />
            </div>
          </Card>

          <Card padding={18}>
            <Eyebrow>PUBLISHING TO THE WEB</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              <div style={{ padding: 10, background: 'var(--ink-50)', borderRadius: 8, display: 'flex', gap: 10 }}>
                <Icon name="Globe" size={15} color="var(--calo-700)" />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 900 }}>Netlify — one click</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.5 }}>Preview page → Publish. Gets a <code style={{ background: 'var(--ink-100)', padding: '1px 4px', borderRadius: 4, fontSize: 10 }}>*.netlify.app</code> URL. Republish later uses the same site.</div>
                </div>
              </div>
              <div style={{ padding: 10, background: 'var(--ink-50)', borderRadius: 8, display: 'flex', gap: 10 }}>
                <Icon name="Shield" size={15} color="var(--calo-700)" />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 900 }}>Password protection</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.5 }}>Set an access code on Publish. Embedded as a SHA-256 hash in the exported HTML — no server needed.</div>
                </div>
              </div>
              <div style={{ padding: 10, background: 'var(--ink-50)', borderRadius: 8, display: 'flex', gap: 10 }}>
                <Icon name="FileDown" size={15} color="var(--calo-700)" />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 900 }}>Also: HTML, PDF, PNG, Copy</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.5 }}>All buttons in the preview page. PDF uses your browser's Print dialog (Chrome's "Save as PDF" works best).</div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Card padding={14} style={{ marginTop: 14, background: '#FEF5E4', borderColor: '#F6E0B6' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="AlertTriangle" size={15} color="#8A5A1A" />
            <div style={{ fontSize: 12, color: '#8A5A1A', lineHeight: 1.55 }}>
              <strong>Sensitive data?</strong> Always set Share to <strong>Private</strong> or <strong>Specific people</strong> before publishing, and add a password. Netlify URLs are public by default unless gated.
            </div>
          </div>
        </Card>
      </section>

      {/* ───── 07 Block types ──────────────────────────────────────── */}
      <section id="blocks" style={{ marginBottom: 40 }}>
        <SectionHeader
          eyebrow="07 · BUILDING BLOCKS"
          title="The 10 block types"
          desc="Every section is made up of blocks. AI uses them automatically; you can also add them manually in the editor's Sections tab."
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          {[
            { icon: 'Type',           name: 'Badge',      desc: 'Colored label with title, subtitle, period — great for flags like "Q1 closed strong".', style: 'green' },
            { icon: 'MessageSquare',  name: 'Notes',      desc: 'Bullet list or paragraph. Use for observations, commentary, narrative.' },
            { icon: 'BarChart3',      name: 'Metrics',    desc: 'Grid of KPI cards with label, value, change %, trend arrow.' },
            { icon: 'Table',          name: 'Table',      desc: 'Headers + rows. Zebra striped, dark ink header, auto-coloring of negative values.' },
            { icon: 'List',           name: 'Key-value',  desc: 'Stacked key/value rows — use for summaries, operational stats.' },
            { icon: 'Copy',           name: 'Comparison', desc: 'Two-column side-by-side, one styled as accent gradient. Perfect for vs. previous period.' },
            { icon: 'AlertTriangle',  name: 'Callout',    desc: 'Dark ink-900 hero card with green accent circle — for headline statements.' },
            { icon: 'BarChart3',      name: 'Chart',      desc: 'Bar / line / pie / doughnut via Chart.js, data configured inline.' },
            { icon: 'Image',          name: 'Image',      desc: 'URL + caption, max-width 100%, soft shadow. Use for photos, diagrams.' },
            { icon: 'Link2',          name: 'Link',       desc: 'Pill card linking out — great for "full dashboard in Tableau" etc.' },
          ].map(b => (
            <div key={b.name} style={{ padding: 12, border: '1px solid var(--ink-200)', borderRadius: 10, background: '#fff', display: 'flex', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--calo-50)', color: 'var(--calo-700)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name={b.icon} size={15} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>{b.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-600)', marginTop: 3, lineHeight: 1.5 }}>{b.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───── 08 Tips ──────────────────────────────────────────────── */}
      <section id="tips" style={{ marginBottom: 40 }}>
        <SectionHeader
          eyebrow="08 · POWER USER"
          title="Tips & keyboard shortcuts"
          desc="Little things that save real time once you use the platform daily."
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <Card padding={16}>
            <Eyebrow>CHAT TEXTAREA</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--ink-700)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <kbd style={kbdStyle}>⏎</kbd>
                <span>Send message</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <kbd style={kbdStyle}>⇧ + ⏎</kbd>
                <span>New line</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, opacity: .6 }}>Type</span>
                <kbd style={kbdStyle}>just build it</kbd>
                <span>to skip clarifying Qs</span>
              </div>
            </div>
          </Card>

          <Card padding={16}>
            <Eyebrow>PERSONAL MEMORY</Eyebrow>
            <ul style={listStyle}>
              <li>Your <strong>last 10 prompts</strong> are saved locally — they appear as chips on the chat screen.</li>
              <li>Your <strong>default share setting</strong> (Private / Team / Specific) remembers itself.</li>
              <li>Your <strong>tweaks</strong> (variant, color, density, toggles) persist per-report.</li>
            </ul>
          </Card>

          <Card padding={16}>
            <Eyebrow>AI MODEL USAGE</Eyebrow>
            <ul style={listStyle}>
              <li><strong>Auto</strong> is almost always right. Let smart routing pick.</li>
              <li>For a very complex initial brief with 100+ data columns, switch to <strong>Opus</strong> manually.</li>
              <li>For quick section edits, <strong>Sonnet</strong> is ~5× cheaper and usually indistinguishable.</li>
            </ul>
          </Card>

          <Card padding={16}>
            <Eyebrow>EXPORT QUALITY</Eyebrow>
            <ul style={listStyle}>
              <li>PDF: use Chrome and choose <strong>A4 / Portrait</strong> in the Print dialog for best margins.</li>
              <li>Image: html2canvas expands collapsed sections automatically before capture.</li>
              <li>HTML export includes inline fonts + Chart.js so it opens offline.</li>
            </ul>
          </Card>

          <Card padding={16}>
            <Eyebrow>TROUBLESHOOTING</Eyebrow>
            <ul style={listStyle}>
              <li>If AI returns "invalid JSON", click <strong>Regenerate</strong> — rare transient issue.</li>
              <li>If Netlify publish fails, check the Netlify token in your account's Render env vars.</li>
              <li>Chat history not carrying to editor? Make sure you came from the chat-first flow (<code>/new?mode=chat</code>).</li>
            </ul>
          </Card>

          <Card padding={16}>
            <Eyebrow>PRIVACY</Eyebrow>
            <ul style={listStyle}>
              <li>Uploaded files are parsed server-side and stored inline with the report.</li>
              <li>API keys (Netlify, Claude) are admin-only and live in server env vars, never on the client.</li>
              <li>Admin-approved registration only — ask an admin for the company code.</li>
            </ul>
          </Card>
        </div>
      </section>

      {/* Final CTA */}
      <Card padding={24} style={{ background: 'linear-gradient(135deg, #01432D, #02B376)', color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: .08 }} viewBox="0 0 800 200">
          <defs>
            <pattern id="glf2" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
              <circle cx="30" cy="30" r="1.5" fill="#fff" />
            </pattern>
          </defs>
          <rect width="800" height="200" fill="url(#glf2)" />
        </svg>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <Leaf size={32} color="#CFF3E3" style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em' }}>Ready to try it?</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.85)', marginTop: 4 }}>
              Jump in — your first report is about 60 seconds away.
            </div>
          </div>
          <button
            onClick={() => navigate('/new?mode=chat')}
            style={{
              padding: '14px 22px', borderRadius: 999,
              background: '#fff', color: 'var(--ink-900)',
              fontSize: 14, fontWeight: 900, border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 8,
              boxShadow: '0 6px 20px rgba(0,0,0,.18)',
              letterSpacing: '-0.01em',
            }}
          >
            <Icon name="Sparkles" size={16} color="var(--calo-700)" />
            Chat with Calo AI
            <Icon name="ArrowRight" size={16} />
          </button>
        </div>
      </Card>

      {/* Responsive — stack the two-column sections on narrow screens */}
      <style>{`
        @media (max-width: 768px) {
          .guide-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

const kbdStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 8px',
  background: 'var(--ink-100)',
  border: '1px solid var(--ink-200)',
  borderBottomWidth: 2,
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 900,
  color: 'var(--ink-800)',
  fontFamily: 'inherit',
};

const listStyle = {
  listStyle: 'none',
  padding: 0,
  margin: '10px 0 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  fontSize: 12,
  color: 'var(--ink-600)',
  lineHeight: 1.5,
};
