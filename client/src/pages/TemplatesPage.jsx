import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Card, Pill, Btn, Icon, PageHeader, LabeledInput } from '../components/ui';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
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
    } catch { toast.error('Failed to load templates'); }
    finally { setLoading(false); }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.getTemplateCategories();
      setCategories(res.categories || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchTemplates(); fetchCategories(); /* eslint-disable-next-line */ }, [filter, catFilter]);

  const filtered = search.trim()
    ? templates.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(search.toLowerCase())
      )
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
    } catch (err) { toast.error(err.message || 'Failed to create'); }
    finally { setSaving(false); }
  };

  const handleUse = async (t) => {
    try {
      const res = await api.useTemplate(t.id);
      const tData = res.template?.template_data || t.template_data || {};
      const createRes = await api.createReport({
        title: `${t.name} - ${format(new Date(), 'MMM d, yyyy')}`,
        description: `Created from template: ${t.name}`,
        reportData: tData,
        tags: ['from-template'],
      });
      toast.success('Report created from template');
      navigate(`/reports/${createRes.id}`);
    } catch (err) { toast.error(err.message || 'Failed to use template'); }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    try { await api.deleteTemplate(id); toast.success('Deleted'); fetchTemplates(); }
    catch { toast.error('Failed to delete'); }
  };

  return (
    <div className="animate-slide-up">
      <PageHeader
        eyebrow="TEMPLATES"
        title="Start from a template"
        subtitle="Pre-built structures that get you to a finished report fast."
        actions={<Btn variant="primary" icon="Plus" onClick={() => setShowNew(true)}>New template</Btn>}
      />

      {/* New template modal */}
      {showNew && (
        <div
          onClick={() => setShowNew(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(10,31,23,.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <Card
            onClick={e => e.stopPropagation()}
            padding={28}
            style={{ width: '100%', maxWidth: 460 }}
          >
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', marginBottom: 4 }}>New template</div>
            <div style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 18 }}>Give it a name and category.</div>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <LabeledInput label="Name" value={newForm.name} onChange={v => setNewForm(p => ({ ...p, name: v }))} placeholder="Weekly Growth Report" />
              <div>
                <label className="label">Category</label>
                <select
                  value={newForm.category}
                  onChange={e => setNewForm(p => ({ ...p, category: e.target.value }))}
                  className="input-field"
                >
                  <option value="general">General</option>
                  <option value="hr">HR</option>
                  <option value="production">Production</option>
                  <option value="finance">Finance</option>
                  <option value="marketing">Marketing</option>
                  <option value="logistics">Logistics</option>
                </select>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea
                  value={newForm.description}
                  onChange={e => setNewForm(p => ({ ...p, description: e.target.value }))}
                  className="input-field"
                  rows={3}
                  placeholder="What's this template for?"
                />
              </div>
              <div style={{ display: 'flex', gap: 8, paddingTop: 6 }}>
                <Btn type="submit" variant="primary" disabled={saving} full>{saving ? 'Creating…' : 'Create template'}</Btn>
                <Btn variant="secondary" onClick={() => setShowNew(false)}>Cancel</Btn>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card padding={14} style={{ marginBottom: 18, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 220 }}>
          <Icon name="Search" size={15} color="var(--ink-400)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            className="input-field"
            style={{ paddingLeft: 36 }}
            placeholder="Search templates..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[{ k: 'all', l: 'All', i: 'Users' }, { k: 'mine', l: 'Mine', i: 'User' }].map(f => (
            <button
              key={f.k}
              onClick={() => setFilter(f.k)}
              style={{
                padding: '8px 14px', borderRadius: 'var(--r-pill)',
                background: filter === f.k ? 'var(--calo-50)' : 'transparent',
                color: filter === f.k ? 'var(--calo-800)' : 'var(--ink-500)',
                border: filter === f.k ? '1px solid var(--calo-100)' : '1px solid transparent',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Icon name={f.i} size={13} /> {f.l}
            </button>
          ))}
        </div>
        {categories.length > 0 && (
          <select
            className="input-field"
            style={{ width: 'auto', padding: '8px 14px' }}
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </Card>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, border: '3px solid var(--calo-100)', borderTopColor: 'var(--calo-500)', animation: 'spinner 1s linear infinite' }} />
        </div>
      ) : filtered.length > 0 ? (
        <div className="tmpl-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
          {filtered.map(t => {
            const sections = (t.template_data?.sections?.length) || 0;
            return (
              <Card key={t.id} hover padding={20} onClick={() => handleUse(t)}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--calo-50)', display: 'grid', placeItems: 'center', marginBottom: 14 }}>
                  <Icon name="LayoutTemplate" size={18} color="var(--calo-700)" />
                </div>
                <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-0.02em', color: 'var(--ink-900)' }}>{t.name}</div>
                {t.author_name && <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>by {t.author_name}</div>}
                {t.description && <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 6, lineHeight: 1.5, minHeight: 39, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.description}</div>}
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Pill tone="neutral" size="sm">{sections} section{sections === 1 ? '' : 's'}</Pill>
                    {t.category && <Pill tone="green" size="sm">{t.category}</Pill>}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--calo-700)' }}>Use →</span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card padding={48} style={{ textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, margin: '0 auto 14px', borderRadius: 16, background: 'var(--calo-50)', color: 'var(--calo-700)', display: 'grid', placeItems: 'center' }}>
            <Icon name="LayoutTemplate" size={28} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>No templates found</div>
          <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 6, marginBottom: 20 }}>Create a template to reuse report structures</div>
          <Btn variant="primary" icon="Plus" onClick={() => setShowNew(true)}>New template</Btn>
        </Card>
      )}

      <style>{`
        @media (max-width: 1023px) {
          .tmpl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 639px) {
          .tmpl-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
