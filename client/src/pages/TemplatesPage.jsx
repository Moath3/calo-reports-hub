import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  BookTemplate, Plus, Trash2, Edit, Loader2, Copy,
  Search, Tag, Users, User, Download
} from 'lucide-react';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, mine
  const [categories, setCategories] = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', description: '', category: 'general' });
  const [saving, setSaving] = useState(false);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter === 'mine') params.mine = 'true';
      if (catFilter) params.category = catFilter;
      const res = await api.getTemplates(params);
      setTemplates(res.templates || []);
    } catch {
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.getTemplateCategories();
      setCategories(res.categories || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchTemplates(); fetchCategories(); }, [filter, catFilter]);

  const filtered = search.trim()
    ? templates.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || (t.description || '').toLowerCase().includes(search.toLowerCase()))
    : templates;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newForm.name.trim()) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      await api.createTemplate({
        name: newForm.name.trim(),
        description: newForm.description.trim(),
        category: newForm.category,
        templateData: { generalInfo: { title: '', brandColor: '#02B376' }, sections: [] },
        isShared: true,
      });
      toast.success('Template created');
      setShowNew(false);
      setNewForm({ name: '', description: '', category: 'general' });
      fetchTemplates();
    } catch (err) {
      toast.error(err.message || 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const handleUse = async (t) => {
    try {
      const res = await api.useTemplate(t.id);
      // Create a new report from template
      const tData = res.template?.template_data || t.template_data || {};
      const createRes = await api.createReport({
        title: `${t.name} - ${format(new Date(), 'MMM d, yyyy')}`,
        description: `Created from template: ${t.name}`,
        reportData: tData,
        tags: ['from-template'],
      });
      toast.success('Report created from template');
      navigate(`/reports/${createRes.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to use template');
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    try {
      await api.deleteTemplate(id);
      toast.success('Deleted');
      fetchTemplates();
    } catch {
      toast.error('Failed to delete');
    }
  };

  return (
    <div className="space-y-5 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Reusable report structures</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 shrink-0">
          <Plus className="h-4 w-4" /> New Template
        </button>
      </div>

      {/* New template modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowNew(false)}>
          <div className="card p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">Create Template</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="label">Name</label>
                <input className="input-field" value={newForm.name} onChange={e => setNewForm(p => ({...p, name: e.target.value}))} placeholder="Weekly Growth Report" required />
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input-field" value={newForm.category} onChange={e => setNewForm(p => ({...p, category: e.target.value}))}>
                  <option value="general">General</option>
                  <option value="hr">HR</option>
                  <option value="production">Production</option>
                  <option value="finance">Finance</option>
                  <option value="marketing">Marketing</option>
                </select>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input-field" rows={2} value={newForm.description} onChange={e => setNewForm(p => ({...p, description: e.target.value}))} placeholder="Optional description" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Creating...' : 'Create'}
                </button>
                <button type="button" onClick={() => setShowNew(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input className="input-field pl-10" placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === 'all' ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-100'}`}>
            <Users className="h-3.5 w-3.5 inline mr-1" /> All
          </button>
          <button onClick={() => setFilter('mine')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === 'mine' ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-100'}`}>
            <User className="h-3.5 w-3.5 inline mr-1" /> Mine
          </button>
          {categories.length > 0 && (
            <select className="input-field py-1.5 text-sm w-auto" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Templates grid */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(t => (
            <div key={t.id} className="card-hover p-5 flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <div className="h-10 w-10 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                  <BookTemplate className="h-5 w-5 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 text-sm truncate">{t.name}</h3>
                  {t.author_name && <p className="text-xs text-gray-400">by {t.author_name}</p>}
                </div>
              </div>
              {t.description && <p className="text-xs text-gray-500 line-clamp-2 mb-3">{t.description}</p>}
              <div className="flex items-center gap-2 mb-3">
                <span className="badge-blue"><Tag className="h-3 w-3 inline mr-1" />{t.category || 'general'}</span>
                {t.usage_count > 0 && <span className="badge-gray"><Download className="h-3 w-3 inline mr-1" />{t.usage_count} uses</span>}
              </div>
              <div className="mt-auto pt-3 border-t border-gray-100 flex gap-2">
                <button onClick={() => handleUse(t)} className="btn-primary text-xs py-1.5 px-3 flex-1">
                  Use Template
                </button>
                <button onClick={() => handleDelete(t.id, t.name)} className="btn-ghost p-1.5 text-red-400 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <BookTemplate className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900">No templates found</h3>
          <p className="text-sm text-gray-500 mt-1">Create a template to reuse report structures</p>
          <button onClick={() => setShowNew(true)} className="btn-primary mt-4">Create Template</button>
        </div>
      )}
    </div>
  );
}
