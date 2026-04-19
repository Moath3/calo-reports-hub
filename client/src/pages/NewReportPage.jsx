import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { Card, Pill, Btn, Icon, LabeledInput } from '../components/ui';

function StylePick({ label, sub, selected, onClick }) {
  const [hover, setHover] = useState(false);
  const active = selected;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        padding: '12px 14px', borderRadius: 10,
        border: `1px solid ${active ? 'var(--calo-500)' : 'var(--ink-200)'}`,
        background: active ? 'var(--calo-50)' : (hover ? 'var(--ink-50)' : '#fff'),
        textAlign: 'left', position: 'relative', cursor: 'pointer', flex: 1,
      }}
    >
      {active && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          width: 16, height: 16, borderRadius: 8,
          background: 'var(--calo-500)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="Check" size={10} />
        </div>
      )}
      <div style={{ fontSize: 13, fontWeight: 900, color: active ? 'var(--calo-800)' : 'var(--ink-900)' }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>{sub}</div>
    </button>
  );
}

function GenerationProgress() {
  const steps = [
    { label: 'Reading your file', icon: 'FileSearch' },
    { label: 'Understanding the data', icon: 'Brain' },
    { label: 'Writing sections', icon: 'PenLine' },
    { label: 'Calculating metrics', icon: 'BarChart3' },
    { label: 'Polishing the layout', icon: 'Sparkles' },
  ];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep(s => (s + 1) % (steps.length + 1)), 1300);
    return () => clearInterval(id);
  }, [steps.length]);

  return (
    <Card padding={40}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 20px' }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '3px solid var(--calo-100)',
            borderTopColor: 'var(--calo-500)',
            animation: 'spinner 1.2s linear infinite',
          }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="Sparkles" size={30} color="var(--calo-500)" />
          </div>
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Building your report…</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-500)', margin: 0 }}>This usually takes 20–40 seconds.</p>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        {steps.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 14px', borderRadius: 10,
              background: active ? 'var(--calo-50)' : 'transparent',
              opacity: i > step ? 0.4 : 1,
              transition: 'all .3s',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: done ? 'var(--calo-500)' : (active ? 'var(--calo-500)' : 'var(--ink-100)'),
                color: done || active ? '#fff' : 'var(--ink-500)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {done ? <Icon name="Check" size={15} /> : <Icon name={s.icon} size={15} />}
              </div>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: done || active ? 'var(--ink-900)' : 'var(--ink-500)' }}>
                {s.label}
              </div>
              {done && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--calo-600)' }}>Done</span>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function NewReportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const chatTextareaRef = useRef(null);

  // URL param ?mode=chat auto-focuses the chat box on mount
  const initialMode = searchParams.get('mode');

  const [phase, setPhase] = useState('start'); // start | preview | gen
  const [file, setFile] = useState(null);
  const [dataSummary, setDataSummary] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState(''); // '' = auto (smart routing)
  const [customPrompt, setCustomPrompt] = useState('');
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [style, setStyle] = useState('standard');
  const [variant, setVariant] = useState('editorial'); // visual output layout

  // Chat-first creation: user just types what they need
  const [chatText, setChatText] = useState('');
  const [chatTitle, setChatTitle] = useState('');

  useEffect(() => {
    if (initialMode === 'chat' && chatTextareaRef.current) {
      chatTextareaRef.current.focus();
    }
  }, [initialMode]);

  // Load providers + templates on mount so chat mode has them
  useEffect(() => {
    api.getProviders().then(r => setProviders(r.providers || [])).catch(() => {});
    api.getTemplates().then(r => setTemplates(r.templates || [])).catch(() => {});
  }, []);

  const onDrop = useCallback(async (accepted) => {
    if (!accepted.length) return;
    const f = accepted[0];
    setFile(f);
    setLoading(true);
    try {
      const res = await api.uploadFile(f);
      setDataSummary(res.parsedData || res.summary);
      setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
      try {
        const pRes = await api.getProviders();
        setProviders(pRes.providers || []);
        // Keep provider as '' (auto) unless user explicitly picks one
      } catch { /* ignore */ }
      try {
        const tRes = await api.getTemplates();
        setTemplates(tRes.templates || []);
      } catch { /* ignore */ }
      setPhase('preview');
      toast.success('File processed');
    } catch (err) {
      toast.error(err.message || 'Failed to process file');
      setFile(null);
    } finally { setLoading(false); }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'application/json': ['.json'],
      'text/plain': ['.txt', '.md'],
      'text/html': ['.html', '.htm'],
    },
    maxFiles: 1,
    maxSize: 25 * 1024 * 1024,
    disabled: loading,
  });

  const handleGenerate = async () => {
    if (!title.trim()) { toast.error('Please enter a report title'); return; }
    setPhase('gen');
    setLoading(true);
    try {
      const extra = [customPrompt, style !== 'standard' ? `Style: ${style}` : ''].filter(Boolean).join('\n\n') || undefined;
      const res = await api.analyzeData(dataSummary, provider, extra, selectedTemplateId || undefined);
      const aiReport = res.reportData || res.report || {};
      // Bake chosen visual variant into generalInfo
      aiReport.generalInfo = { ...(aiReport.generalInfo || {}), variant };
      const createRes = await api.createReport({
        title: title.trim(),
        description: description.trim(),
        reportData: aiReport,
        sourceFilename: file?.name || '',
        sourceData: dataSummary,
        aiProvider: provider,
        tags: [],
      });
      toast.success('Report generated!');
      navigate(`/reports/${createRes.id}`);
    } catch (err) {
      toast.error(err.message || 'AI generation failed');
      setPhase('preview');
    } finally { setLoading(false); }
  };

  const handleSkipAI = async () => {
    if (!title.trim()) { toast.error('Please enter a report title'); return; }
    setLoading(true);
    try {
      const createRes = await api.createReport({
        title: title.trim(),
        description: description.trim(),
        reportData: { generalInfo: { title: title.trim(), brandColor: '#02B376', variant }, sections: [] },
        sourceFilename: file?.name || '',
        sourceData: dataSummary,
        tags: [],
      });
      toast.success('Empty report created');
      navigate(`/reports/${createRes.id}`);
    } catch (err) { toast.error(err.message || 'Failed to create report'); }
    finally { setLoading(false); }
  };

  const handleBlank = async () => {
    const t = prompt('Enter report title:');
    if (!t?.trim()) return;
    setLoading(true);
    try {
      const createRes = await api.createReport({
        title: t.trim(),
        reportData: { generalInfo: { title: t.trim(), brandColor: '#02B376' }, sections: [] },
        tags: [],
      });
      toast.success('Blank report created');
      navigate(`/reports/${createRes.id}`);
    } catch (err) { toast.error(err.message || 'Failed to create'); }
    finally { setLoading(false); }
  };

  // Zero-effort entry: user types what they want, AI builds the whole report.
  // Uses Opus (smart routing defaults analyze → Opus) for quality.
  const handleChatGenerate = async () => {
    const text = chatText.trim();
    if (text.length < 8) { toast.error('Add a bit more detail (at least a sentence)'); return; }
    setPhase('gen');
    setLoading(true);
    try {
      // Wrap the user's description so the AI knows it's a description, not tabular data
      const dataPayload = {
        mode: 'chat',
        userDescription: text,
        note: 'The user provided a plain-English description of the report they want. Synthesize realistic structure, KPIs, sections and plausible placeholder numbers where specific data was not provided. Be helpful — build the full report.',
      };
      const res = await api.analyzeData(dataPayload, provider || 'claude-opus', undefined, selectedTemplateId || undefined);
      const aiReport = res.reportData || res.report || {};
      // Bake user-chosen variant + auto-derived title (from first line) into the report
      aiReport.generalInfo = { ...(aiReport.generalInfo || {}), variant };
      const derivedTitle = chatTitle.trim() || (aiReport.title || aiReport.generalInfo?.title || (text.split(/\n|[.!?]/)[0] || '').slice(0, 80) || 'Untitled report');
      const createRes = await api.createReport({
        title: derivedTitle,
        description: 'Created from chat: ' + text.slice(0, 140),
        reportData: aiReport,
        sourceFilename: '',
        sourceData: dataPayload,
        aiProvider: provider || 'claude-opus',
        tags: ['from-chat'],
      });
      toast.success('Report generated!');
      navigate(`/reports/${createRes.id}`);
    } catch (err) {
      toast.error(err.message || 'AI generation failed');
      setPhase('start');
    } finally { setLoading(false); }
  };

  return (
    <div className="animate-slide-up" style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <button
          onClick={() => navigate('/')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-500)', fontWeight: 700, marginBottom: 12, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <Icon name="ArrowLeft" size={14} /> Home
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 40, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.05 }}>New report</h1>
            <p style={{ fontSize: 16, color: 'var(--ink-500)', margin: '8px 0 0', maxWidth: 560 }}>
              Describe what you need — Calo AI builds the whole report. No file required.
            </p>
          </div>
          <Btn variant="ghost" onClick={handleBlank}>Blank report</Btn>
        </div>
      </div>

      {phase === 'start' && (
        <>
          {/* CHAT-FIRST — 0 effort: type and go */}
          <Card padding={24} style={{ position: 'relative', overflow: 'hidden', marginBottom: 16 }}>
            {/* Tiny corner accent */}
            <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'var(--calo-50)', opacity: .6, pointerEvents: 'none' }} />

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, var(--calo-500), var(--calo-700))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(2,179,118,.3)' }}>
                <Icon name="Sparkles" size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="eyebrow" style={{ marginBottom: 2 }}>FASTEST WAY</div>
                <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em' }}>Chat with Calo AI</div>
              </div>
              <Pill tone="solid" size="sm" icon="Zap">30 sec</Pill>
            </div>

            <p style={{ position: 'relative', fontSize: 14, color: 'var(--ink-600)', marginBottom: 14, lineHeight: 1.5 }}>
              Tell me what you need and I'll build the whole report — KPIs, sections, tables, and a summary. No file required.
            </p>

            <textarea
              ref={chatTextareaRef}
              value={chatText}
              onChange={e => setChatText(e.target.value)}
              placeholder="e.g. Q1 production report for our 6 KSA kitchens — meals produced, waste %, on-time delivery, NPS. Compare to Q4 2025. Highlight Riyadh's new automation cell."
              rows={5}
              disabled={loading}
              className="input-field"
              style={{
                position: 'relative',
                fontFamily: 'inherit', resize: 'vertical',
                fontSize: 14, lineHeight: 1.5,
                padding: 14,
              }}
            />

            {/* Quick prompts */}
            <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {[
                'Q1 2026 production report for our KSA kitchens',
                'Weekly ops review — deliveries, waste, NPS',
                'HR performance report — headcount, turnover, open roles',
                'Customer survey summary with NPS trend and top themes',
                'Marketing monthly — campaign performance, CAC, ROI',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => setChatText(q)}
                  disabled={loading}
                  style={{
                    padding: '6px 12px', borderRadius: 999,
                    background: 'var(--ink-50)', color: 'var(--ink-700)',
                    border: '1px solid var(--ink-200)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    letterSpacing: '-0.01em',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--calo-50)'; e.currentTarget.style.borderColor = 'var(--calo-200)'; e.currentTarget.style.color = 'var(--calo-800)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--ink-50)'; e.currentTarget.style.borderColor = 'var(--ink-200)'; e.currentTarget.style.color = 'var(--ink-700)'; }}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Layout quick-picker for chat flow */}
            <div style={{ position: 'relative', display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--ink-500)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Layout:</span>
              {[
                { id: 'editorial', label: 'Editorial' },
                { id: 'dashboard', label: 'Dashboard' },
                { id: 'minimal',   label: 'Minimal' },
                { id: 'brief',     label: 'Brief' },
              ].map(v => (
                <button
                  key={v.id}
                  onClick={() => setVariant(v.id)}
                  style={{
                    padding: '6px 12px', borderRadius: 999,
                    fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                    background: variant === v.id ? 'var(--ink-900)' : 'var(--ink-100)',
                    color: variant === v.id ? '#fff' : 'var(--ink-700)',
                  }}
                >{v.label}</button>
              ))}
            </div>

            <button
              onClick={handleChatGenerate}
              disabled={loading || chatText.trim().length < 8}
              style={{
                position: 'relative',
                marginTop: 16, width: '100%',
                background: chatText.trim().length < 8 ? 'var(--ink-200)' : 'var(--calo-500)',
                color: chatText.trim().length < 8 ? 'var(--ink-500)' : '#fff',
                padding: '16px 20px', borderRadius: 'var(--r-pill)',
                fontSize: 15, fontWeight: 900, letterSpacing: '-0.01em',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: chatText.trim().length >= 8 ? '0 4px 14px rgba(2,179,118,.35)' : 'none',
                border: 'none',
                cursor: chatText.trim().length < 8 ? 'not-allowed' : 'pointer',
                transition: 'all .15s ease',
              }}
            >
              <Icon name="Sparkles" size={17} />
              Generate report
              <Icon name="ArrowRight" size={17} />
            </button>
            <div style={{ position: 'relative', textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--ink-500)' }}>
              Runs on Claude Opus · Takes about 20–40 seconds
            </div>
          </Card>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--ink-200)' }} />
            <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--ink-500)', letterSpacing: '.16em', textTransform: 'uppercase' }}>or have data?</span>
            <div style={{ flex: 1, height: 1, background: 'var(--ink-200)' }} />
          </div>

          {/* SECONDARY — File upload, compact */}
          <div
            {...getRootProps()}
            style={{
              background: isDragActive ? 'var(--calo-50)' : '#fff',
              border: `2px dashed ${isDragActive ? 'var(--calo-500)' : 'var(--ink-300)'}`,
              borderRadius: 'var(--r-lg)',
              padding: '32px 28px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all .2s ease',
              opacity: loading ? 0.6 : 1,
              pointerEvents: loading ? 'none' : 'auto',
              display: 'flex', alignItems: 'center', gap: 18, justifyContent: 'center',
            }}
          >
            <input {...getInputProps()} />
            {loading ? (
              <>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--calo-50)', display: 'grid', placeItems: 'center' }}>
                  <div style={{ width: 22, height: 22, borderRadius: 11, border: '3px solid var(--calo-200)', borderTopColor: 'var(--calo-500)', animation: 'spinner 1s linear infinite' }} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.01em' }}>Reading your file…</div>
              </>
            ) : (
              <>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--ink-100)', color: 'var(--ink-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="Upload" size={22} />
                </div>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.01em' }}>Upload Excel, CSV, JSON or text</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>Drop here or click — up to 25 MB, data stays private</div>
                </div>
                <Icon name="ArrowRight" size={18} color="var(--ink-400)" />
              </>
            )}
          </div>
        </>
      )}

      {phase === 'preview' && file && (
        <div className="new-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Card padding={24}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--calo-50)', color: 'var(--calo-700)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="FileSpreadsheet" size={26} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>
                  {(file.size/1024).toFixed(0)} KB{dataSummary?.rows ? ` · ${dataSummary.rows} rows × ${dataSummary.columns || dataSummary.cols || ''} columns` : ''}
                </div>
              </div>
              <button
                onClick={() => { setPhase('drop'); setFile(null); setDataSummary(null); }}
                style={{ padding: 6, color: 'var(--ink-400)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <Icon name="X" size={16} />
              </button>
            </div>

            <div className="eyebrow">Detected</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              {[
                { l: 'Type', v: dataSummary?.type || 'Report' },
                { l: 'Rows', v: dataSummary?.rows || '—' },
                { l: 'Columns', v: dataSummary?.columns || dataSummary?.cols || '—' },
                { l: 'Format', v: (file.name.split('.').pop() || '').toUpperCase() },
              ].map((d, i) => (
                <div key={i} style={{ padding: '10px 12px', background: 'var(--ink-50)', borderRadius: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>{d.l}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{d.v}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, padding: 14, background: 'var(--calo-50)', border: '1px solid var(--calo-100)', borderRadius: 12, display: 'flex', gap: 10 }}>
              <Icon name="Sparkles" size={16} color="var(--calo-700)" style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ fontSize: 13, color: 'var(--calo-800)', lineHeight: 1.5 }}>
                <strong>AI ready.</strong> Calo AI will read your data and build KPIs, sections, tables, and an executive summary.
              </div>
            </div>
          </Card>

          <Card padding={24}>
            <div className="eyebrow">Report details</div>
            <div style={{ marginTop: 8 }}>
              <LabeledInput label="Title" value={title} onChange={setTitle} placeholder="My Weekly Report" />
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="label">Tone</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <StylePick label="Executive" sub="Short & visual"     selected={style === 'executive'} onClick={() => setStyle('executive')} />
                <StylePick label="Standard"  sub="Balanced"            selected={style === 'standard'}  onClick={() => setStyle('standard')} />
                <StylePick label="Detailed"  sub="All the data"        selected={style === 'detailed'}  onClick={() => setStyle('detailed')} />
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="label">Layout</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                <StylePick label="Editorial"  sub="Magazine, in-depth"     selected={variant === 'editorial'}  onClick={() => setVariant('editorial')} />
                <StylePick label="Dashboard"  sub="Compact, data-first"    selected={variant === 'dashboard'}  onClick={() => setVariant('dashboard')} />
                <StylePick label="Minimal"    sub="Paper, print-ready"     selected={variant === 'minimal'}    onClick={() => setVariant('minimal')} />
                <StylePick label="Brief"      sub="One-page summary"       selected={variant === 'brief'}      onClick={() => setVariant('brief')} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 4 }}>
                You can switch layout anytime from the Tweaks panel in Preview.
              </p>
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="label">AI model</label>
              <select
                value={provider}
                onChange={e => setProvider(e.target.value)}
                className="input-field"
              >
                <option value="">Auto — Opus for generation, Sonnet for edits</option>
                {providers.length > 0 ? providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                )) : (
                  <>
                    <option value="claude-sonnet">Claude Sonnet 4.5 — fast & smart</option>
                    <option value="claude-opus">Claude Opus 4.1 — heavy-duty reasoning</option>
                  </>
                )}
              </select>
              <p style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 4 }}>
                Leave as Auto for smart routing. Opus costs ~5× more — pick it only for complex files.
              </p>
            </div>

            {templates.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <label className="label">Template (optional)</label>
                <select
                  value={selectedTemplateId}
                  onChange={e => setSelectedTemplateId(e.target.value)}
                  className="input-field"
                >
                  <option value="">None — AI decides structure</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <label className="label">Extra notes for AI (optional)</label>
              <textarea
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                className="input-field"
                rows={3}
                placeholder="e.g. Focus on waste reduction, include kitchen-by-kitchen breakdown"
                style={{ resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading}
              style={{
                marginTop: 20, width: '100%',
                background: 'var(--calo-500)', color: '#fff', border: 'none',
                padding: '14px 18px', borderRadius: 'var(--r-pill)',
                fontSize: 15, fontWeight: 900, letterSpacing: '-0.01em',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: '0 4px 14px rgba(2,179,118,.35)', cursor: 'pointer',
                opacity: loading ? 0.5 : 1,
              }}
            >
              <Icon name="Sparkles" size={17} />
              Generate report
              <Icon name="ArrowRight" size={17} />
            </button>
            <div style={{ textAlign: 'center', marginTop: 10, fontSize: 12, color: 'var(--ink-500)' }}>
              <button onClick={handleSkipAI} style={{ color: 'var(--ink-500)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 12, fontWeight: 700 }}>
                Skip AI — start with an empty report
              </button>
            </div>
          </Card>
        </div>
      )}

      {phase === 'gen' && <GenerationProgress />}

      <style>{`
        @media (max-width: 767px) {
          .new-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
