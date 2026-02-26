import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  Upload, FileSpreadsheet, Brain, Loader2, Sparkles,
  ChevronRight, X, FileText, Settings2
} from 'lucide-react';

export default function NewReportPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1=upload, 2=configure, 3=generating
  const [file, setFile] = useState(null);
  const [dataSummary, setDataSummary] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('gemini');
  const [customPrompt, setCustomPrompt] = useState('');
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);

  const onDrop = useCallback(async (accepted) => {
    if (!accepted.length) return;
    const f = accepted[0];
    setFile(f);
    setLoading(true);
    try {
      const res = await api.uploadFile(f);
      setDataSummary(res.summary);
      setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
      // Fetch available providers
      try {
        const pRes = await api.getProviders();
        setProviders(pRes.providers || []);
        if (pRes.providers?.length) setProvider(pRes.providers[0].id);
      } catch { /* ignore */ }
      setStep(2);
      toast.success('File processed successfully');
    } catch (err) {
      toast.error(err.message || 'Failed to process file');
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'application/json': ['.json'],
      'text/plain': ['.txt', '.md'],
    },
    maxFiles: 1,
    maxSize: 25 * 1024 * 1024,
    disabled: loading,
  });

  const handleGenerate = async () => {
    if (!title.trim()) { toast.error('Please enter a report title'); return; }
    setStep(3);
    setLoading(true);
    try {
      const res = await api.analyzeData(dataSummary, provider, customPrompt || undefined);
      // Create report with AI-generated data
      const aiReport = res.reportData || res.report || {};
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
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const handleSkipAI = async () => {
    if (!title.trim()) { toast.error('Please enter a report title'); return; }
    setLoading(true);
    try {
      const createRes = await api.createReport({
        title: title.trim(),
        description: description.trim(),
        reportData: { generalInfo: { title: title.trim(), brandColor: '#22c55e' }, sections: [] },
        sourceFilename: file?.name || '',
        sourceData: dataSummary,
        tags: [],
      });
      toast.success('Empty report created');
      navigate(`/reports/${createRes.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to create report');
    } finally {
      setLoading(false);
    }
  };

  // Also allow creating blank report without file
  const handleBlankReport = async () => {
    const t = prompt('Enter report title:');
    if (!t?.trim()) return;
    setLoading(true);
    try {
      const createRes = await api.createReport({
        title: t.trim(),
        reportData: { generalInfo: { title: t.trim(), brandColor: '#22c55e' }, sections: [] },
        tags: [],
      });
      toast.success('Blank report created');
      navigate(`/reports/${createRes.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to create report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload data and generate with AI</p>
        </div>
        <button onClick={handleBlankReport} className="btn-secondary text-sm">
          Blank Report
        </button>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2 text-sm">
        {['Upload Data', 'Configure', 'Generate'].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="h-4 w-4 text-gray-300" />}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${
              step > i + 1 ? 'bg-green-100 text-green-700' : step === i + 1 ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-400'
            }`}>
              <span className="font-medium">{i + 1}</span>
              <span className="hidden sm:inline">{s}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="card p-8">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-green-400 hover:bg-green-50/50'
            } ${loading ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <input {...getInputProps()} />
            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-12 w-12 text-green-600 animate-spin" />
                <p className="text-sm text-gray-600">Processing file...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="h-16 w-16 rounded-2xl bg-green-50 flex items-center justify-center">
                  <Upload className="h-8 w-8 text-green-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Drop your file here or click to browse</p>
                  <p className="text-sm text-gray-500 mt-1">Supports Excel, CSV, JSON, Text (max 25MB)</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && (
        <div className="space-y-4">
          {/* File info */}
          <div className="card p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{file?.name}</div>
              <div className="text-xs text-gray-500">{(file?.size / 1024).toFixed(1)} KB</div>
            </div>
            <button onClick={() => { setStep(1); setFile(null); setDataSummary(null); }} className="btn-ghost p-1.5">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Data summary */}
          {dataSummary && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" /> Data Summary
              </h3>
              <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {typeof dataSummary === 'string' ? dataSummary : JSON.stringify(dataSummary, null, 2)}
              </pre>
            </div>
          )}

          {/* Report config */}
          <div className="card p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Settings2 className="h-5 w-5" /> Report Settings
            </h3>

            <div>
              <label className="label">Report Title</label>
              <input className="input-field" value={title} onChange={e => setTitle(e.target.value)} placeholder="My Weekly Report" />
            </div>

            <div>
              <label className="label">Description (optional)</label>
              <textarea className="input-field" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description..." />
            </div>

            <div>
              <label className="label">AI Provider</label>
              <select className="input-field" value={provider} onChange={e => setProvider(e.target.value)}>
                {providers.length > 0 ? providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                )) : (
                  <>
                    <option value="gemini">Google Gemini</option>
                    <option value="claude">Anthropic Claude</option>
                    <option value="perplexity">Perplexity AI</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="label">Custom Instructions (optional)</label>
              <textarea
                className="input-field"
                rows={3}
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                placeholder="e.g. Focus on weekly growth metrics, use comparison tables..."
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={handleGenerate} disabled={loading} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Sparkles className="h-4 w-4" /> Generate with AI
            </button>
            <button onClick={handleSkipAI} disabled={loading} className="btn-secondary">
              Skip AI
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Generating */}
      {step === 3 && (
        <div className="card p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="h-20 w-20 rounded-2xl bg-green-50 flex items-center justify-center">
                <Brain className="h-10 w-10 text-green-600" />
              </div>
              <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-green-600 flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Generating your report...</h2>
              <p className="text-sm text-gray-500 mt-1">AI is analyzing your data and creating report sections</p>
            </div>
            <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-green-500 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
