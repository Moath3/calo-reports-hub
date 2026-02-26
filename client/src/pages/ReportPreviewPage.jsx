import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Download, Globe, Edit, Loader2, Copy,
  FileDown, ExternalLink, CheckCircle
} from 'lucide-react';

function renderReportHTML(data) {
  const gi = data?.generalInfo || {};
  const brand = gi.brandColor || '#22c55e';
  const sections = data?.sections || [];

  const kpiHTML = (gi.kpiStrip || []).map(k =>
    `<div style="text-align:center;padding:12px 16px"><div style="font-size:11px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:0.5px">${k.label||''}</div><div style="font-size:22px;font-weight:700;margin-top:2px">${k.value||''}</div></div>`
  ).join('');

  const renderBlock = (b) => {
    switch (b.type) {
      case 'badge':
        return `<div style="background:${brand};color:white;padding:16px 20px;border-radius:12px;margin-bottom:12px">
          <div style="font-size:18px;font-weight:700">${b.title||''}</div>
          ${b.subtitle?`<div style="font-size:13px;opacity:0.9;margin-top:2px">${b.subtitle}</div>`:''}
          ${b.period?`<div style="font-size:12px;opacity:0.7;margin-top:4px">${b.period}</div>`:''}
        </div>`;
      case 'notes':
        return `<div style="margin-bottom:12px">${b.label?`<div style="font-weight:600;margin-bottom:6px;color:#374151">${b.label}</div>`:''}
          <ul style="margin:0;padding-left:20px;color:#4b5563;font-size:14px;line-height:1.8">
            ${(b.items||[b.text||'']).map(it => `<li>${it}</li>`).join('')}
          </ul></div>`;
      case 'metrics':
        return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:12px">
          ${(b.items||[]).map(m => `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px">
            <div style="font-size:12px;color:#6b7280">${m.label||''}</div>
            <div style="font-size:22px;font-weight:700;color:#111827;margin-top:2px">${m.value||''}</div>
            ${m.change?`<div style="font-size:12px;color:${String(m.change).startsWith('-')?'#dc2626':'#16a34a'};margin-top:2px">${m.change}</div>`:''}
          </div>`).join('')}</div>`;
      case 'table':
        return `<div style="overflow-x:auto;margin-bottom:12px"><table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>${(b.headers||[]).map(h => `<th style="background:${brand};color:white;padding:10px 12px;text-align:left;font-weight:600">${h}</th>`).join('')}</tr></thead>
          <tbody>${(b.rows||[]).map((r,i) => `<tr style="background:${i%2?'#f9fafb':'white'}">
            ${r.map(c => `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${c}</td>`).join('')}
          </tr>`).join('')}</tbody></table></div>`;
      case 'keyvalue':
        return `<div style="margin-bottom:12px">${b.label?`<div style="font-weight:600;margin-bottom:8px;color:#374151">${b.label}</div>`:''}
          <div style="display:grid;gap:6px">${(b.items||[]).map(kv =>
            `<div style="display:flex;justify-content:space-between;padding:8px 12px;background:#f9fafb;border-radius:8px">
              <span style="color:#6b7280;font-size:13px">${kv.key||''}</span>
              <span style="font-weight:600;color:#111827;font-size:13px">${kv.value||''}</span>
            </div>`).join('')}</div></div>`;
      case 'comparison':
        return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          ${[{title:b.leftTitle,rows:b.leftRows,style:b.leftStyle},{title:b.rightTitle,rows:b.rightRows,style:b.rightStyle}].map(side =>
            `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px">
              <div style="font-weight:600;margin-bottom:8px;color:${brand}">${side.title||''}</div>
              ${(side.rows||[]).map(r => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
                <span style="color:#6b7280">${r.key||r.label||''}</span><span style="font-weight:600">${r.value||''}</span>
              </div>`).join('')}</div>`).join('')}</div>`;
      case 'callout':
        return `<div style="background:${b.bgColor||'#f0fdf4'};border:2px solid ${b.borderColor||brand};border-radius:12px;padding:20px;text-align:center;margin-bottom:12px">
          ${b.icon?`<div style="font-size:28px;margin-bottom:6px">${b.icon}</div>`:''}
          <div style="font-size:14px;color:${b.textColor||'#166534'};font-weight:600">${b.title||''}</div>
          <div style="font-size:28px;font-weight:700;color:${b.textColor||'#166534'};margin-top:4px">${b.value||''}</div>
        </div>`;
      case 'image':
        return `<div style="margin-bottom:12px;text-align:center">
          <img src="${b.url||''}" style="max-width:100%;border-radius:8px" alt="${b.caption||''}" />
          ${b.caption?`<div style="font-size:12px;color:#6b7280;margin-top:6px">${b.caption}</div>`:''}
        </div>`;
      default:
        return `<div style="padding:12px;background:#fef3c7;border-radius:8px;font-size:13px;margin-bottom:12px">Unknown block: ${b.type}</div>`;
    }
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${gi.title||'Report'}</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1f2937}
    .container{max-width:900px;margin:0 auto;padding:24px}</style></head>
    <body><div class="container">
    ${gi.title?`<div style="background:linear-gradient(135deg,${brand},${brand}dd);color:white;padding:32px;border-radius:16px;margin-bottom:24px">
      <h1 style="font-size:28px;font-weight:800">${gi.title}</h1>
      ${gi.reportDate?`<div style="margin-top:6px;opacity:0.9;font-size:14px">${gi.reportDate}</div>`:''}
      ${gi.prevMonth?`<div style="margin-top:4px;opacity:0.7;font-size:13px">${gi.prevMonth}</div>`:''}
      ${gi.companyName?`<div style="margin-top:8px;font-size:13px;opacity:0.8">${gi.companyName}</div>`:''}
    </div>`:''}
    ${kpiHTML?`<div style="background:${brand};color:white;border-radius:12px;display:flex;justify-content:space-around;padding:8px;margin-bottom:24px;flex-wrap:wrap">${kpiHTML}</div>`:''}
    ${sections.map(s => `<div style="margin-bottom:28px">
      ${s.title?`<h2 style="font-size:20px;font-weight:700;color:#111827;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid ${brand}">${s.title}</h2>`:''}
      ${(s.blocks||[]).map(renderBlock).join('')}
    </div>`).join('')}
    <div style="text-align:center;padding:24px;color:#9ca3af;font-size:12px">Generated by CALO Reports Platform</div>
    </div></body></html>`;
}

export default function ReportPreviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const iframeRef = useRef(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [netlifyUrl, setNetlifyUrl] = useState('');

  useEffect(() => {
    api.getReport(id)
      .then(res => {
        setReport(res.report);
        setNetlifyUrl(res.report.netlify_url || '');
      })
      .catch(() => { toast.error('Report not found'); navigate('/reports'); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => {
    if (report && iframeRef.current) {
      const html = renderReportHTML(report.report_data);
      const doc = iframeRef.current.contentDocument;
      doc.open();
      doc.write(html);
      doc.close();
    }
  }, [report]);

  const handleExportHTML = async () => {
    setExporting(true);
    try {
      const html = renderReportHTML(report.report_data);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.title || 'report'}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('HTML exported!');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleCopyHTML = () => {
    const html = renderReportHTML(report.report_data);
    navigator.clipboard.writeText(html).then(() => toast.success('HTML copied!'));
  };

  const handlePublish = async () => {
    const token = prompt('Enter your Netlify access token:');
    if (!token?.trim()) return;
    setPublishing(true);
    try {
      const html = renderReportHTML(report.report_data);
      const slug = (report.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      const res = await api.deployNetlify(html, slug, token.trim());
      const url = res.url || res.netlifyUrl;
      if (url) {
        setNetlifyUrl(url);
        await api.updateReport(id, { netlifyUrl: url, status: 'published' });
        toast.success('Published to Netlify!');
      }
    } catch (err) {
      toast.error(err.message || 'Publish failed');
    } finally {
      setPublishing(false);
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
        <button onClick={() => navigate(`/reports/${id}`)} className="btn-ghost p-2 self-start">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{report.title}</h1>
          <p className="text-sm text-gray-500">Preview & Export</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button onClick={() => navigate(`/reports/${id}`)} className="btn-secondary flex items-center gap-2 text-sm">
            <Edit className="h-4 w-4" /> Edit
          </button>
          <button onClick={handleCopyHTML} className="btn-secondary flex items-center gap-2 text-sm">
            <Copy className="h-4 w-4" /> Copy HTML
          </button>
          <button onClick={handleExportHTML} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Export
          </button>
          <button onClick={handlePublish} disabled={publishing} className="btn-primary flex items-center gap-2 text-sm">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />} Publish
          </button>
        </div>
      </div>

      {/* Published URL */}
      {netlifyUrl && (
        <div className="card p-3 flex items-center gap-3 bg-green-50 border-green-200">
          <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0 text-sm">
            <span className="text-green-800 font-medium">Published: </span>
            <a href={netlifyUrl} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline truncate">
              {netlifyUrl}
            </a>
          </div>
          <a href={netlifyUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost p-1.5 text-green-600">
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      )}

      {/* Preview iframe */}
      <div className="card overflow-hidden" style={{ height: 'calc(100vh - 260px)', minHeight: '500px' }}>
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          title="Report Preview"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
