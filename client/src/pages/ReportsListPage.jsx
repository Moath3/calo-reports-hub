import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Card, Pill, Btn, Icon, PageHeader } from '../components/ui';

const statusOpts = [
  { value: 'all',       label: 'All' },
  { value: 'draft',     label: 'Drafts' },
  { value: 'done',      label: 'Done' },
  { value: 'published', label: 'Live' },
  { value: 'archived',  label: 'Archived' },
];

function statusPill(s) {
  const map = {
    published: { tone: 'solid', label: 'Live' },
    done:      { tone: 'green', label: 'Done' },
    draft:     { tone: 'amber', label: 'Draft' },
    archived:  { tone: 'neutral', label: 'Archived' },
  };
  const t = map[s] || { tone: 'neutral', label: s || 'Draft' };
  return <Pill tone={t.tone} size="sm">{t.label}</Pill>;
}

export default function ReportsListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [viewMode, setViewMode] = useState('mine');

  const statusFilter = searchParams.get('status') || 'all';
  const [search, setSearch] = useState(searchParams.get('search') || '');

  const fetchReports = async (pg = page) => {
    setLoading(true);
    try {
      const params = { page: pg, limit: 12 };
      if (viewMode === 'shared') params.visibility = 'shared';
      else if (statusFilter !== 'all') params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      const res = await api.getReports(params);
      setReports(res.reports || []);
      setTotal(res.total || 0);
      setPage(res.page || 1);
      setTotalPages(res.totalPages || 1);
    } catch {
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReports(1); /* eslint-disable-next-line */ }, [statusFilter, viewMode]);

  const handleSearch = (e) => { e.preventDefault(); fetchReports(1); };
  const handleStatusChange = (val) => {
    const p = new URLSearchParams(searchParams);
    if (val === 'all') p.delete('status'); else p.set('status', val);
    setSearchParams(p);
  };
  const handleDelete = async (id, title) => {
    if (!confirm(`Delete "${title}"?`)) return;
    try { await api.deleteReport(id); toast.success('Report deleted'); fetchReports(); }
    catch { toast.error('Failed to delete'); }
  };

  return (
    <div className="animate-slide-up">
      <PageHeader
        eyebrow="MY REPORTS"
        title="All reports"
        subtitle={`${total} report${total === 1 ? '' : 's'} across your workspace`}
        actions={<Btn variant="primary" icon="Plus" onClick={() => navigate('/new')}>New report</Btn>}
      />

      {/* Toggle: mine / shared */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 3, background: 'var(--ink-100)', borderRadius: 'var(--r-pill)', width: 'fit-content', marginBottom: 18 }}>
        {[
          { id: 'mine',   label: 'My reports',  icon: 'LockKeyhole' },
          { id: 'shared', label: 'Shared with me', icon: 'Users' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setViewMode(t.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 'var(--r-pill)',
              background: viewMode === t.id ? '#fff' : 'transparent',
              color: viewMode === t.id ? 'var(--ink-900)' : 'var(--ink-600)',
              boxShadow: viewMode === t.id ? 'var(--shadow-sm)' : 'none',
              fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', letterSpacing: '-0.01em',
            }}
          >
            <Icon name={t.icon} size={13} /> {t.label}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <Card padding={14} style={{ marginBottom: 18, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <form onSubmit={handleSearch} style={{ flex: 1, position: 'relative', minWidth: 240 }}>
          <Icon name="Search" size={15} color="var(--ink-400)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            className="input-field"
            style={{ paddingLeft: 36 }}
            placeholder={viewMode === 'shared' ? 'Search shared reports...' : 'Search reports...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </form>
        {viewMode === 'mine' && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {statusOpts.map(o => (
              <button
                key={o.value}
                onClick={() => handleStatusChange(o.value)}
                style={{
                  padding: '8px 14px', borderRadius: 'var(--r-pill)',
                  background: statusFilter === o.value ? 'var(--calo-50)' : 'transparent',
                  color: statusFilter === o.value ? 'var(--calo-800)' : 'var(--ink-500)',
                  border: statusFilter === o.value ? '1px solid var(--calo-100)' : '1px solid transparent',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: '-0.01em',
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, border: '3px solid var(--calo-100)', borderTopColor: 'var(--calo-500)', animation: 'spinner 1s linear infinite' }} />
        </div>
      ) : reports.length > 0 ? (
        <Card padding={0}>
          {reports.map((r, i) => (
            <div
              key={r.id}
              onClick={() => navigate(viewMode === 'shared' ? `/reports/${r.id}/preview` : `/reports/${r.id}`)}
              style={{
                padding: '16px 22px',
                borderBottom: i < reports.length - 1 ? '1px solid var(--ink-100)' : 'none',
                display: 'flex', alignItems: 'center', gap: 14,
                cursor: 'pointer', transition: 'background .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--ink-50)'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: 'var(--calo-50)',
                display: 'grid', placeItems: 'center', flexShrink: 0,
              }}>
                <Icon name="FileText" size={18} color="var(--calo-700)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.01em', color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {r.author_name && viewMode === 'shared' && <span style={{ color: 'var(--calo-700)', fontWeight: 700 }}>{r.author_name}</span>}
                  {r.description && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</span>}
                  {!r.description && r.updated_at && <span>{format(new Date(r.updated_at), 'MMM d, yyyy')}</span>}
                </div>
              </div>
              {r.visibility === 'shared' && viewMode === 'mine' && (
                <Pill tone="blue" size="sm" icon="Users">Team</Pill>
              )}
              {statusPill(r.status)}
              <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                {r.netlify_url && (
                  <a href={r.netlify_url} target="_blank" rel="noopener noreferrer" title="Open published"
                    style={{ padding: 8, color: 'var(--ink-500)', borderRadius: 8, display: 'inline-flex' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--ink-100)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <Icon name="ExternalLink" size={15} />
                  </a>
                )}
                {viewMode === 'mine' && (
                  <button onClick={() => handleDelete(r.id, r.title)} title="Delete"
                    style={{ padding: 8, color: 'var(--danger)', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'inline-flex' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#FDECEC'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <Icon name="Trash2" size={15} />
                  </button>
                )}
              </div>
              <Icon name="ChevronRight" size={16} color="var(--ink-400)" />
            </div>
          ))}
        </Card>
      ) : (
        <Card padding={48} style={{ textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, margin: '0 auto 14px', borderRadius: 16, background: 'var(--calo-50)', color: 'var(--calo-700)', display: 'grid', placeItems: 'center' }}>
            <Icon name="FileText" size={28} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink-900)' }}>
            {viewMode === 'shared' ? 'No shared reports' : 'No reports yet'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 6, marginBottom: 20 }}>
            {viewMode === 'shared' ? 'No one has shared with the team yet' : 'Drop a file or pick a template to start'}
          </div>
          {viewMode === 'mine' && <Btn variant="primary" icon="Plus" onClick={() => navigate('/new')}>New report</Btn>}
        </Card>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 18 }}>
          <button
            onClick={() => fetchReports(page - 1)}
            disabled={page <= 1}
            style={{ padding: 8, borderRadius: 8, border: '1px solid var(--ink-200)', background: '#fff', cursor: 'pointer', opacity: page <= 1 ? 0.4 : 1 }}
          ><Icon name="ChevronLeft" size={16} /></button>
          <span style={{ fontSize: 13, color: 'var(--ink-600)', fontWeight: 700 }}>Page {page} of {totalPages}</span>
          <button
            onClick={() => fetchReports(page + 1)}
            disabled={page >= totalPages}
            style={{ padding: 8, borderRadius: 8, border: '1px solid var(--ink-200)', background: '#fff', cursor: 'pointer', opacity: page >= totalPages ? 0.4 : 1 }}
          ><Icon name="ChevronRight" size={16} /></button>
        </div>
      )}
    </div>
  );
}
