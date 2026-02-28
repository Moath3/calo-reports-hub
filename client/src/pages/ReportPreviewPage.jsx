import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Globe, Edit, Loader2, Copy,
  FileDown, ExternalLink, CheckCircle, Printer, ImageDown, Lock, Shield
} from 'lucide-react';

function renderReportHTML(data, { collapsible = false } = {}) {
  const gi = data?.generalInfo || {};
  const brand = gi.brandColor || '#2BB573';
  const brandDark = '#1E8A57';
  const sections = data?.sections || [];

  const kpiCards = (gi.kpiStrip || data?.kpis || []).map(k => {
    const trendIcon = k.trend === 'up' ? '&#9650;' : k.trend === 'down' ? '&#9660;' : '&#8226;';
    const trendColor = k.trend === 'up' ? '#16a34a' : k.trend === 'down' ? '#dc2626' : '#6b7280';
    return `<div class="kpi-card">
      <div class="kpi-label">${k.label || ''}</div>
      <div class="kpi-value">${k.value || ''}</div>
      ${k.unit ? `<div class="kpi-unit">${k.unit}</div>` : ''}
      ${k.trend ? `<div style="font-size:11px;color:${trendColor};margin-top:4px"><span>${trendIcon}</span> ${k.change || k.trend}</div>` : ''}
    </div>`;
  }).join('');

  const renderBlock = (b) => {
    switch (b.type) {
      case 'badge': {
        const colors = { green: { bg: '#E8F8F0', border: '#2BB573', text: '#166534' }, amber: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' }, red: { bg: '#FEE2E2', border: '#EF4444', text: '#991B1B' }, blue: { bg: '#DBEAFE', border: '#3B82F6', text: '#1E40AF' } };
        const c = colors[b.style] || colors.green;
        return `<div style="background:${c.bg};border-left:4px solid ${c.border};border-radius:10px;padding:14px 18px;margin-bottom:14px">
          <div style="font-size:15px;font-weight:700;color:${c.text}">${b.title || b.label || ''}</div>
          ${b.subtitle ? `<div style="font-size:13px;color:${c.text};opacity:.8;margin-top:2px">${b.subtitle}</div>` : ''}
          ${b.period ? `<div style="font-size:12px;color:${c.text};opacity:.6;margin-top:4px">${b.period}</div>` : ''}
        </div>`;
      }
      case 'notes': {
        const items = b.items || (b.content ? b.content.split('\n').filter(Boolean) : (b.text ? [b.text] : []));
        return `<div style="margin-bottom:14px">${b.label ? `<div style="font-weight:600;margin-bottom:8px;color:#1A1D23;font-size:14px">${b.label}</div>` : ''}
          <ul style="margin:0;padding-left:20px;color:#5F6B7A;font-size:13.5px;line-height:1.85">
            ${items.map(it => `<li style="margin-bottom:4px">${it}</li>`).join('')}
          </ul></div>`;
      }
      case 'metrics':
        return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px;margin-bottom:14px">
          ${(b.items || []).map(m => {
            const tColor = m.trend === 'up' ? '#16a34a' : m.trend === 'down' ? '#dc2626' : '#6b7280';
            return `<div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)">
            <div style="font-size:11px;color:#5F6B7A;text-transform:uppercase;letter-spacing:.3px">${m.label || ''}</div>
            <div style="font-size:22px;font-weight:800;color:#1A1D23;margin-top:4px">${m.value || ''}</div>
            ${m.change ? `<div style="font-size:12px;color:${tColor};font-weight:600;margin-top:4px">${m.change}</div>` : ''}
          </div>`;
          }).join('')}</div>`;
      case 'table':
        return `<div style="overflow-x:auto;margin-bottom:14px;border-radius:10px;border:1px solid #E2E8F0;overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>${(b.headers || []).map(h => `<th style="background:${brand};color:white;padding:11px 14px;text-align:left;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.3px">${h}</th>`).join('')}</tr></thead>
          <tbody>${(b.rows || []).map((r, i) => `<tr class="trow" style="background:${i % 2 ? '#F8FAFB' : 'white'}">
            ${r.map(c => {
              const isNeg = typeof c === 'string' && c.startsWith('-');
              return `<td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;${isNeg ? 'color:#dc2626;font-weight:600' : ''}">${c}</td>`;
            }).join('')}
          </tr>`).join('')}</tbody></table></div>`;
      case 'keyvalue':
        return `<div style="margin-bottom:14px">${b.label ? `<div style="font-weight:600;margin-bottom:10px;color:#1A1D23;font-size:14px">${b.label}</div>` : ''}
          <div style="display:grid;gap:6px">${(b.items || []).map(kv =>
            `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#F8FAFB;border-radius:10px;border:1px solid #E2E8F0">
              <span style="color:#5F6B7A;font-size:13px">${kv.key || ''}</span>
              <span style="font-weight:700;color:#1A1D23;font-size:13px">${kv.value || ''}</span>
            </div>`).join('')}</div></div>`;
      case 'comparison':
        return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
          ${[{ title: b.leftTitle, rows: b.leftRows }, { title: b.rightTitle, rows: b.rightRows }].map(side =>
            `<div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)">
              <div style="font-weight:700;margin-bottom:10px;color:${brand};font-size:14px;padding-bottom:8px;border-bottom:2px solid ${brand}33">${side.title || ''}</div>
              ${(side.rows || []).map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #F1F5F9">
                <span style="color:#5F6B7A">${r.key || r.label || ''}</span><span style="font-weight:600;color:#1A1D23">${r.value || ''}</span>
              </div>`).join('')}</div>`).join('')}</div>`;
      case 'callout':
        return `<div style="background:linear-gradient(135deg,${b.bgColor || '#E8F8F0'},${b.bgColor || '#E8F8F0'}dd);border:2px solid ${b.borderColor || brand};border-radius:14px;padding:24px;text-align:center;margin-bottom:14px">
          ${b.icon ? `<div style="font-size:32px;margin-bottom:8px">${b.icon}</div>` : ''}
          <div style="font-size:14px;color:${b.textColor || '#166534'};font-weight:600">${b.title || ''}</div>
          <div style="font-size:30px;font-weight:800;color:${b.textColor || '#166534'};margin-top:6px">${b.value || ''}</div>
        </div>`;
      case 'image':
        return `<div style="margin-bottom:14px;text-align:center">
          <img src="${b.url || ''}" style="max-width:100%;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.08)" alt="${b.caption || ''}" />
          ${b.caption ? `<div style="font-size:12px;color:#5F6B7A;margin-top:8px">${b.caption}</div>` : ''}
        </div>`;
      case 'link':
        return `<div style="margin-bottom:14px;padding:14px 18px;background:#E8F8F0;border:1px solid #bbf7d0;border-radius:10px;display:flex;align-items:center;gap:12px">
          <div style="width:36px;height:36px;border-radius:10px;background:${brand};display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:white;font-size:16px">&#128279;</span></div>
          <div>
            <a href="${b.url || '#'}" target="_blank" rel="noopener noreferrer" style="color:${brand};font-weight:700;font-size:14px;text-decoration:none">${b.text || b.url || 'Link'}</a>
            ${b.description ? `<div style="font-size:12px;color:#5F6B7A;margin-top:2px">${b.description}</div>` : ''}
          </div>
        </div>`;
      case 'chart': {
        const cid = 'ch' + Math.random().toString(36).slice(2, 8);
        const cd = JSON.stringify({ type: b.chartType || 'bar', data: { labels: b.labels || [], datasets: b.datasets || [] } }).replace(/"/g, '&quot;');
        return `<div style="background:white;padding:20px;border-radius:12px;border:1px solid #E2E8F0;margin-bottom:14px"><div style="font-weight:700;margin-bottom:10px;color:#1A1D23">${b.title || 'Chart'}</div><canvas id="${cid}" data-chartcfg="${cd}"></canvas></div>`;
      }
      default: return '';
    }
  };

  const css = `
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Plus Jakarta Sans','DM Sans','Inter',system-ui,sans-serif;background:#F4F6F9;color:#1A1D23;line-height:1.6;-webkit-font-smoothing:antialiased}
    .ctr{max-width:960px;margin:0 auto;padding:28px 20px}
    .hdr{background:linear-gradient(135deg,${brand},${brandDark});color:white;padding:44px 40px 56px;border-radius:18px;margin-bottom:0;position:relative;overflow:hidden;box-shadow:0 4px 20px rgba(43,181,115,.25)}
    .hdr::before{content:'';position:absolute;top:-50%;right:-20%;width:70%;height:200%;background:radial-gradient(circle,rgba(255,255,255,.08) 0%,transparent 60%);pointer-events:none}
    .hdr::after{content:'';position:absolute;bottom:-40%;left:-10%;width:60%;height:160%;background:radial-gradient(circle,rgba(255,255,255,.05) 0%,transparent 50%);pointer-events:none}
    .hdr *{position:relative;z-index:1}
    .hdr h1{font-size:2rem;font-weight:800;letter-spacing:-.5px;margin-top:6px}
    .logo-text{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-weight:900;font-size:28px;letter-spacing:-1px;color:white;display:inline-block;text-shadow:0 2px 8px rgba(0,0,0,.12)}
    .kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px;margin-top:-32px;margin-bottom:28px;position:relative;z-index:2;padding:0 8px}
    .kpi-card{background:white;border-radius:14px;padding:18px;border:1px solid #E2E8F0;box-shadow:0 2px 8px rgba(0,0,0,.04);transition:transform .15s,box-shadow .15s;text-align:center}
    .kpi-card:hover{transform:translateY(-3px);box-shadow:0 6px 20px rgba(0,0,0,.08)}
    .kpi-label{font-size:11px;color:#5F6B7A;text-transform:uppercase;letter-spacing:.4px;font-weight:600}
    .kpi-value{font-size:24px;font-weight:800;color:#1A1D23;margin-top:4px}
    .kpi-unit{font-size:11px;color:#5F6B7A;margin-top:2px}
    .sec{background:white;border-radius:16px;border:1px solid #E2E8F0;overflow:hidden;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,.03)}
    .sec-hdr{display:flex;align-items:center;gap:12px;padding:16px 22px;cursor:pointer;user-select:none;transition:background .15s;position:relative}
    .sec-hdr:hover{background:#F8FAFB}
    .sec-hdr::after{content:'\\25BC';position:absolute;right:20px;top:50%;transform:translateY(-50%);font-size:11px;color:#9ca3af;transition:transform .2s}
    .sec-hdr.collapsed::after{transform:translateY(-50%) rotate(-90deg)}
    .sec-icon{width:40px;height:40px;border-radius:12px;background:${brand}15;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
    .sec-title{font-size:16px;font-weight:700;color:#1A1D23}
    .sec-body{padding:18px 22px;border-top:1px solid #E2E8F0;transition:max-height .3s ease,opacity .2s}
    .sec-body.hidden{max-height:0!important;opacity:0;padding:0 22px;overflow:hidden;border-top:none}
    .summary-box{background:linear-gradient(135deg,${brand}08,${brand}04);border:1px solid ${brand}30;border-radius:14px;padding:24px;margin-bottom:18px}
    .insight-item{padding:12px 18px;background:${brand}08;border-left:4px solid ${brand};margin-bottom:8px;border-radius:0 10px 10px 0;font-size:13.5px;color:#166534;line-height:1.6}
    .footer{text-align:center;padding:28px;color:#9ca3af;font-size:12px;display:flex;align-items:center;justify-content:center;gap:8px}
    .trow:hover{background:#E8F8F0!important}
    @media print{body{background:white}.ctr{padding:0;max-width:100%}.sec-hdr::after{display:none}.sec-body.hidden{max-height:none!important;opacity:1;padding:18px 22px;border-top:1px solid #E2E8F0}.kpi-card:hover{transform:none}}
    @media(max-width:768px){.kpi-grid{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:480px){.kpi-grid{grid-template-columns:repeat(2,1fr)}.hdr{padding:28px 24px 44px}.hdr h1{font-size:1.5rem}}
  `;

  const chartScript = `document.addEventListener("DOMContentLoaded",function(){
    document.querySelectorAll("canvas[data-chartcfg]").forEach(function(c){try{var d=JSON.parse(c.getAttribute("data-chartcfg"));new Chart(c,{type:d.type,data:d.data,options:{responsive:true,plugins:{legend:{labels:{font:{family:'Plus Jakarta Sans'}}}}}});}catch(e){}});
    ${collapsible ? `document.querySelectorAll(".sec-hdr").forEach(function(el){el.addEventListener("click",function(){this.classList.toggle("collapsed");var body=this.nextElementSibling;if(body)body.classList.toggle("hidden");});});` : ''}
  });`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>${gi.title || 'CALO Report'}</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800;900&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
    <style>${css}</style></head>
    <body><div class="ctr">
    <div class="hdr">
      <div class="logo-text">CALO</div>
      <h1>${gi.title || 'Report'}</h1>
      ${gi.reportDate ? `<div style="margin-top:8px;font-size:14px;opacity:.9">${gi.reportDate}</div>` : ''}
      ${gi.prevMonth ? `<div style="display:inline-block;margin-top:8px;padding:4px 14px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);border-radius:20px;font-size:12px">${gi.prevMonth}</div>` : ''}
      ${gi.companyName ? `<div style="margin-top:8px;font-size:13px;opacity:.7">${gi.companyName}</div>` : ''}
    </div>
    ${kpiCards ? `<div class="kpi-grid">${kpiCards}</div>` : ''}
    ${sections.map(s => `<div class="sec">
      <div class="sec-hdr">
        <div class="sec-icon">${s.icon || '📊'}</div>
        <div class="sec-title">${s.title || ''}</div>
      </div>
      <div class="sec-body">
        ${(s.blocks || []).map(renderBlock).join('')}
      </div>
    </div>`).join('')}
    ${data?.summary ? `<div class="summary-box">
      <h3 style="font-size:18px;font-weight:700;margin-bottom:12px;color:#1A1D23">Executive Summary</h3>
      <p style="color:#5F6B7A;line-height:1.8;font-size:14px">${data.summary}</p>
    </div>` : ''}
    ${(data?.insights || []).length ? `<div class="sec" style="overflow:visible">
      <div class="sec-hdr" style="cursor:default">
        <div class="sec-icon">💡</div>
        <div class="sec-title">Key Insights</div>
      </div>
      <div class="sec-body">
        ${data.insights.map(i => `<div class="insight-item">${i}</div>`).join('')}
      </div>
    </div>` : ''}
    <div class="footer">
      <span class="logo-text" style="font-size:16px;color:#9ca3af;text-shadow:none">CALO</span>
      <span>Reports Platform</span>
    </div>
    </div><script>${chartScript}<\/script></body></html>`;
}

export default function ReportPreviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const iframeRef = useRef(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingImg, setExportingImg] = useState(false);
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
      const html = renderReportHTML(report.report_data, { collapsible: true });
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

  const handleExportImage = async () => {
    if (!iframeRef.current) return;
    setExportingImg(true);
    toast('Generating image... This may take a moment.', { icon: '🖼️' });
    try {
      const iframeDoc = iframeRef.current.contentDocument;
      const body = iframeDoc.body;
      const container = iframeDoc.querySelector('.ctr') || body;

      // Temporarily expand sections if collapsed
      const hiddenSections = iframeDoc.querySelectorAll('.sec-body.hidden');
      hiddenSections.forEach(s => s.classList.remove('hidden'));

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#F4F6F9',
        width: container.scrollWidth,
        height: container.scrollHeight,
        windowWidth: 960,
        logging: false,
      });

      // Restore collapsed sections
      hiddenSections.forEach(s => s.classList.add('hidden'));

      canvas.toBlob((blob) => {
        if (!blob) { toast.error('Image generation failed'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${report.title || 'report'}.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Image exported!');
      }, 'image/png');
    } catch (err) {
      console.error('Image export error:', err);
      toast.error('Image export failed. Try PDF instead.');
    } finally {
      setExportingImg(false);
    }
  };

  const handleExportPDF = () => {
    if (!iframeRef.current) return;
    try {
      const iframeWin = iframeRef.current.contentWindow;
      iframeWin.focus();
      iframeWin.print();
    } catch {
      const html = renderReportHTML(report.report_data);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (w) {
        w.onload = () => { w.print(); setTimeout(() => URL.revokeObjectURL(url), 5000); };
      }
    }
  };

  const handleCopyHTML = () => {
    const html = renderReportHTML(report.report_data, { collapsible: true });
    navigator.clipboard.writeText(html).then(() => toast.success('HTML copied!'));
  };

  const handlePublish = async () => {
    const token = prompt('Enter your Netlify access token:');
    if (!token?.trim()) return;
    // Always require access code for published reports (security)
    const accessCode = prompt('Set an access code to protect this report (required for CALO confidentiality):');
    if (!accessCode?.trim()) {
      toast.error('Access code is required to publish. Reports must be protected.');
      return;
    }
    setPublishing(true);
    try {
      // Use server-side HTML builder with password protection
      const res1 = await api.request('/export/html', {
        method: 'POST',
        body: JSON.stringify({
          reportData: report.report_data,
          title: report.title,
          password: accessCode.trim()
        })
      });
      const html = res1.html;
      const slug = (report.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      const res = await api.deployNetlify(html, slug, token.trim());
      const url = res.url || res.netlifyUrl;
      if (url) {
        setNetlifyUrl(url);
        await api.updateReport(id, { netlifyUrl: url, status: 'published' });
        toast.success('Published with password protection!');
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
            <Copy className="h-4 w-4" /> Copy
          </button>
          <button onClick={handleExportImage} disabled={exportingImg} className="btn-secondary flex items-center gap-2 text-sm">
            {exportingImg ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />} Image
          </button>
          <button onClick={handleExportPDF} className="btn-secondary flex items-center gap-2 text-sm">
            <Printer className="h-4 w-4" /> PDF
          </button>
          <button onClick={handleExportHTML} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} HTML
          </button>
          <button onClick={handlePublish} disabled={publishing} className="btn-primary flex items-center gap-2 text-sm">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Lock className="h-4 w-4" /><Globe className="h-4 w-4 -ml-1" /></>} Publish
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
            <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
              <Shield className="h-3 w-3" /> Password Protected
            </span>
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
          sandbox="allow-same-origin allow-modals allow-scripts"
        />
      </div>
    </div>
  );
}
