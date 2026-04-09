import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  Save, Eye, ArrowLeft, Plus, Trash2, GripVertical, ChevronDown, ChevronUp,
  Loader2, Sparkles, Send, Brain, Palette, Type, BarChart3, Table, Image,
  MessageSquare, List, AlertTriangle, Copy, Paperclip, ClipboardPaste, CheckCircle2,
  Link2, Upload, ArrowUp, ArrowDown
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
  { type: 'link', label: 'Link', icon: Link2 },
];

/* ============ Visual Sub-Editors (no JSON exposed) ============ */

function MetricsEditor({ items, onChange }) {
  const update = (i, field, val) => {
    const next = [...(items || [])];
    next[i] = { ...next[i], [field]: val };
    onChange(next);
  };
  const remove = (i) => onChange((items || []).filter((_, j) => j !== i));
  const add = () => onChange([...(items || []), { label: '', value: '', change: '', trend: 'stable' }]);
  return (
    <div>
      <div className="space-y-2">
        {(items || []).map((m, i) => (
          <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
            <input className="input-field text-sm flex-1 py-1.5" placeholder="Label" value={m.label || ''}
              onChange={e => update(i, 'label', e.target.value)} />
            <input className="input-field text-sm w-20 py-1.5" placeholder="Value" value={m.value || ''}
              onChange={e => update(i, 'value', e.target.value)} />
            <input className="input-field text-sm w-20 py-1.5" placeholder="+5%" value={m.change || ''}
              onChange={e => update(i, 'change', e.target.value)} />
            <select className="input-field text-sm w-24 py-1.5" value={m.trend || 'stable'}
              onChange={e => update(i, 'trend', e.target.value)}>
              <option value="up">↑ Up</option>
              <option value="down">↓ Down</option>
              <option value="stable">→ Stable</option>
            </select>
            <button onClick={() => remove(i)} className="btn-ghost p-1 text-red-400 hover:text-red-600 shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className="mt-2 text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1">
        <Plus className="h-3 w-3" /> Add Metric
      </button>
    </div>
  );
}

function TableEditor({ headers, rows, onChange }) {
  const updateHeader = (ci, val) => {
    const h = [...(headers || [])]; h[ci] = val;
    onChange({ headers: h, rows });
  };
  const updateCell = (ri, ci, val) => {
    const r = (rows || []).map(row => [...row]); r[ri][ci] = val;
    onChange({ headers, rows: r });
  };
  const addRow = () => onChange({ headers, rows: [...(rows || []), new Array((headers || []).length).fill('')] });
  const removeRow = (ri) => onChange({ headers, rows: (rows || []).filter((_, j) => j !== ri) });
  const addCol = () => onChange({ headers: [...(headers || []), 'Column'], rows: (rows || []).map(r => [...r, '']) });
  const removeCol = (ci) => onChange({
    headers: (headers || []).filter((_, j) => j !== ci),
    rows: (rows || []).map(r => r.filter((_, j) => j !== ci))
  });

  return (
    <div>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              {(headers || []).map((h, ci) => (
                <th key={ci} className="p-1.5 border-b border-r border-gray-200">
                  <div className="flex items-center gap-1">
                    <input className="w-full text-xs font-semibold py-1 px-2 border-0 bg-transparent focus:ring-1 focus:ring-green-500 rounded"
                      value={h} onChange={e => updateHeader(ci, e.target.value)} placeholder="Header" />
                    {(headers || []).length > 1 && (
                      <button onClick={() => removeCol(ci)} className="text-red-400 hover:text-red-600 shrink-0"><Trash2 className="h-3 w-3" /></button>
                    )}
                  </div>
                </th>
              ))}
              <th className="p-1.5 border-b border-gray-200 w-16">
                <button onClick={addCol} className="text-green-600 hover:text-green-700 text-xs font-medium">+ Col</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row, ri) => (
              <tr key={ri} className="hover:bg-gray-50/50">
                {row.map((cell, ci) => (
                  <td key={ci} className="p-1 border-b border-r border-gray-100">
                    <input className="w-full text-xs py-1 px-2 border-0 bg-transparent focus:ring-1 focus:ring-green-500 rounded"
                      value={cell} onChange={e => updateCell(ri, ci, e.target.value)} />
                  </td>
                ))}
                <td className="p-1 border-b border-gray-100 text-center">
                  <button onClick={() => removeRow(ri)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={addRow} className="mt-2 text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1">
        <Plus className="h-3 w-3" /> Add Row
      </button>
    </div>
  );
}

function KeyValueEditor({ items, onChange }) {
  const update = (i, field, val) => {
    const next = [...(items || [])]; next[i] = { ...next[i], [field]: val }; onChange(next);
  };
  const remove = (i) => onChange((items || []).filter((_, j) => j !== i));
  const add = () => onChange([...(items || []), { key: '', value: '' }]);
  return (
    <div>
      <div className="space-y-2">
        {(items || []).map((kv, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="input-field text-sm flex-1 py-1.5" placeholder="Key" value={kv.key || ''}
              onChange={e => update(i, 'key', e.target.value)} />
            <span className="text-gray-400 font-medium">:</span>
            <input className="input-field text-sm flex-1 py-1.5" placeholder="Value" value={kv.value || ''}
              onChange={e => update(i, 'value', e.target.value)} />
            <button onClick={() => remove(i)} className="btn-ghost p-1 text-red-400 hover:text-red-600 shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className="mt-2 text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1">
        <Plus className="h-3 w-3" /> Add Item
      </button>
    </div>
  );
}

function ComparisonEditor({ block, onChange }) {
  const leftRows = block.leftRows || [];
  const rightRows = block.rightRows || [];
  const rowCount = Math.max(leftRows.length, rightRows.length);

  const updateRow = (side, i, field, val) => {
    const key = side === 'left' ? 'leftRows' : 'rightRows';
    const arr = [...(block[key] || [])];
    while (arr.length <= i) arr.push({ key: '', value: '' });
    arr[i] = { ...arr[i], [field]: val };
    onChange({ ...block, [key]: arr });
  };
  const removeRow = (i) => onChange({ ...block, leftRows: leftRows.filter((_, j) => j !== i), rightRows: rightRows.filter((_, j) => j !== i) });
  const addRow = () => onChange({ ...block, leftRows: [...leftRows, { key: '', value: '' }], rightRows: [...rightRows, { key: '', value: '' }] });

  return (
    <div>
      <div className="space-y-2">
        {Array.from({ length: rowCount }).map((_, i) => {
          const lr = leftRows[i] || { key: '', value: '' };
          const rr = rightRows[i] || { key: '', value: '' };
          return (
            <div key={i} className="flex items-center gap-1 bg-gray-50 rounded-lg p-2">
              <input className="input-field text-xs flex-1 py-1" placeholder="Key" value={lr.key || ''}
                onChange={e => updateRow('left', i, 'key', e.target.value)} />
              <input className="input-field text-xs w-16 py-1" placeholder="Val" value={lr.value || ''}
                onChange={e => updateRow('left', i, 'value', e.target.value)} />
              <span className="text-gray-300 text-xs px-1">│</span>
              <input className="input-field text-xs flex-1 py-1" placeholder="Key" value={rr.key || ''}
                onChange={e => updateRow('right', i, 'key', e.target.value)} />
              <input className="input-field text-xs w-16 py-1" placeholder="Val" value={rr.value || ''}
                onChange={e => updateRow('right', i, 'value', e.target.value)} />
              <button onClick={() => removeRow(i)} className="btn-ghost p-1 text-red-400 hover:text-red-600 shrink-0">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button onClick={addRow} className="mt-2 text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1">
        <Plus className="h-3 w-3" /> Add Row
      </button>
    </div>
  );
}

function KpiStripEditor({ kpis, onChange }) {
  const update = (i, field, val) => {
    const next = [...(kpis || [])]; next[i] = { ...next[i], [field]: val }; onChange(next);
  };
  const remove = (i) => onChange((kpis || []).filter((_, j) => j !== i));
  const add = () => onChange([...(kpis || []), { label: '', value: '', unit: '', trend: 'stable' }]);
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(kpis || []).map((kpi, i) => (
          <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 relative">
            <button onClick={() => remove(i)} className="absolute top-2 right-2 btn-ghost p-1 text-red-400 hover:text-red-600">
              <Trash2 className="h-3 w-3" />
            </button>
            <input className="input-field text-sm py-1.5" placeholder="Label (e.g. Total KSA)" value={kpi.label || ''}
              onChange={e => update(i, 'label', e.target.value)} />
            <div className="flex gap-2">
              <input className="input-field text-sm py-1.5 flex-1" placeholder="Value" value={kpi.value || ''}
                onChange={e => update(i, 'value', e.target.value)} />
              <input className="input-field text-sm py-1.5 w-20" placeholder="Unit" value={kpi.unit || ''}
                onChange={e => update(i, 'unit', e.target.value)} />
              <select className="input-field text-sm py-1.5 w-24" value={kpi.trend || 'stable'}
                onChange={e => update(i, 'trend', e.target.value)}>
                <option value="up">↑ Up</option>
                <option value="down">↓ Down</option>
                <option value="stable">→ Stable</option>
              </select>
            </div>
          </div>
        ))}
      </div>
      <button onClick={add} className="mt-3 text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1">
        <Plus className="h-3 w-3" /> Add KPI
      </button>
    </div>
  );
}

/* ============ Block Editor ============ */

function BlockEditor({ block, onChange, onRemove, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [open, setOpen] = useState(true);
  const typeInfo = BLOCK_TYPES.find(b => b.type === block.type) || { label: block.type, icon: Type };
  const Icon = typeInfo.icon;
  const set = (k, v) => onChange({ ...block, [k]: v });

  return (
    <div className="card border-l-4 border-l-green-400">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 cursor-pointer" onClick={() => setOpen(!open)}>
        <GripVertical className="h-4 w-4 text-gray-300 cursor-grab shrink-0" />
        <Icon className="h-4 w-4 text-green-600 shrink-0" />
        <span className="text-sm font-medium text-gray-900 flex-1 truncate">{block.label || block.title || typeInfo.label}</span>
        <span className="badge-gray text-[10px]">{block.type}</span>
        <button onClick={e => { e.stopPropagation(); onMoveUp?.(); }} disabled={isFirst} className="btn-ghost p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="Move up">
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button onClick={e => { e.stopPropagation(); onMoveDown?.(); }} disabled={isLast} className="btn-ghost p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="Move down">
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button onClick={e => { e.stopPropagation(); onRemove(); }} className="btn-ghost p-1 text-red-400 hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </div>
      {open && (
        <div className="p-4 space-y-3">
          {block.type === 'badge' && (
            <>
              <Field label="Title" value={block.title || ''} onChange={v => set('title', v)} />
              <Field label="Subtitle" value={block.subtitle || ''} onChange={v => set('subtitle', v)} />
              <Field label="Period" value={block.period || ''} onChange={v => set('period', v)} />
              <div>
                <label className="label">Style</label>
                <select className="input-field text-sm" value={block.style || 'green'} onChange={e => set('style', e.target.value)}>
                  <option value="green">Green</option><option value="blue">Blue</option>
                  <option value="amber">Amber</option><option value="red">Red</option>
                </select>
              </div>
            </>
          )}
          {block.type === 'notes' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <div>
                <label className="label">Content (each line = bullet point)</label>
                <textarea className="input-field text-sm" rows={4}
                  value={Array.isArray(block.items) ? block.items.join('\n') : (block.text || '')}
                  onChange={e => set('items', e.target.value.split('\n'))} />
              </div>
            </>
          )}
          {block.type === 'metrics' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <label className="label">Metrics</label>
              <MetricsEditor items={block.items || []} onChange={v => set('items', v)} />
            </>
          )}
          {block.type === 'table' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <label className="label">Table Data</label>
              <TableEditor headers={block.headers || []} rows={block.rows || []}
                onChange={({ headers, rows }) => onChange({ ...block, headers, rows })} />
            </>
          )}
          {block.type === 'keyvalue' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <label className="label">Items</label>
              <KeyValueEditor items={block.items || []} onChange={v => set('items', v)} />
            </>
          )}
          {block.type === 'comparison' && (
            <>
              <Field label="Label" value={block.label || ''} onChange={v => set('label', v)} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Left Title" value={block.leftTitle || ''} onChange={v => set('leftTitle', v)} />
                <Field label="Right Title" value={block.rightTitle || ''} onChange={v => set('rightTitle', v)} />
              </div>
              <label className="label">Comparison Rows</label>
              <ComparisonEditor block={block} onChange={onChange} />
            </>
          )}
          {block.type === 'callout' && (
            <>
              <Field label="Title" value={block.title || ''} onChange={v => set('title', v)} />
              <Field label="Value" value={block.value || ''} onChange={v => set('value', v)} />
              <Field label="Icon" value={block.icon || ''} onChange={v => set('icon', v)} />
              <div className="grid grid-cols-3 gap-3">
                <Field label="BG Color" value={block.bgColor || '#f0fdf4'} onChange={v => set('bgColor', v)} type="color" />
                <Field label="Border" value={block.borderColor || '#02B376'} onChange={v => set('borderColor', v)} type="color" />
                <Field label="Text" value={block.textColor || '#166534'} onChange={v => set('textColor', v)} type="color" />
              </div>
            </>
          )}
          {block.type === 'image' && (
            <>
              <Field label="Image URL" value={block.url || ''} onChange={v => set('url', v)} />
              <div>
                <label className="label">Or Upload Image</label>
                <input type="file" accept="image/*" className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
                    const reader = new FileReader();
                    reader.onload = () => set('url', reader.result);
                    reader.readAsDataURL(file);
                  }} />
              </div>
              {block.url && <img src={block.url} alt={block.caption || ''} className="mt-2 max-h-40 rounded-lg border border-gray-200 object-contain" />}
              <Field label="Caption" value={block.caption || ''} onChange={v => set('caption', v)} />
            </>
          )}
          {block.type === 'link' && (
            <>
              <Field label="Link Text" value={block.text || ''} onChange={v => set('text', v)} />
              <Field label="URL" value={block.url || ''} onChange={v => set('url', v)} />
              <Field label="Description (optional)" value={block.description || ''} onChange={v => set('description', v)} />
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

/* ============ Main Editor ============ */

export default function ReportEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('sections');
  const [aiMsg, setAiMsg] = useState('');
  const [aiChat, setAiChat] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [aiProvider, setAiProvider] = useState('claude');
  const [aiProviders, setAiProviders] = useState([]);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    api.getReport(id)
      .then(res => setReport(res.report))
      .catch(() => { toast.error('Report not found'); navigate('/reports'); })
      .finally(() => setLoading(false));
    api.getProviders()
      .then(res => {
        setAiProviders(res.providers || []);
        if (res.providers?.length) setAiProvider(res.providers[0].id);
      })
      .catch(() => {});
  }, [id, navigate]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [aiChat]);

  // Auto-save: debounce 2 seconds after any change to report data
  const autoSaveTimer = useRef(null);
  const lastSavedRef = useRef(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState(''); // '', 'saving', 'saved'

  useEffect(() => {
    if (!report || loading) return;
    // Skip if report hasn't changed from what we loaded/saved
    const currentData = JSON.stringify({ title: report.title, description: report.description, report_data: report.report_data });
    if (lastSavedRef.current === currentData) return;
    // First load — set initial snapshot, don't save
    if (lastSavedRef.current === null) {
      lastSavedRef.current = currentData;
      return;
    }

    setAutoSaveStatus('');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        setAutoSaveStatus('saving');
        await api.updateReport(id, { title: report.title, description: report.description, reportData: report.report_data });
        lastSavedRef.current = currentData;
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus(prev => prev === 'saved' ? '' : prev), 2000);
      } catch {
        setAutoSaveStatus('');
      }
    }, 2000);

    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [report?.title, report?.description, report?.report_data, id, loading]);

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
    const s = [...rd.sections]; fn(s, sIdx); rd.sections = s;
  });

  const updateBlock = (sIdx, bIdx, block) => updateSection(sIdx, (s) => {
    s[sIdx] = { ...s[sIdx], blocks: s[sIdx].blocks.map((b, i) => i === bIdx ? block : b) };
  });

  const removeBlock = (sIdx, bIdx) => updateSection(sIdx, (s) => {
    s[sIdx] = { ...s[sIdx], blocks: s[sIdx].blocks.filter((_, i) => i !== bIdx) };
  });

  const moveBlock = (sIdx, bIdx, dir) => updateSection(sIdx, (s) => {
    const blocks = [...s[sIdx].blocks];
    const t = bIdx + dir;
    if (t < 0 || t >= blocks.length) return;
    [blocks[bIdx], blocks[t]] = [blocks[t], blocks[bIdx]];
    s[sIdx] = { ...s[sIdx], blocks };
  });

  const addBlock = (sIdx, type) => updateSection(sIdx, (s) => {
    const nb = { type };
    if (type === 'notes') nb.items = [''];
    if (type === 'metrics') nb.items = [{ label: 'Metric', value: '0', change: '', trend: 'stable' }];
    if (type === 'table') { nb.headers = ['Column 1']; nb.rows = [['']]; }
    if (type === 'keyvalue') nb.items = [{ key: 'Key', value: 'Value' }];
    if (type === 'comparison') { nb.leftTitle = 'Left'; nb.rightTitle = 'Right'; nb.leftRows = [{ key: '', value: '' }]; nb.rightRows = [{ key: '', value: '' }]; }
    if (type === 'link') { nb.text = 'Link text'; nb.url = 'https://'; nb.description = ''; }
    s[sIdx] = { ...s[sIdx], blocks: [...(s[sIdx].blocks || []), nb] };
  });

  const addSection = () => updateData(rd => { rd.sections = [...(rd.sections || []), { title: 'New Section', blocks: [] }]; });

  const removeSection = (sIdx) => {
    if (!confirm('Delete this section?')) return;
    updateData(rd => { rd.sections = rd.sections.filter((_, i) => i !== sIdx); });
  };

  const moveSection = (sIdx, dir) => updateData(rd => {
    const s = [...rd.sections];
    const t = sIdx + dir;
    if (t < 0 || t >= s.length) return;
    [s[sIdx], s[t]] = [s[t], s[sIdx]];
    rd.sections = s;
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateReport(id, { title: report.title, description: report.description, reportData: report.report_data });
      lastSavedRef.current = JSON.stringify({ title: report.title, description: report.description, report_data: report.report_data });
      toast.success('Saved!');
    } catch (err) { toast.error(err.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  /* ---- AI Chat ---- */

  const handleAIResponse = useCallback((res) => {
    const friendlyMsg = res.message || res.response || '';
    const updates = res.updates;
    let hasUpdates = false;

    if (updates && typeof updates === 'object') {
      hasUpdates = true;
      const parts = [];
      if (updates.generalInfo) parts.push('General Info');
      if (updates.sections) updates.sections.forEach((su, i) => { if (su) parts.push(sections[i]?.title || `Section ${i + 1}`); });

      updateData(rd => {
        if (updates.generalInfo) rd.generalInfo = { ...rd.generalInfo, ...updates.generalInfo };
        if (updates.sections) {
          const newSections = [...rd.sections];
          updates.sections.forEach((su, i) => {
            if (su) {
              newSections[i] = newSections[i] ? { ...newSections[i], ...su } : su;
            }
          });
          rd.sections = newSections;
        }
      });
      toast.success(`Updated: ${parts.join(', ') || 'Report data'}`);
    }

    setAiChat(prev => [...prev, { role: 'assistant', content: friendlyMsg, hasUpdates }]);
  }, [updateData, sections]);

  const handleAISend = async () => {
    if (!aiMsg.trim()) return;
    const msg = aiMsg.trim();
    setAiMsg('');
    setAiChat(prev => [...prev, { role: 'user', content: msg }]);
    setAiLoading(true);
    try {
      const res = await api.chatAI(msg, reportData, aiProvider, aiChat.slice(-6));
      handleAIResponse(res);
    } catch (err) {
      setAiChat(prev => [...prev, { role: 'assistant', content: 'Error: ' + (err.message || 'AI request failed') }]);
    } finally { setAiLoading(false); }
  };

  const sendQuickAction = (text) => {
    setAiChat(prev => [...prev, { role: 'user', content: text }]);
    setAiLoading(true);
    api.chatAI(text, reportData, aiProvider, aiChat.slice(-6))
      .then(res => handleAIResponse(res))
      .catch(err => setAiChat(prev => [...prev, { role: 'assistant', content: 'Error: ' + err.message }]))
      .finally(() => setAiLoading(false));
  };

  const handleAIFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAiLoading(true);
    setAiChat(prev => [...prev, { role: 'user', content: `📎 Uploaded: ${file.name}` }]);
    try {
      const uploadRes = await api.uploadFile(file);
      const summary = uploadRes.parsedData || uploadRes.rawData || uploadRes.summary;
      const dataStr = typeof summary === 'string' ? summary : JSON.stringify(summary, null, 2);
      const msg = `I've uploaded a file called "${file.name}". Here is the parsed data:\n\n${dataStr.slice(0, 8000)}\n\nPlease analyze this data and fill the report sections with relevant content.`;
      const res = await api.chatAI(msg, reportData, aiProvider, aiChat.slice(-4));
      handleAIResponse(res);
    } catch (err) {
      setAiChat(prev => [...prev, { role: 'assistant', content: 'Error uploading file: ' + (err.message || 'Failed') }]);
    } finally {
      setAiLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePasteSubmit = async () => {
    if (!pasteText.trim()) return;
    const text = pasteText.trim();
    setAiChat(prev => [...prev, { role: 'user', content: `📋 Pasted data (${text.length} chars)` }]);
    setShowPasteBox(false);
    setPasteText('');
    setAiLoading(true);
    try {
      const msg = `Here is raw data to incorporate into the report:\n\n${text.slice(0, 10000)}\n\nAnalyze this and update the report sections with this data. Fill in real values.`;
      const res = await api.chatAI(msg, reportData, aiProvider, aiChat.slice(-4));
      handleAIResponse(res);
    } catch (err) {
      setAiChat(prev => [...prev, { role: 'assistant', content: 'Error: ' + (err.message || 'AI request failed') }]);
    } finally { setAiLoading(false); }
  };

  const handleRefine = async (sIdx) => {
    const instruction = prompt('How should AI refine this section?');
    if (!instruction?.trim()) return;
    setAiLoading(true);
    try {
      const res = await api.refineSection(reportData, sIdx, instruction, aiProvider);
      const updated = res.section || res.updatedSection;
      if (updated) { updateSection(sIdx, (s) => { s[sIdx] = updated; }); toast.success('Section refined'); }
    } catch (err) { toast.error(err.message || 'Refine failed'); }
    finally { setAiLoading(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-green-600" /></div>;
  if (!report) return null;

  return (
    <div className="space-y-4 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button onClick={() => navigate('/reports')} className="btn-ghost p-2 self-start"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex-1 min-w-0">
          <input className="text-xl font-bold text-gray-900 bg-transparent border-none outline-none w-full placeholder:text-gray-300 focus:ring-0"
            value={report.title || ''} onChange={e => setReport(prev => ({ ...prev, title: e.target.value }))} placeholder="Report title..." />
          <input className="text-sm text-gray-500 bg-transparent border-none outline-none w-full placeholder:text-gray-300 focus:ring-0 mt-0.5"
            value={report.description || ''} onChange={e => setReport(prev => ({ ...prev, description: e.target.value }))} placeholder="Description..." />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {autoSaveStatus === 'saving' && (
            <span className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving...</span>
          )}
          {autoSaveStatus === 'saved' && (
            <span className="text-xs text-green-500 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Saved</span>
          )}
          <button onClick={() => navigate(`/reports/${id}/preview`)} className="btn-secondary flex items-center gap-2"><Eye className="h-4 w-4" /> Preview</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[{ key: 'sections', label: 'Sections', icon: List }, { key: 'general', label: 'General Info', icon: Palette }, { key: 'ai', label: 'AI Assistant', icon: Brain }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-green-500 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
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
                <input className="flex-1 font-semibold text-gray-900 bg-transparent border-none outline-none"
                  value={section.title || ''} onChange={e => updateSection(sIdx, s => { s[sIdx] = { ...s[sIdx], title: e.target.value }; })} placeholder="Section title..." />
                <button onClick={() => handleRefine(sIdx)} className="btn-ghost p-1.5 text-purple-600" title="AI Refine" disabled={aiLoading}><Sparkles className="h-4 w-4" /></button>
                <button onClick={() => moveSection(sIdx, -1)} disabled={sIdx === 0} className="btn-ghost p-1.5 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                <button onClick={() => moveSection(sIdx, 1)} disabled={sIdx === sections.length - 1} className="btn-ghost p-1.5 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                <button onClick={() => removeSection(sIdx)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="p-4 space-y-3">
                {(section.blocks || []).map((block, bIdx) => (
                  <BlockEditor key={bIdx} block={block}
                    onChange={b => updateBlock(sIdx, bIdx, b)}
                    onRemove={() => removeBlock(sIdx, bIdx)}
                    onMoveUp={() => moveBlock(sIdx, bIdx, -1)}
                    onMoveDown={() => moveBlock(sIdx, bIdx, 1)}
                    isFirst={bIdx === 0}
                    isLast={bIdx === (section.blocks || []).length - 1} />
                ))}
                <div className="relative">
                  <button onClick={() => setShowAddBlock(showAddBlock === sIdx ? false : sIdx)}
                    className="btn-secondary w-full flex items-center justify-center gap-2 border-dashed"><Plus className="h-4 w-4" /> Add Block</button>
                  {showAddBlock === sIdx && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg border border-gray-200 shadow-lg py-2 z-20 grid grid-cols-2 gap-1 p-2">
                      {BLOCK_TYPES.map(bt => (
                        <button key={bt.type} onClick={() => { addBlock(sIdx, bt.type); setShowAddBlock(false); }}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm text-left">
                          <bt.icon className="h-4 w-4 text-green-600 shrink-0" /> {bt.label}
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
              <input type="color" value={reportData.generalInfo?.brandColor || '#02B376'} onChange={e => setGeneral('brandColor', e.target.value)} className="h-10 w-10 rounded cursor-pointer" />
              <input className="input-field text-sm" value={reportData.generalInfo?.brandColor || '#02B376'} onChange={e => setGeneral('brandColor', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">KPI Strip</label>
            <KpiStripEditor kpis={reportData.generalInfo?.kpiStrip || []} onChange={v => setGeneral('kpiStrip', v)} />
          </div>
        </div>
      )}

      {/* AI Assistant tab */}
      {tab === 'ai' && (
        <div className="card flex flex-col" style={{ height: 'calc(100vh - 300px)', minHeight: '400px' }}>
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-600" />
            <span className="font-semibold text-gray-900">AI Assistant</span>
            <select className="ml-auto text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white" value={aiProvider} onChange={e => setAiProvider(e.target.value)}>
              {aiProviders.length > 0 ? aiProviders.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              )) : <>
                <option value="claude">Anthropic Claude</option>
                <option value="gemini">Google Gemini</option>
                <option value="perplexity">Perplexity AI</option>
              </>}
            </select>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {aiChat.length === 0 && (
              <div className="text-center text-sm text-gray-400 py-8">
                <Brain className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                <p className="mb-1">Ask AI to fill, edit, or improve your report.</p>
                <p className="text-xs">Upload a file 📎 or paste data 📋 to auto-fill sections.</p>
              </div>
            )}
            {aiChat.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${msg.role === 'user' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.hasUpdates && (
                    <div className="mt-2 flex items-center gap-1.5 text-green-700 bg-green-50 rounded-lg px-3 py-1.5 text-xs font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Report updated successfully
                    </div>
                  )}
                </div>
              </div>
            ))}
            {aiLoading && (
              <div className="flex justify-start"><div className="bg-gray-100 rounded-xl px-4 py-3"><Loader2 className="h-4 w-4 animate-spin text-gray-500" /></div></div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick actions */}
          <div className="px-4 py-2 border-t border-gray-100 flex gap-2 flex-wrap">
            {['Improve all sections', 'Add executive summary', 'Update all metrics', 'Generate comparison tables', 'Fix formatting'].map(q => (
              <button key={q} onClick={() => sendQuickAction(q)} disabled={aiLoading}
                className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">{q}</button>
            ))}
          </div>

          {/* Paste data box */}
          {showPasteBox && (
            <div className="px-4 py-3 border-t border-gray-100 bg-amber-50/50">
              <label className="text-xs font-medium text-gray-600 mb-1 block">Paste your data (text, HTML, numbers)</label>
              <textarea className="input-field text-sm" rows={4} placeholder="Paste raw data here — AI will analyze and fill the report..."
                value={pasteText} onChange={e => setPasteText(e.target.value)} autoFocus />
              <div className="flex gap-2 mt-2">
                <button onClick={handlePasteSubmit} disabled={!pasteText.trim() || aiLoading} className="btn-primary text-xs px-3 py-1.5">Send to AI</button>
                <button onClick={() => { setShowPasteBox(false); setPasteText(''); }} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}

          {/* Input with file upload + paste */}
          <div className="p-4 border-t border-gray-200">
            <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls,.csv,.json,.txt,.md,.html" onChange={handleAIFileUpload} />
            <form onSubmit={e => { e.preventDefault(); handleAISend(); }} className="flex gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={aiLoading}
                className="btn-ghost p-2.5 text-gray-400 hover:text-green-600" title="Upload file (Excel, CSV, text)"><Paperclip className="h-4 w-4" /></button>
              <button type="button" onClick={() => setShowPasteBox(!showPasteBox)} disabled={aiLoading}
                className={`btn-ghost p-2.5 ${showPasteBox ? 'text-green-600' : 'text-gray-400 hover:text-green-600'}`} title="Paste data"><ClipboardPaste className="h-4 w-4" /></button>
              <input className="input-field flex-1" placeholder="Ask AI to fill or modify your report..." value={aiMsg} onChange={e => setAiMsg(e.target.value)} disabled={aiLoading} />
              <button type="submit" disabled={aiLoading || !aiMsg.trim()} className="btn-primary px-4"><Send className="h-4 w-4" /></button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
