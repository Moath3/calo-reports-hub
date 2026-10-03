import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { Card, Pill, Eyebrow, Btn, Icon, PageHeader } from '../components/ui';

function BetaPill() {
  return (
    <span style={{
      fontSize: 9, fontWeight: 900, letterSpacing: '.1em', lineHeight: 1.3,
      padding: '2px 7px', borderRadius: 999,
      background: 'var(--calo-50)', color: 'var(--calo-700)', border: '1px solid var(--calo-200)',
    }}>BETA</span>
  );
}

// A people-tool feature card — icon tile, what it does, how to use it, CTA.
function ToolCard({ icon, title, beta, blurb, points, cta, to, tone = 'default' }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={() => navigate(to)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: '#fff', border: `1px solid ${hover ? 'var(--calo-300)' : 'var(--ink-200)'}`,
        borderRadius: 'var(--r-xl)', padding: '22px 24px',
        cursor: 'pointer', transition: 'all .18s ease',
        boxShadow: hover ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
        transform: hover ? 'translateY(-2px)' : 'none',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0,
          background: tone === 'dark' ? 'var(--ink-900)' : 'linear-gradient(135deg, var(--calo-50), var(--calo-100))',
          border: tone === 'dark' ? 'none' : '1px solid var(--calo-200)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={icon} size={20} color={tone === 'dark' ? '#fff' : 'var(--calo-700)'} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-0.02em', color: 'var(--ink-900)' }}>{title}</span>
          {beta && <BetaPill />}
        </div>
      </div>
      <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-600)', margin: 0 }}>{blurb}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {points.map(p => (
          <span key={p} style={{
            fontSize: 11, fontWeight: 700, color: 'var(--ink-600)',
            background: 'var(--ink-50)', border: '1px solid var(--ink-150, var(--ink-100))',
            padding: '4px 10px', borderRadius: 999,
          }}>{p}</span>
        ))}
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 900, color: 'var(--calo-700)' }}>
        {cta} <Icon name="ArrowRight" size={15} />
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    published: { tone: 'solid', label: 'Live' },
    done:      { tone: 'green', label: 'Done' },
    draft:     { tone: 'amber', label: 'Draft' },
    archived:  { tone: 'neutral', label: 'Archived' },
  };
  const s = map[status] || { tone: 'neutral', label: status || 'Draft' };
  return <Pill tone={s.tone} size="sm">{s.label}</Pill>;
}

