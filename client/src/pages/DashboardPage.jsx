import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  FileText, FilePlus, BookTemplate, Brain,
  TrendingUp, Clock, Users, ArrowRight, Loader2
} from 'lucide-react';

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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  const cards = [
    { label: 'Total Reports', value: stats?.totalReports ?? 0, icon: FileText, color: 'bg-blue-50 text-blue-600', to: '/reports' },
    { label: 'Drafts', value: stats?.draftReports ?? 0, icon: Clock, color: 'bg-amber-50 text-amber-600', to: '/reports?status=draft' },
    { label: 'Published', value: stats?.publishedReports ?? 0, icon: TrendingUp, color: 'bg-green-50 text-green-600', to: '/reports?status=published' },
    { label: 'Templates', value: stats?.totalTemplates ?? 0, icon: BookTemplate, color: 'bg-purple-50 text-purple-600', to: '/templates' },
  ];

  return (
    <div className="space-y-6 animate-in">
      {/* Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.name?.split(' ')[0]}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Here&apos;s your report overview</p>
        </div>
        <button onClick={() => navigate('/new')} className="btn-primary flex items-center gap-2 shrink-0">
          <FilePlus className="h-4 w-4" /> New Report
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <button key={c.label} onClick={() => navigate(c.to)} className="card-hover p-5 text-left">
            <div className={`h-10 w-10 rounded-lg ${c.color} flex items-center justify-center mb-3`}>
              <c.icon className="h-5 w-5" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{c.value}</div>
            <div className="text-sm text-gray-500 mt-0.5">{c.label}</div>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent reports */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Reports</h2>
            <button onClick={() => navigate('/reports')} className="text-sm text-green-600 hover:text-green-700 font-medium flex items-center gap-1">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {stats?.recentReports?.length > 0 ? stats.recentReports.map(r => (
              <button
                key={r.id}
                onClick={() => navigate(`/reports/${r.id}`)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">{r.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {r.updated_at ? format(new Date(r.updated_at), 'MMM d, yyyy') : ''}
                  </div>
                </div>
                <span className={`ml-3 shrink-0 ${r.status === 'published' ? 'badge-green' : r.status === 'draft' ? 'badge-amber' : 'badge-gray'}`}>
                  {r.status}
                </span>
              </button>
            )) : (
              <div className="px-5 py-10 text-center text-sm text-gray-400">
                No reports yet. Create your first report!
              </div>
            )}
          </div>
        </div>

        {/* Quick actions & AI usage */}
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <button onClick={() => navigate('/new')} className="w-full btn-secondary text-left flex items-center gap-3 py-3">
                <FilePlus className="h-4 w-4 text-green-600" /> Create New Report
              </button>
              <button onClick={() => navigate('/templates')} className="w-full btn-secondary text-left flex items-center gap-3 py-3">
                <BookTemplate className="h-4 w-4 text-purple-600" /> Browse Templates
              </button>
              <button onClick={() => navigate('/reports')} className="w-full btn-secondary text-left flex items-center gap-3 py-3">
                <FileText className="h-4 w-4 text-blue-600" /> View All Reports
              </button>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">AI Usage</h3>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                <Brain className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <div className="text-xl font-bold text-gray-900">{stats?.aiUsage?.total ?? 0}</div>
                <div className="text-xs text-gray-500">Total AI requests</div>
              </div>
            </div>
            {stats?.aiUsage?.byProvider && Object.keys(stats.aiUsage.byProvider).length > 0 && (
              <div className="space-y-1.5 mt-3 pt-3 border-t border-gray-100">
                {Object.entries(stats.aiUsage.byProvider).map(([p, c]) => (
                  <div key={p} className="flex justify-between text-sm">
                    <span className="text-gray-500 capitalize">{p}</span>
                    <span className="font-medium text-gray-900">{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Admin stats */}
          {user?.role === 'admin' && stats?.totalUsers != null && (
            <div className="card p-5">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" /> Admin Overview
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total Users</span>
                  <span className="font-medium">{stats.totalUsers}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Active Users</span>
                  <span className="font-medium">{stats.activeUsers}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">All Reports</span>
                  <span className="font-medium">{stats.companyReports}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Company AI Calls</span>
                  <span className="font-medium">{stats.companyAiUsage}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
