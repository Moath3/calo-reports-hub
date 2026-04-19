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

  // Chat-first creation: multi-turn conversation before generation
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]); // [{ role: 'user'|'ai', content }]
  const [planning, setPlanning] = useState(false);       // true while /plan is in flight
  const [planReady, setPlanReady] = useState(false);
  const [brief, setBrief] = useState('');
  const [suggestedTitle, setSuggestedTitle] = useState('');
  const chatMsgsEndRef = useRef(null);

  // LocalStorage-backed personal prompt history
  const [promptHistory, setPromptHistory] = useState(() => {
    try {
      const raw = localStorage.getItem('calo-chat-prompts');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  // LocalStorage-backed default share preference
  const [shareVisibility, setShareVisibility] = useState(() => {
    try { return localStorage.getItem('calo-default-share') || 'private'; } catch { return 'private'; }
  });
  const [shareUsers, setShareUsers] = useState([]);           // all users (for Specific picker)
  const [shareSelected, setShareSelected] = useState([]);     // user IDs picked
  const [shareSearch, setShareSearch] = useState('');

  useEffect(() => {
    try { localStorage.setItem('calo-default-share', shareVisibility); } catch {}
  }, [shareVisibility]);

  useEffect(() => {
    if (initialMode === 'chat' && chatTextareaRef.current) {
      chatTextareaRef.current.focus();
    }
  }, [initialMode]);

  // Load providers + templates + share users on mount
  useEffect(() => {
    api.getProviders().then(r => setProviders(r.providers || [])).catch(() => {});
    api.getTemplates().then(r => setTemplates(r.templates || [])).catch(() => {});
    api.getUsersForShare().then(r => setShareUsers(r.users || [])).catch(() => {});
  }, []);

  // Auto-scroll chat when messages grow
  useEffect(() => { chatMsgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, planning]);

  // Remember a successful prompt in localStorage (last 10, deduplicated)
  const rememberPrompt = useCallback((text) => {
    const entry = { text, ts: Date.now() };
    setPromptHistory(prev => {
      const next = [entry, ...prev.filter(p => p.text !== text)].slice(0, 10);
      try { localStorage.setItem('calo-chat-prompts', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const removePromptFromHistory = (text) => {
    setPromptHistory(prev => {
      const next = prev.filter(p => p.text !== text);
      try { localStorage.setItem('calo-chat-prompts', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const toggleShareUser = (uid) => {
    setShareSelected(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  };

  const filteredShareUsers = shareUsers.filter(u =>
    !shareSearch ||
    u.name.toLowerCase().includes(shareSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(shareSearch.toLowerCase())
  );

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

  // Multi-turn chat state machine — user types, AI asks clarifying Qs (up to 3),
  // then declares ready:true with a synthesized brief. Frontend then calls
  // /analyze with the brief to build the report.
  const handleChatSubmit = async () => {
    const text = chatInput.trim();
    if (!text) return;
    if (planning) return;

    const nextHistory = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(nextHistory);
    setChatInput('');
    setPlanning(true);
    try {
      const res = await api.planChat(nextHistory);
      // Append AI response
      setChatMessages(prev => [...prev, { role: 'ai', content: res.message || '' }]);
      if (res.ready) {
        setPlanReady(true);
        setBrief(res.brief || text);
        setSuggestedTitle(res.suggestedTitle || '');
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'ai', content: 'Sorry — had trouble there. Try again?' }]);
      toast.error(err.message || 'Plan failed');
    } finally { setPlanning(false); }
  };

  const handleChatReset = () => {
    setChatMessages([]);
    setPlanReady(false);
    setBrief('');
    setSuggestedTitle('');
    setChatInput('');
    setTimeout(() => chatTextareaRef.current?.focus(), 50);
  };

  // When the user clicks "Build report" — take the brief + full convo and
  // call /analyze to produce the actual report, then create it with the
  // chosen share preference and navigate to the editor with chat history
  // preserved for refinement.
  const handleBuildFromBrief = async () => {
    const finalBrief = brief || chatMessages.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
    if (!finalBrief) { toast.error('Need some chat input first'); return; }

    rememberPrompt(chatMessages.find(m => m.role === 'user')?.content || finalBrief.slice(0, 140));
    setPhase('gen');
    setLoading(true);
    try {
      const dataPayload = {
        mode: 'chat',
        userDescription: finalBrief,
        conversation: chatMessages.map(m => ({ role: m.role, content: m.content })),
        note: 'The user had a short planning chat with you. Build the full report from the brief below. Synthesize realistic structure, KPIs, sections and plausible placeholder numbers where specific data was not provided.',
      };
      const res = await api.analyzeData(dataPayload, provider || 'claude-opus', undefined, selectedTemplateId || undefined);
      const aiReport = res.reportData || res.report || {};
      aiReport.generalInfo = { ...(aiReport.generalInfo || {}), variant };

      const firstUserMsg = chatMessages.find(m => m.role === 'user')?.content || finalBrief;
      const derivedTitle = suggestedTitle ||
        aiReport.title ||
        aiReport.generalInfo?.title ||
        (firstUserMsg.split(/\n|[.!?]/)[0] || '').slice(0, 80) ||
        'Untitled report';

      const createRes = await api.createReport({
        title: derivedTitle,
        description: 'Created from chat: ' + firstUserMsg.slice(0, 140),
        reportData: aiReport,
        sourceFilename: '',
        sourceData: dataPayload,
        aiProvider: provider || 'claude-opus',
        tags: ['from-chat'],
      });

      // Apply chosen share preference
      if (shareVisibility !== 'private') {
        try {
          await api.shareReport(createRes.id, {
            visibility: shareVisibility,
            sharedWith: shareVisibility === 'specific' ? shareSelected : [],
          });
        } catch (err) {
          console.warn('Share-preference apply failed:', err);
        }
      }

      toast.success('Report generated!');
      // Carry the chat history into the editor so the refinement chat picks up naturally
      navigate(`/reports/${createRes.id}`, {
        state: {
          initialChat: [
            ...chatMessages,
            { role: 'ai', content: "Done — your report is ready. What should I adjust?" },
          ],
        },
      });
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
          {/* CHAT-FIRST — multi-turn conversation */}
          <Card padding={0} style={{ position: 'relative', overflow: 'hidden', marginBottom: 16 }}>
            {/* Corner accent */}
            <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'var(--calo-50)', opacity: .6, pointerEvents: 'none' }} />

            {/* Header */}
            <div style={{ position: 'relative', padding: '20px 24px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: chatMessages.length > 0 ? '1px solid var(--ink-100)' : 'none' }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, var(--calo-500), var(--calo-700))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(2,179,118,.3)' }}>
                <Icon name="Sparkles" size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="eyebrow" style={{ marginBottom: 2 }}>FASTEST WAY</div>
                <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em' }}>Chat with Calo AI</div>
              </div>
              {chatMessages.length > 0 && (
                <button
                  onClick={handleChatReset}
                  style={{ padding: '6px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-500)', background: 'transparent', border: '1px solid var(--ink-200)', borderRadius: 999, cursor: 'pointer' }}
                  title="Start over"
                >
                  <Icon name="RotateCcw" size={12} /> New
                </button>
              )}
            </div>

            {/* Empty-state intro + suggested prompts */}
            {chatMessages.length === 0 && (
              <div style={{ position: 'relative', padding: '4px 24px 16px' }}>
                <p style={{ fontSize: 14, color: 'var(--ink-600)', marginBottom: 14, lineHeight: 1.5 }}>
                  Tell me what you need — I might ask a clarifying question, then I'll build the whole report (KPIs, sections, summary, insights).
                </p>

                {/* User's personal quick-chips (from localStorage) */}
                {promptHistory.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 11, fontWeight: 900, color: 'var(--ink-500)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                      <Icon name="History" size={12} /> Recent prompts
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {promptHistory.slice(0, 5).map(p => (
                        <div key={p.ts} style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--calo-50)', border: '1px solid var(--calo-100)', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                          <button
                            onClick={() => setChatInput(p.text)}
                            style={{ padding: '6px 4px 6px 12px', background: 'none', border: 'none', color: 'var(--calo-800)', cursor: 'pointer', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}
                            title={p.text}
                          >{p.text}</button>
                          <button
                            onClick={() => removePromptFromHistory(p.text)}
                            style={{ padding: '6px 10px 6px 4px', background: 'none', border: 'none', color: 'var(--calo-700)', cursor: 'pointer', opacity: .6 }}
                            title="Forget this prompt"
                          ><Icon name="X" size={11} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hardcoded starter prompts (only if user has no history yet) */}
                {promptHistory.length === 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {[
                      'Q1 2026 production report for our KSA kitchens',
                      'Weekly ops review — deliveries, waste, NPS',
                      'HR performance report — headcount, turnover, open roles',
                      'Customer survey summary with NPS trend and top themes',
                      'Marketing monthly — campaign performance, CAC, ROI',
                    ].map(q => (
                      <button
                        key={q}
                        onClick={() => setChatInput(q)}
                        disabled={loading || planning}
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
                )}
              </div>
            )}

            {/* Message thread */}
            {chatMessages.length > 0 && (
              <div style={{ position: 'relative', padding: '18px 24px', maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {chatMessages.map((m, i) => (
                  m.role === 'user' ? (
                    <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '80%' }}>
                      <div style={{ padding: '10px 14px', background: 'var(--ink-900)', color: '#fff', borderRadius: '14px 14px 2px 14px', fontSize: 13, fontWeight: 700, lineHeight: 1.45 }}>
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '80%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 9, background: 'linear-gradient(135deg, var(--calo-500), var(--calo-700))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="Sparkles" size={10} color="#fff" />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--calo-700)' }}>Calo AI</span>
                      </div>
                      <div style={{ padding: '10px 14px', background: 'var(--calo-50)', border: '1px solid var(--calo-100)', color: 'var(--calo-900)', borderRadius: '2px 14px 14px 14px', fontSize: 13, lineHeight: 1.5 }}>
                        {m.content}
                      </div>
                    </div>
                  )
                ))}
                {planning && (
                  <div style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--calo-50)', border: '1px solid var(--calo-100)', borderRadius: '2px 14px 14px 14px' }}>
                    <div style={{ width: 14, height: 14, borderRadius: 7, border: '2px solid var(--calo-500)', borderTopColor: 'transparent', animation: 'spinner 1s linear infinite' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--calo-800)' }}>Thinking…</span>
                  </div>
                )}
                <div ref={chatMsgsEndRef} />
              </div>
            )}

            {/* Ready-to-build bar */}
            {planReady && (
              <div style={{ position: 'relative', padding: '14px 24px', borderTop: '1px solid var(--ink-100)', background: '#FAFAF7', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Pill tone="solid" size="sm" icon="Check">Ready</Pill>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-700)', flex: 1, minWidth: 160 }}>
                  {suggestedTitle ? `"${suggestedTitle}"` : 'Ready to build'}
                </span>
                <button
                  onClick={handleBuildFromBrief}
                  disabled={loading}
                  style={{
                    background: 'var(--calo-500)', color: '#fff',
                    padding: '11px 20px', borderRadius: 999,
                    fontSize: 14, fontWeight: 900, letterSpacing: '-0.01em',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    boxShadow: '0 4px 14px rgba(2,179,118,.35)',
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  <Icon name="Sparkles" size={15} />
                  Build report
                  <Icon name="ArrowRight" size={15} />
                </button>
              </div>
            )}

            {/* Input bar */}
            <div style={{ position: 'relative', padding: '12px 16px', borderTop: '1px solid var(--ink-100)', background: '#fff' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  ref={chatTextareaRef}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleChatSubmit();
                    }
                  }}
                  placeholder={chatMessages.length === 0 ? "e.g. Q1 production report for our 6 KSA kitchens…" : "Type your reply… (⏎ to send, ⇧⏎ for new line)"}
                  rows={chatMessages.length === 0 ? 3 : 1}
                  disabled={loading || planning}
                  className="input-field"
                  style={{
                    flex: 1,
                    fontFamily: 'inherit', resize: 'none',
                    fontSize: 14, lineHeight: 1.5, padding: 12,
                    maxHeight: 140,
                  }}
                />
                <button
                  onClick={handleChatSubmit}
                  disabled={loading || planning || !chatInput.trim()}
                  style={{
                    background: !chatInput.trim() ? 'var(--ink-200)' : 'var(--calo-500)',
                    color: !chatInput.trim() ? 'var(--ink-500)' : '#fff',
                    padding: '11px 16px', borderRadius: 999,
                    border: 'none', cursor: !chatInput.trim() ? 'not-allowed' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 13, fontWeight: 900,
                  }}
                >
                  <Icon name="ArrowUp" size={14} />
                  Send
                </button>
              </div>
            </div>

            {/* Layout picker + share preference — always visible */}
            <div style={{ position: 'relative', padding: '12px 24px 18px', borderTop: '1px solid var(--ink-100)', background: '#FAFAF7' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--ink-500)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Layout</span>
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
                      background: variant === v.id ? 'var(--ink-900)' : '#fff',
                      color: variant === v.id ? '#fff' : 'var(--ink-700)',
                      boxShadow: variant === v.id ? 'none' : 'inset 0 0 0 1px var(--ink-200)',
                    }}
                  >{v.label}</button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--ink-500)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Share</span>
                {[
                  { id: 'private',  label: 'Private',       icon: 'LockKeyhole',  desc: 'Only me + admins' },
                  { id: 'shared',   label: 'Whole team',    icon: 'Users',        desc: 'Everyone on Calo' },
                  { id: 'specific', label: 'Specific people', icon: 'UserCheck',  desc: 'Pick who can view' },
                ].map(s => (
                  <button
                    key={s.id}
                    onClick={() => setShareVisibility(s.id)}
                    title={s.desc}
                    style={{
                      padding: '6px 12px', borderRadius: 999,
                      fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                      background: shareVisibility === s.id ? 'var(--ink-900)' : '#fff',
                      color: shareVisibility === s.id ? '#fff' : 'var(--ink-700)',
                      boxShadow: shareVisibility === s.id ? 'none' : 'inset 0 0 0 1px var(--ink-200)',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <Icon name={s.icon} size={12} />
                    {s.label}
                  </button>
                ))}
                <span style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 700, marginLeft: 'auto' }}>
                  Saved as your default
                </span>
              </div>

              {/* Specific-user picker */}
              {shareVisibility === 'specific' && (
                <div style={{ marginTop: 10, padding: 10, background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 12 }}>
                  <div style={{ position: 'relative', marginBottom: 8 }}>
                    <Icon name="Search" size={13} color="var(--ink-400)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                      type="text"
                      value={shareSearch}
                      onChange={e => setShareSearch(e.target.value)}
                      placeholder="Search people by name or email"
                      className="input-field"
                      style={{ paddingLeft: 32, fontSize: 13 }}
                    />
                  </div>
                  <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {filteredShareUsers.length === 0 && (
                      <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--ink-400)' }}>No people found.</div>
                    )}
                    {filteredShareUsers.map(u => {
                      const checked = shareSelected.includes(u.id);
                      return (
                        <label key={u.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                          background: checked ? 'var(--calo-50)' : 'transparent',
                          border: checked ? '1px solid var(--calo-200)' : '1px solid transparent',
                        }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleShareUser(u.id)}
                            style={{ accentColor: 'var(--calo-500)' }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)' }}>{u.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>{u.email}</div>
                          </div>
                          {u.department && <span style={{ fontSize: 11, padding: '2px 8px', background: 'var(--ink-100)', color: 'var(--ink-600)', borderRadius: 999, fontWeight: 700 }}>{u.department}</span>}
                        </label>
                      );
                    })}
                  </div>
                  {shareSelected.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--calo-700)', fontWeight: 700 }}>
                      {shareSelected.length} person{shareSelected.length === 1 ? '' : 's'} selected
                    </div>
                  )}
                </div>
              )}
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
