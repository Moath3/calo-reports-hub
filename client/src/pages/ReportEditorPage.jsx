import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  Save, Eye, ArrowLeft, Plus, Trash2, GripVertical, ChevronDown, ChevronUp,
  Loader2, Sparkles, Send, Brain, Palette, Type, BarChart3, Table, Image,
  MessageSquare, List, AlertTriangle, Copy
} from 'lucide-react';

const BLOCK_TYPES = [
  { type: 'badge', label: 'Badge Header', icon: Type },
  { type: 'notes', label: 'Notes / Text', icon: MessageSquare },
  { type: 'metrics', label: 'Metrics Grid', icon: BarChart3 },
  { type: 'table', label: 'Data Table', icon: Table },
  { type: 'keyvalue', label: 'Key-Value List', icon: List },
  { type: 'comparison', label: 'Comparison', icon: Copy },
  { type: 'callout', label: 'Callout Box', icon: AlertTriangle },
  { type: 'image', label: 'Image', icon: Image },
];

function BlockEditor({ block, onChange, onRemove }) {
  const [open, setOpen] = useState(true);
  const typeInfo = BLOCK_TYPES.find(b => b.type === block.type) || { label: block.type, icon: Type };
  const Icon = typeInfo.icon;

  const set = (k, v) => onChange({ ...block, [k]: v });

  return (
    <div className="card border-l-4 border-l-green-400">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 cursor-pointer" onClick={() => setOpen(!open)}>
        <GripVertical className="h-4 w-4 text-gray-300 cursor-grab shrink-0" />
        <Icon className="h-4 w-4 text-green-600 shrink-0" />
        <span className="text-sm font-medium text-gray-900 flex-1 truncate">
          {block.label || block.title || typeInfo.label}
        </span>
        <span className="badge-gray text-[10px]">{block.type}</span>
        <button onClick={e => { e.stopPropagation(); onRemove(); }} className="btn-ghost p-1 text-red-400 hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </div>

      {open && (
        <div className="p-4 space-y-3">
          {/* Common fields */}
          {block.type === 'badge' && (
            <>
              <Field label="Title" value={block.title || ''} onChange={v => set('title', v)} />
              <Field label="Subtitle" value={block.subtitle || ''} onChange={v => set('subtitle', v)} />
              <Field label="Period" value={block.period || ''} onChange={v => set('period', v)} />
            </>
          )}

          {block.type === 'notes' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <div>
                <label className="label">Content (each line = bullet)</label>
                <textarea className="input-field text-sm" rows={4} value={Array.isArray(block.items) ? block.items.join('\n') : (block.text || '')}
                  onChange={e => set('items', e.target.value.split('\n'))} />
              </div>
            </>
          )}

          {block.type === 'metrics' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <div>
                <label className="label">Metrics (JSON array: {"[{label, value, change}]"})</label>
                <textarea className="input-field text-sm font-mono" rows={4}
                  value={JSON.stringify(block.items || [], null, 2)}
                  onChange={e => { try { set('items', JSON.parse(e.target.value)); } catch {} }} />
              </div>
            </>
          )}

          {block.type === 'table' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <div>
                <label className="label">Headers (comma-separated)</label>
                <input className="input-field text-sm" value={(block.headers || []).join(', ')}
                  onChange={e => set('headers', e.target.value.split(',').map(s => s.trim()))} />
              </div>
              <div>
                <label className="label">Rows (JSON 2D array)</label>
                <textarea className="input-field text-sm font-mono" rows={5}
                  value={JSON.stringify(block.rows || [], null, 2)}
                  onChange={e => { try { set('rows', JSON.parse(e.target.value)); } catch {} }} />
              </div>
            </>
          )}

          {block.type === 'keyvalue' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <div>
                <label className="label">Items (JSON: {"[{key, value}]"})</label>
                <textarea className="input-field text-sm font-mono" rows={4}
                  value={JSON.stringify(block.items || [], null, 2)}
                  onChange={e => { try { set('items', JSON.parse(e.target.value)); } catch {} }} />
              </div>
            </>
          )}

          {block.type === 'comparison' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Left Title" value={block.leftTitle || ''} onChange={v => set('leftTitle', v)} />
                <Field label="Right Title" value={block.rightTitle || ''} onChange={v => set('rightTitle', v)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Left Rows (JSON)</label>
                  <textarea className="input-field text-sm font-mono" rows={3}
                    value={JSON.stringify(block.leftRows || [], null, 2)}
                    onChange={e => { try { set('leftRows', JSON.parse(e.target.value)); } catch {} }} />
                </div>
                <div>
                  <label className="label">Right Rows (JSON)</label>
                  <textarea className="input-field text-sm font-mono" rows={3}
                    value={JSON.stringify(block.rightRows || [], null, 2)}
                    onChange={e => { try { set('rightRows', JSON.parse(e.target.value)); } catch {} }} />
                </div>
              </div>
            </>
          )}

          {block.type === 'callout' && (
            <>
              <Field label="Title" value={block.title || ''} onChange={v => set('title', v)} />
              <Field label="Value" value={block.value || ''} onChange={v => set('value', v)} />
              <div className="grid grid-cols-3 gap-3">
                <Field label="BG Color" value={block.bgColor || '#f0fdf4'} onChange={v => set('bgColor', v)} type="color" />
                <Field label="Border Color" value={block.borderColor || '#22c55e'} onChange={v => set('borderColor', v)} type="color" />
                <Field label="Text Color" value={block.textColor || '#166534'} onChange={v => set('textColor', v)} type="color" />
              </div>
            </>
          )}

          {block.type === 'image' && (
            <>
              <Field label="Image URL" value={block.url || ''} onChange={v => set('url', v)} />
              <Field label="Caption" value={block.caption || ''} onChange={v => set('caption', v)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="label">{label}</label>
      {type === 'color' ? (
        <div className="flex items-center gap-2">
          <input type="color" value={value} onChange={e => onChange(e.target.value)} className="h-9 w-9 rounded cursor-pointer" />
          <input className="input-field text-sm" value={value} onChange={e => onChange(e.target.value)} />
        </div>
      ) : (
        <input className="input-field text-sm" type={type} value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
}

export default function ReportEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('sections'); // sections, general, ai
  const [aiMsg, setAiMsg] = useState('');
  const [aiChat, setAiChat] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAddBlock, setShowAddBlock] = useState(false);

  useEffect(() => {
    api.getReport(id)
      .then(res => setReport(res.report))
      .catch(() => { toast.error('Report not found'); navigate('/reports'); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const reportData = report?.report_data || { generalInfo: {}, sections: [] };
  const sections = reportData.sections || [];

  const updateData = useCallback((fn) => {
    setReport(prev => {
      const rd = { ...(prev.report_data || { generalInfo: {}, sections: [] }) };
      fn(rd);
      return { ...prev, report_data: rd };
    });
  }, []);

  const setGeneral = (k, v) => updateData(rd => { rd.generalInfo = { ...rd.generalInfo, [k]: v }; });

  const updateSection = (sIdx, fn) => updateData(rd => {
    const s = [...rd.sections];
    fn(s, sIdx);
    rd.sections = s;
  });

  const updateBlock = (sIdx, bIdx, block) => updateSection(sIdx, (s) => {
    s[sIdx] = { ...s[sIdx], blocks: s[sIdx].blocks.map((b, i) => i === bIdx ? block : b) };
  });

  const removeBlock = (sIdx, bIdx) => updateSection(sIdx, (s) => {
    s[sIdx] = { ...s[sIdx], blocks: s[sIdx].blocks.filter((_, i) => i !== bIdx) };
  });

  const addBlock = (sIdx, type) => updateSection(sIdx, (s) => {
    const newBlock = { type };
    if (type === 'notes') newBlock.items = [''];
    if (type === 'metrics') newBlock.items = [{ label: 'Metric', value: '0' }];
    if (type === 'table') { newBlock.headers = ['Column 1']; newBlock.rows = [['']]; }
    if (type === 'keyvalue') newBlock.items = [{ key: 'Key', value: 'Value' }];
    s[sIdx] = { ...s[sIdx], blocks: [...(s[sIdx].blocks || []), newBlock] };
  });

  const addSection = () => updateData(rd => {
    rd.sections = [...(rd.sections || []), { title: 'New Section', blocks: [] }];
  });

  const removeSection = (sIdx) => {
    if (!confirm('Delete this section?')) return;
    updateData(rd => { rd.sections = rd.sections.filter((_, i) => i !== sIdx); });
  };

  const moveSection = (sIdx, dir) => updateData(rd => {
    const s = [...rd.sections];
    const target = sIdx + dir;
    if (target < 0 || target >= s.length) return;
    [s[sIdx], s[target]] = [s[target], s[sIdx]];
    rd.sections = s;
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateReport(id, {
        title: report.title,
        description: report.description,
        reportData: report.report_data,
      });
      toast.success('Saved!');
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAISend = async () => {
    if (!aiMsg.trim()) return;
    const msg = aiMsg.trim();
    setAiMsg('');
    setAiChat(prev => [...prev, { role: 'user', content: msg }]);
    setAiLoading(true);
    try {
      const res = await api.chatAI(msg, reportData, 'gemini', aiChat.slice(-6));
      setAiChat(prev => [...prev, { role: 'assistant', content: res.message }]);
      if (res.updates) {
        // Apply updates to report data
        updateData(rd => {
          if (res.updates.generalInfo) {
            rd.generalInfo = { ...rd.generalInfo, ...res.updates.generalInfo };
          }
          if (res.updates.sections) {
            res.updates.sections.forEach((su, i) => {
              if (su && rd.sections[i]) {
                rd.sections[i] = { ...rd.sections[i], ...su };
              }
            });
          }
        });
        toast.success('AI updates applied');
      }
    } catch (err) {
      setAiChat(prev => [...prev, { role: 'assistant', content: 'Error: ' + (err.message || 'AI request failed') }]);
    } finally {
      setAiLoading(false);
    }
  };

  const handleRefine = async (sIdx) => {
    const instruction = prompt('How should AI refine this section?');
    if (!instruction?.trim()) return;
    setAiLoading(true);
    try {
      const res = await api.refineSection(reportData, sIdx, instruction, 'gemini');
      if (res.section) {
        updateSection(sIdx, (s) => { s[sIdx] = res.section; });
        toast.success('Section refined');
      }
    } catch (err) {
      toast.error(err.message || 'Refine failed');
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-green-600" /></div>;
  }

  if (!report) return null;

  return (
    <div className="space-y-4 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button onClick={() => navigate('/reports')} className="btn-ghost p-2 self-start">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <input
            className="text-xl font-bold text-gray-900 bg-transparent border-none outline-none w-full placeholder:text-gray-300 focus:ring-0"
            value={report.title || ''}
            onChange={e => setReport(prev => ({ ...prev, title: e.target.value }))}
            placeholder="Report title..."
          />
          <input
            className="text-sm text-gray-500 bg-transparent border-none outline-none w-full placeholder:text-gray-300 focus:ring-0 mt-0.5"
            value={report.description || ''}
            onChange={e => setReport(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Description..."
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => navigate(`/reports/${id}/preview`)} className="btn-secondary flex items-center gap-2">
            <Eye className="h-4 w-4" /> Preview
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: 'sections', label: 'Sections', icon: List },
          { key: 'general', label: 'General Info', icon: Palette },
          { key: 'ai', label: 'AI Assistant', icon: Brain },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-green-500 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Sections tab */}
      {tab === 'sections' && (
        <div className="space-y-4">
          {sections.map((section, sIdx) => (
            <div key={sIdx} className="card">
              <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 rounded-t-xl border-b border-gray-100">
                <input
                  className="flex-1 font-semibold text-gray-900 bg-transparent border-none outline-none"
                  value={section.title || ''}
                  onChange={e => updateSection(sIdx, s => { s[sIdx] = { ...s[sIdx], title: e.target.value }; })}
                  placeholder="Section title..."
                />
                <button onClick={() => handleRefine(sIdx)} className="btn-ghost p-1.5 text-purple-600" title="AI Refine" disabled={aiLoading}>
                  <Sparkles className="h-4 w-4" />
                </button>
                <button onClick={() => moveSection(sIdx, -1)} disabled={sIdx === 0} className="btn-ghost p-1.5 disabled:opacity-30">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button onClick={() => moveSection(sIdx, 1)} disabled={sIdx === sections.length - 1} className="btn-ghost p-1.5 disabled:opacity-30">
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button onClick={() => removeSection(sIdx)} className="btn-ghost p-1.5 text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                {(section.blocks || []).map((block, bIdx) => (
                  <BlockEditor
                    key={bIdx}
                    block={block}
                    onChange={b => updateBlock(sIdx, bIdx, b)}
                    onRemove={() => removeBlock(sIdx, bIdx)}
                  />
                ))}

                {/* Add block */}
                <div className="relative">
                  <button
                    onClick={() => setShowAddBlock(showAddBlock === sIdx ? false : sIdx)}
                    className="btn-secondary w-full flex items-center justify-center gap-2 border-dashed"
                  >
                    <Plus className="h-4 w-4" /> Add Block
                  </button>
                  {showAddBlock === sIdx && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg border border-gray-200 shadow-lg py-2 z-20 grid grid-cols-2 gap-1 p-2">
                      {BLOCK_TYPES.map(bt => (
                        <button
                          key={bt.type}
                          onClick={() => { addBlock(sIdx, bt.type); setShowAddBlock(false); }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm text-left"
                        >
                          <bt.icon className="h-4 w-4 text-green-600 shrink-0" />
                          {bt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          <button onClick={addSection} className="btn-secondary w-full flex items-center justify-center gap-2 py-4 border-dashed">
            <Plus className="h-5 w-5" /> Add Section
          </button>
        </div>
      )}

      {/* General info tab */}
      {tab === 'general' && (
        <div className="card p-6 space-y-4 max-w-2xl">
          <h3 className="font-semibold text-gray-900">General Information</h3>
          <Field label="Report Title" value={reportData.generalInfo?.title || ''} onChange={v => setGeneral('title', v)} />
          <Field label="Report Date" value={reportData.generalInfo?.reportDate || ''} onChange={v => setGeneral('reportDate', v)} />
          <Field label="Company Name" value={reportData.generalInfo?.companyName || ''} onChange={v => setGeneral('companyName', v)} />
          <Field label="Period Note" value={reportData.generalInfo?.prevMonth || ''} onChange={v => setGeneral('prevMonth', v)} />
          <div>
            <label className="label">Brand Color</label>
            <div className="flex items-center gap-3">
              <input type="color" value={reportData.generalInfo?.brandColor || '#22c55e'}
                onChange={e => setGeneral('brandColor', e.target.value)} className="h-10 w-10 rounded cursor-pointer" />
              <input className="input-field text-sm" value={reportData.generalInfo?.brandColor || '#22c55e'}
                onChange={e => setGeneral('brandColor', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">KPI Strip (JSON array)</label>
            <textarea className="input-field text-sm font-mono" rows={4}
              value={JSON.stringify(reportData.generalInfo?.kpiStrip || [], null, 2)}
              onChange={e => { try { setGeneral('kpiStrip', JSON.parse(e.target.value)); } catch {} }} />
          </div>
        </div>
      )}

      {/* AI Assistant tab */}
      {tab === 'ai' && (
        <div className="card flex flex-col" style={{ height: 'calc(100vh - 300px)', minHeight: '400px' }}>
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-600" />
            <span className="font-semibold text-gray-900">AI Assistant</span>
            <span className="text-xs text-gray-400 ml-2">Ask AI to modify your report</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {aiChat.length === 0 && (
              <div className="text-center text-sm text-gray-400 py-8">
                <Brain className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                Ask the AI to help edit your report sections, add content, or restructure data.
              </div>
            )}
            {aiChat.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  msg.role === 'user' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-800'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {aiLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-xl px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                </div>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="px-4 py-2 border-t border-gray-100 flex gap-2 flex-wrap">
            {['Improve all sections', 'Add executive summary', 'Fix formatting', 'Add comparison data'].map(q => (
              <button key={q} onClick={() => { setAiMsg(q); }} className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200">
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-200">
            <form onSubmit={e => { e.preventDefault(); handleAISend(); }} className="flex gap-2">
              <input
                className="input-field flex-1"
                placeholder="Ask AI to modify your report..."
                value={aiMsg}
                onChange={e => setAiMsg(e.target.value)}
                disabled={aiLoading}
              />
              <button type="submit" disabled={aiLoading || !aiMsg.trim()} className="btn-primary px-4">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