function timeAgo(iso) {
  if (!iso) return '';
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return ''; }
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardStats()
      .then(setStats)
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 256 }}>
        <div style={{ width: 40, height: 40, borderRadius: 20, border: '3px solid var(--calo-100)', borderTopColor: 'var(--calo-500)', animation: 'spinner 1s linear infinite' }} />
      </div>
    );
  }

  const tot = stats?.totalReports ?? 0;
  const drafts = stats?.draftReports ?? 0;
  const aiTot = stats?.aiUsage?.total ?? 0;
  const recent = (stats?.recentReports || []).slice(0, 4);
  const isAdmin = user?.role === 'admin';

  return (
    <div className="animate-slide-up">
      <PageHeader
        eyebrow="HOME"
        title={`Welcome back, ${user?.name?.split(' ')[0] || 'there'}`}
        subtitle="Live people data from Zelt, attendance & overtime, and AI-assisted reports — one hub."
      />

      {/* Hero — what this hub is now */}
      <div
        style={{
          background: 'linear-gradient(135deg, #01432D 0%, #016040 45%, #02B376 100%)',
          color: '#fff',
          borderRadius: 'var(--r-xl)',
          padding: '30px 36px',
          marginBottom: 24,
          position: 'relative', overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: .08, pointerEvents: 'none' }} viewBox="0 0 800 300" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="hero-leaf" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <circle cx="40" cy="40" r="1.5" fill="#fff" />
              <path d="M14 66 Q 40 42 66 66" stroke="#fff" strokeWidth="1.2" fill="none" opacity=".4" />
            </pattern>
          </defs>
          <rect width="800" height="300" fill="url(#hero-leaf)" />
        </svg>

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 28, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.18em', opacity: .8, marginBottom: 6 }}>PEOPLE TOOLS</div>
            <h2 style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.12, margin: 0 }}>
              Answers from your people data, <span style={{ color: '#CFF3E3' }}>without the spreadsheet grind</span>
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,.85)', margin: '8px 0 0', maxWidth: 520, lineHeight: 1.55 }}>
              Leave balances straight from Zelt. Overtime from the punch machines, night shifts counted right.
              And an AI studio when you need it packaged as a report.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/leave-balances')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '14px 22px', fontSize: 15, fontWeight: 900,
                borderRadius: 'var(--r-pill)',
                background: '#fff', color: 'var(--ink-900)',
                border: 'none', cursor: 'pointer', letterSpacing: '-0.01em',
                boxShadow: '0 6px 20px rgba(0,0,0,.18)',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,.22)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,.18)'; }}
            >
              <Icon name="CalendarCheck" size={18} color="var(--calo-700)" />
              Leave balances
            </button>
            <button
              onClick={() => navigate('/time-attendance')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '14px 22px', fontSize: 15, fontWeight: 900,
                borderRadius: 'var(--r-pill)',
                background: 'rgba(255,255,255,.14)', color: '#fff',
                border: '1px solid rgba(255,255,255,.25)',
                cursor: 'pointer', letterSpacing: '-0.01em', whiteSpace: 'nowrap',
                backdropFilter: 'blur(4px)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.22)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.14)'}
            >
              <Icon name="Clock" size={18} />
              Time &amp; Attendance
            </button>
          </div>
        </div>
      </div>

      {/* The tools */}
      <div className="tools-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <ToolCard
          icon="CalendarCheck"
          title="Leave Balances"
          to="/leave-balances"
          cta="Open leave balances"
          blurb="Live annual-leave balances for any entity or department, read straight from Zelt. Shows what each person can book now, Zelt's own balance, approved upcoming bookings, and requests still waiting on a manager."
          points={['Live from Zelt', 'Available now + pending', 'Entity & department filters', 'CSV export']}
        />
        <ToolCard
          icon="Clock"
          title="Time & Attendance"
          to="/time-attendance"
          cta="Run an attendance period"
          blurb="Upload the punch-machine export and get per-country overtime (UAE after 10h; KSA, Kuwait & Bahrain after 9h), absences, and night shifts counted once on the punch-in day — even when the export splits them. Checks everyone against Zelt automatically when no master file is uploaded."
          points={['Per-country OT rules', 'Overnight shifts handled', 'Zelt dept/title checks', 'Branded Excel + AI summary']}
        />
      </div>

      {isAdmin && (
        <div className="tools-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <ToolCard
            icon="ShieldCheck"
            title="Data Hygiene"
            beta
            to="/data-hygiene"
            cta="Check data health"
            blurb="Audits every live Zelt record against the 2026 people structure — departments, titles, business lines, IDs, entities — plus the masterfiles. One health score, the issues that are costing it, and a nightly watcher with a weekly digest."
            points={['Health score', 'Masterfile cross-check', 'Nightly snapshots']}
          />
          <ToolCard
            icon="TrendingUp"
            title="Mobility"
            beta
            to="/mobility"
            cta="View turnover"
            blurb="Joiners, leavers and internal moves across entities over time, computed from Zelt lifecycle data. Turnover trends by month, entity and department."
            points={['Turnover trends', 'Joiners & leavers', 'By entity / department']}
          />
        </div>
      )}

      {/* Reports & AI studio — now one section, not the whole page */}
      <Card padding={0}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--ink-200)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--calo-50), var(--calo-100))', border: '1px solid var(--calo-200)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="Sparkles" size={18} color="var(--calo-700)" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.01em' }}>Reports &amp; AI studio</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
              Chat with Calo AI or drop a file — it builds the sections, KPIs and insights. {tot > 0 ? `${tot} reports · ${drafts} in progress · ${aiTot} AI generations.` : 'Your first report takes under a minute.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn variant="secondary" icon="LayoutTemplate" onClick={() => navigate('/templates')}>Templates</Btn>
            <Btn variant="secondary" icon="FolderOpen" onClick={() => navigate('/reports')}>My reports</Btn>
            <Btn variant="primary" icon="Plus" onClick={() => navigate('/new')}>New report</Btn>
          </div>
        </div>

        {recent.length > 0 ? recent.map((r, i) => (
          <div
            key={r.id}
            onClick={() => navigate(`/reports/${r.id}`)}
            style={{
              padding: '12px 22px',
              borderBottom: i < recent.length - 1 ? '1px solid var(--ink-100)' : 'none',
              display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16,
              alignItems: 'center', cursor: 'pointer', transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--ink-50)'}
            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink-900)' }}>{r.title}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>
                {r.updated_at ? format(new Date(r.updated_at), 'MMM d, yyyy') : ''} · {timeAgo(r.updated_at)}
              </div>
            </div>
            <StatusPill status={r.status} />
            <Icon name="ChevronRight" size={16} color="var(--ink-400)" />
          </div>
        )) : (
          <div style={{ padding: '28px 22px', textAlign: 'center', fontSize: 13, color: 'var(--ink-500)' }}>
            No reports yet — start one with the buttons above.
          </div>
        )}
      </Card>

      <style>{`
        @media (max-width: 1023px) {
          .tools-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
