import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { Card, Pill, Eyebrow, Btn, Icon, PageHeader } from '../components/ui';

function MiniStatCard({ label, value, trend, to, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '14px 16px',
        background: '#fff', border: '1px solid var(--ink-200)',
        borderRadius: 'var(--r-md)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all .15s ease',
      }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.borderColor = 'var(--calo-300)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; } }}
      onMouseLeave={e => { if (onClick) { e.currentTarget.style.borderColor = 'var(--ink-200)'; e.currentTarget.style.boxShadow = 'none'; } }}
    >
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginTop: 4, color: 'var(--ink-900)' }}>{value}</div>
      {trend && <div style={{ fontSize: 11, color: 'var(--calo-600)', fontWeight: 700 }}>{trend}</div>}
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

function ActivityItem({ who, did, what, time }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13 }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--calo-500)', marginTop: 8, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <span style={{ fontWeight: 700 }}>{who}</span>
        <span style={{ color: 'var(--ink-500)' }}> {did} </span>
        <span style={{ fontWeight: 700 }}>{what}</span>
        <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2, fontWeight: 700 }}>{time}</div>
      </div>
    </div>
  );
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
  const pub = stats?.publishedReports ?? 0;
  const tmpl = stats?.totalTemplates ?? 0;
  const aiTot = stats?.aiUsage?.total ?? 0;
  const recent = stats?.recentReports || [];

  const kpiCards = [
    { label: 'In progress', value: String(drafts),                 trend: drafts > 0 ? `${drafts} pending` : 'All clear', to: '/reports?status=draft' },
    { label: 'All reports', value: String(tot),                    trend: tot > 0 ? 'Your workspace' : 'Start here',       to: '/reports' },
    { label: 'Published',   value: String(pub),                    trend: pub > 0 ? 'Live' : '—',                          to: '/reports?status=published' },
    { label: 'Templates',   value: String(tmpl),                   trend: 'Reusable',                                      to: '/templates' },
    { label: 'AI calls',    value: String(aiTot),                  trend: aiTot > 0 ? 'This workspace' : '—' },
    { label: 'Users',       value: String(stats?.activeUsers ?? 1), trend: user?.role === 'admin' ? 'Active' : 'You' },
  ];

  return (
    <div className="animate-slide-up">
      <PageHeader
        eyebrow="HOME"
        title={`Welcome back, ${user?.name?.split(' ')[0] || 'there'}`}
        subtitle="Your reports, AI activity and team signals in one place."
        actions={
          <>
            <Btn variant="secondary" icon="LayoutTemplate" onClick={() => navigate('/templates')}>Templates</Btn>
            <Btn variant="primary" size="lg" icon="Plus" onClick={() => navigate('/new')}>New report</Btn>
          </>
        }
      />

      {/* Hero CTA — "0 effort" entry point */}
      <div
        style={{
          background: 'linear-gradient(135deg, #01432D 0%, #016040 45%, #02B376 100%)',
          color: '#fff',
          borderRadius: 'var(--r-xl)',
          padding: '32px 36px',
          marginBottom: 24,
          position: 'relative', overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Decorative leaf pattern */}
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
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.18em', opacity: .8, marginBottom: 6 }}>START HERE</div>
            <h2 style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, margin: 0 }}>
              Create a report in <span style={{ color: '#CFF3E3' }}>under a minute</span>
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,.85)', margin: '8px 0 0', maxWidth: 480, lineHeight: 1.55 }}>
              Chat with Calo AI or drop a file. We'll build the sections, KPIs and insights.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/new?mode=chat')}
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
              <Icon name="Sparkles" size={18} color="var(--calo-700)" />
              Chat with Calo AI
            </button>
            <button
              onClick={() => navigate('/new')}
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
              <Icon name="Upload" size={18} />
              Upload data
            </button>
          </div>
        </div>
      </div>

      {/* 6-col KPI strip */}
      <div
        className="kpi-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12, marginBottom: 24 }}
      >
        {kpiCards.map((k, i) => (
          <MiniStatCard key={i} label={k.label} value={k.value} trend={k.trend} onClick={k.to ? () => navigate(k.to) : undefined} />
        ))}
      </div>

      <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 20 }}>
        {/* Recent reports */}
        <Card padding={0}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--ink-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.01em' }}>Recent reports</div>
            <Pill tone="neutral" size="sm">{tot} total</Pill>
          </div>
          {recent.length === 0 && (
            <div style={{ padding: '48px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-700)', marginBottom: 6 }}>No reports yet</div>
              <div style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 18 }}>Drop a file or pick a template to start your first report.</div>
              <Btn variant="primary" icon="Plus" onClick={() => navigate('/new')}>New report</Btn>
            </div>
          )}
          {recent.map((r, i) => (
            <div
              key={r.id}
              onClick={() => navigate(`/reports/${r.id}`)}
              style={{
                padding: '14px 20px',
                borderBottom: i < recent.length - 1 ? '1px solid var(--ink-100)' : 'none',
                display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 16,
                alignItems: 'center', cursor: 'pointer', transition: 'background .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--ink-50)'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink-900)' }}>{r.title}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>
                  {r.updated_at ? format(new Date(r.updated_at), 'MMM d, yyyy') : ''} · {timeAgo(r.updated_at)}
                </div>
              </div>
              <StatusPill status={r.status} />
              <Icon name="ChevronRight" size={16} color="var(--ink-400)" />
            </div>
          ))}
        </Card>

        {/* Sidebar cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <Eyebrow>Quick start</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              <Btn variant="primary" icon="Upload" full onClick={() => navigate('/new')}>Upload data</Btn>
              <Btn variant="secondary" icon="LayoutTemplate" full onClick={() => navigate('/templates')}>From template</Btn>
              <Btn variant="leaf" icon="Sparkles" full onClick={() => navigate('/new')}>Ask AI</Btn>
            </div>
          </Card>

          <Card>
            <Eyebrow>AI usage</Eyebrow>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <span className="num" style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-0.03em' }}>{aiTot}</span>
              <span style={{ fontSize: 13, color: 'var(--ink-500)', fontWeight: 700 }}>generations</span>
            </div>
            {stats?.aiUsage?.byProvider && Object.keys(stats.aiUsage.byProvider).length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(stats.aiUsage.byProvider).map(([p, c]) => (
                  <div key={p} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--ink-500)', textTransform: 'capitalize', fontWeight: 700 }}>{p}</span>
                    <span className="num" style={{ fontWeight: 900, color: 'var(--ink-900)' }}>{c}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {user?.role === 'admin' && stats?.totalUsers != null && (
            <Card>
              <Eyebrow>Admin</Eyebrow>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                {[
                  ['Total users',     stats.totalUsers],
                  ['Active users',    stats.activeUsers],
                  ['All reports',     stats.companyReports],
                  ['Company AI',      stats.companyAiUsage],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--ink-500)', fontWeight: 700 }}>{k}</span>
                    <span className="num" style={{ fontWeight: 900 }}>{v}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 1023px) {
          .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .dash-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 639px) {
          .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
      `}</style>
    </div>
  );
}
