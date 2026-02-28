import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  Search, Filter, FileText, Plus, Trash2, ExternalLink,
  Loader2, ChevronLeft, ChevronRight, Eye, Users, LockKeyhole
} from 'lucide-react';

const statusOpts = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

export default function ReportsListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [viewMode, setViewMode] = useState('mine'); // 'mine' or 'shared'

  const statusFilter = searchParams.get('status') || 'all';
  const [search, setSearch] = useState(searchParams.get('search') || '');

  const fetchReports = async (pg = page) => {
    setLoading(true);
    try {
      const params = { page: pg, limit: 12 };
      if (viewMode === 'shared') {
        params.visibility = 'shared';
      } else {
        if (statusFilter !== 'all') params.status = statusFilter;
      }
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

  useEffect(() => { fetchReports(1); }, [statusFilter, viewMode]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchReports(1);
  };

  const handleStatusChange = (val) => {
    const p = new URLSearchParams(searchParams);
    if (val === 'all') p.delete('status');
    else p.set('status', val);
    setSearchParams(p);
  };

  const handleDelete = async (id, title) => {
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      await api.deleteReport(id);
      toast.success('Report deleted');
      fetchReports();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const statusBadge = (s) => {
    const m = { draft: 'badge-amber', published: 'badge-green', archived: 'badge-gray' };
    return m[s] || 'badge-gray';
  };

  return (
    <div className="space-y-5 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} report{total !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => navigate('/new')} className="btn-primary flex items-center gap-2 shrink-0">
          <Plus className="h-4 w-4" /> New Report
        </button>
      </div>

      {/* View mode tabs: My Reports / Shared */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setViewMode('mine')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            viewMode === 'mine' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <LockKeyhole className="h-3.5 w-3.5" /> My Reports
        </button>
        <button
          onClick={() => setViewMode('shared')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            viewMode === 'shared' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="h-3.5 w-3.5" /> Shared with me
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="input-field pl-10"
            placeholder={viewMode === 'shared' ? 'Search shared reports...' : 'Search reports...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </form>
        {viewMode === 'mine' && (
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400 shrink-0" />
            {statusOpts.map(o => (
              <button
                key={o.value}
                onClick={() => handleStatusChange(o.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === o.value ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Reports grid */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      ) : reports.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map(r => (
            <div key={r.id} className="card-hover p-5 flex flex-col" onClick={() => navigate(viewMode === 'shared' ? `/reports/${r.id}/preview` : `/reports/${r.id}`)}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex items-center gap-1.5">
                  {r.visibility === 'shared' && viewMode === 'mine' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
                      <Users className="h-3 w-3" />
                    </span>
                  )}
                  <span className={statusBadge(r.status)}>{r.status}</span>
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1">{r.title}</h3>
              {r.author_name && viewMode === 'shared' && (
                <p className="text-xs text-blue-600 font-medium mb-1">by {r.author_name}</p>
              )}
              {r.description && <p className="text-xs text-gray-500 line-clamp-2 mb-3">{r.description}</p>}
              <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {r.updated_at ? format(new Date(r.updated_at), 'MMM d, yyyy') : ''}
                </span>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  {r.netlify_url && (
                    <a href={r.netlify_url} target="_blank" rel="noopener noreferrer" className="btn-ghost p-1.5" title="View published">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button onClick={() => navigate(`/reports/${r.id}/preview`)} className="btn-ghost p-1.5" title="Preview">
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  {viewMode === 'mine' && (
                    <button onClick={() => handleDelete(r.id, r.title)} className="btn-ghost p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900">
            {viewMode === 'shared' ? 'No shared reports' : 'No reports found'}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {viewMode === 'shared' ? 'No one has shared reports with the team yet' : 'Create your first report to get started'}
          </p>
          {viewMode === 'mine' && (
            <button onClick={() => navigate('/new')} className="btn-primary mt-4">Create Report</button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => fetchReports(page - 1)}
            disabled={page <= 1}
            className="btn-ghost p-2 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => fetchReports(page + 1)}
            disabled={page >= totalPages}
            className="btn-ghost p-2 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
