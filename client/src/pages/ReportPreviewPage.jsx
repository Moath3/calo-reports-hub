import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Globe, Edit, Loader2, Copy,
  FileDown, ExternalLink, CheckCircle, CheckCircle2, Printer, ImageDown, Lock, Shield, Users, LockKeyhole, CircleDot, Share2, Search, UserCheck, X, Sliders
} from 'lucide-react';

// XSS guard for the client-side fallback renderer. Mirrors server htmlBuilder's
// escapeHtml/safeUrl (the client can't import the server module). Escapes text
// before it goes into this same-origin preview iframe / downloadable HTML.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function safeUrl(u, opts) {
  opts = opts || {};
  const raw = String(u == null ? '' : u).trim();
  const probe = raw.replace(/[\x00-\x20]+/g, '').toLowerCase();
  if (opts.allowImageData && /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,/.test(probe)) {
    return escapeHtml(raw);
  }
  if (/^(javascript|vbscript|data):/.test(probe)) return opts.fallback || '';
  return escapeHtml(raw);
}

function renderReportHTML(data, { collapsible = false } = {}) {
  const gi = data?.generalInfo || {};
  const brand = gi.brandColor || '#02B376';
  const brandDark = '#027D53';
  const sections = data?.sections || [];

  const kpiCards = (gi.kpiStrip || data?.kpis || []).map(k => {
    const trendIcon = k.trend === 'up' ? '&#9650;' : k.trend === 'down' ? '&#9660;' : '&#8226;';
    const trendColor = k.trend === 'up' ? '#16a34a' : k.trend === 'down' ? '#dc2626' : '#6b7280';
    return `<div class="kpi-card">
      <div class="kpi-label">${escapeHtml(k.label || '')}</div>
      <div class="kpi-value">${escapeHtml(k.value || '')}</div>
      ${k.unit ? `<div class="kpi-unit">${escapeHtml(k.unit)}</div>` : ''}
      ${k.trend ? `<div style="font-size:11px;color:${trendColor};margin-top:4px"><span>${trendIcon}</span> ${escapeHtml(k.change || k.trend)}</div>` : ''}
    </div>`;
  }).join('');

  const renderBlock = (b) => {
    switch (b.type) {
      case 'badge': {
        const colors = { green: { bg: '#E8F8F0', border: '#02B376', text: '#166534' }, amber: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' }, red: { bg: '#FEE2E2', border: '#EF4444', text: '#991B1B' }, blue: { bg: '#DBEAFE', border: '#3B82F6', text: '#1E40AF' } };
        const c = colors[b.style] || colors.green;
        return `<div style="background:${c.bg};border-left:4px solid ${c.border};border-radius:10px;padding:14px 18px;margin-bottom:14px">
          <div style="font-size:15px;font-weight:700;color:${c.text}">${escapeHtml(b.title || b.label || '')}</div>
          ${b.subtitle ? `<div style="font-size:13px;color:${c.text};opacity:.8;margin-top:2px">${escapeHtml(b.subtitle)}</div>` : ''}
          ${b.period ? `<div style="font-size:12px;color:${c.text};opacity:.6;margin-top:4px">${escapeHtml(b.period)}</div>` : ''}
        </div>`;
      }
      case 'notes': {
        const items = b.items || (b.content ? b.content.split('\n').filter(Boolean) : (b.text ? [b.text] : []));
        return `<div style="margin-bottom:14px">${b.label ? `<div style="font-weight:600;margin-bottom:8px;color:#1A1D23;font-size:14px">${escapeHtml(b.label)}</div>` : ''}
          <ul style="margin:0;padding-left:20px;color:#5F6B7A;font-size:13.5px;line-height:1.85">
            ${items.map(it => `<li style="margin-bottom:4px">${escapeHtml(it)}</li>`).join('')}
          </ul></div>`;
      }
      case 'metrics':
        return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px;margin-bottom:14px">
          ${(b.items || []).map(m => {
            const tColor = m.trend === 'up' ? '#16a34a' : m.trend === 'down' ? '#dc2626' : '#6b7280';
            return `<div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)">
            <div style="font-size:11px;color:#5F6B7A;text-transform:uppercase;letter-spacing:.3px">${escapeHtml(m.label || '')}</div>
            <div style="font-size:22px;font-weight:800;color:#1A1D23;margin-top:4px">${escapeHtml(m.value || '')}</div>
            ${m.change ? `<div style="font-size:12px;color:${tColor};font-weight:600;margin-top:4px">${escapeHtml(m.change)}</div>` : ''}
          </div>`;
          }).join('')}</div>`;
      case 'table':
        return `<div style="overflow-x:auto;margin-bottom:14px;border-radius:10px;border:1px solid #E2E8F0;overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>${(b.headers || []).map(h => `<th style="background:${brand};color:white;padding:11px 14px;text-align:left;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.3px">${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>${(b.rows || []).map((r, i) => `<tr class="trow" style="background:${i % 2 ? '#F8FAFB' : 'white'}">
            ${r.map(c => {
              const isNeg = typeof c === 'string' && c.startsWith('-');
              return `<td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;${isNeg ? 'color:#dc2626;font-weight:600' : ''}">${escapeHtml(c)}</td>`;
            }).join('')}
          </tr>`).join('')}</tbody></table></div>`;
      case 'keyvalue':
        return `<div style="margin-bottom:14px">${b.label ? `<div style="font-weight:600;margin-bottom:10px;color:#1A1D23;font-size:14px">${escapeHtml(b.label)}</div>` : ''}
          <div style="display:grid;gap:6px">${(b.items || []).map(kv =>
            `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#F8FAFB;border-radius:10px;border:1px solid #E2E8F0">
              <span style="color:#5F6B7A;font-size:13px">${escapeHtml(kv.key || '')}</span>
              <span style="font-weight:700;color:#1A1D23;font-size:13px">${escapeHtml(kv.value || '')}</span>
            </div>`).join('')}</div></div>`;
      case 'comparison':
        return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
          ${[{ title: b.leftTitle, rows: b.leftRows }, { title: b.rightTitle, rows: b.rightRows }].map(side =>
            `<div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)">
              <div style="font-weight:700;margin-bottom:10px;color:${brand};font-size:14px;padding-bottom:8px;border-bottom:2px solid ${brand}33">${escapeHtml(side.title || '')}</div>
              ${(side.rows || []).map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #F1F5F9">
                <span style="color:#5F6B7A">${escapeHtml(r.key || r.label || '')}</span><span style="font-weight:600;color:#1A1D23">${escapeHtml(r.value || '')}</span>
              </div>`).join('')}</div>`).join('')}</div>`;
      case 'callout':
        return `<div style="background:linear-gradient(135deg,${b.bgColor || '#E8F8F0'},${b.bgColor || '#E8F8F0'}dd);border:2px solid ${b.borderColor || brand};border-radius:14px;padding:24px;text-align:center;margin-bottom:14px">
          ${b.icon ? `<div style="font-size:32px;margin-bottom:8px">${escapeHtml(b.icon)}</div>` : ''}
          <div style="font-size:14px;color:${b.textColor || '#166534'};font-weight:600">${escapeHtml(b.title || '')}</div>
          <div style="font-size:30px;font-weight:800;color:${b.textColor || '#166534'};margin-top:6px">${escapeHtml(b.value || '')}</div>
        </div>`;
      case 'image':
        return `<div style="margin-bottom:14px;text-align:center">
          <img src="${safeUrl(b.url, { allowImageData: true })}" style="max-width:100%;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.08)" alt="${escapeHtml(b.caption || '')}" />
          ${b.caption ? `<div style="font-size:12px;color:#5F6B7A;margin-top:8px">${escapeHtml(b.caption)}</div>` : ''}
        </div>`;
      case 'link':
        return `<div style="margin-bottom:14px;padding:14px 18px;background:#E8F8F0;border:1px solid #bbf7d0;border-radius:10px;display:flex;align-items:center;gap:12px">
          <div style="width:36px;height:36px;border-radius:10px;background:${brand};display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:white;font-size:16px">&#128279;</span></div>
          <div>
            <a href="${safeUrl(b.url, { fallback: '#' })}" target="_blank" rel="noopener noreferrer" style="color:${brand};font-weight:700;font-size:14px;text-decoration:none">${escapeHtml(b.text || b.url || 'Link')}</a>
            ${b.description ? `<div style="font-size:12px;color:#5F6B7A;margin-top:2px">${escapeHtml(b.description)}</div>` : ''}
          </div>
        </div>`;
      case 'chart': {
        const cid = 'ch' + Math.random().toString(36).slice(2, 8);
        const cd = JSON.stringify({ type: b.chartType || 'bar', data: { labels: b.labels || [], datasets: b.datasets || [] } }).replace(/"/g, '&quot;');
        return `<div style="background:white;padding:20px;border-radius:12px;border:1px solid #E2E8F0;margin-bottom:14px"><div style="font-weight:700;margin-bottom:10px;color:#1A1D23">${escapeHtml(b.title || 'Chart')}</div><canvas id="${cid}" data-chartcfg="${cd}"></canvas></div>`;
      }
      default: return '';
    }
  };

  const css = `
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Lato','Inter',system-ui,sans-serif;background:#F4F6F9;color:#1A1D23;line-height:1.6;-webkit-font-smoothing:antialiased}
    .ctr{max-width:960px;margin:0 auto;padding:28px 20px}
    .hdr{background:linear-gradient(135deg,${brand},${brandDark});color:white;padding:44px 40px 56px;border-radius:18px;margin-bottom:0;position:relative;overflow:hidden;box-shadow:0 4px 20px rgba(2,179,118,.25)}
    .hdr::before{content:'';position:absolute;top:-50%;right:-20%;width:70%;height:200%;background:radial-gradient(circle,rgba(255,255,255,.08) 0%,transparent 60%);pointer-events:none}
    .hdr::after{content:'';position:absolute;bottom:-40%;left:-10%;width:60%;height:160%;background:radial-gradient(circle,rgba(255,255,255,.05) 0%,transparent 50%);pointer-events:none}
    .hdr *{position:relative;z-index:1}
    .hdr h1{font-size:2rem;font-weight:800;letter-spacing:-.5px;margin-top:6px}
    .logo-text{font-family:'Lato','Inter',sans-serif;font-weight:900;font-size:28px;letter-spacing:-1px;color:white;display:inline-block;text-shadow:0 2px 8px rgba(0,0,0,.12)}
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
    document.querySelectorAll("canvas[data-chartcfg]").forEach(function(c){try{var d=JSON.parse(c.getAttribute("data-chartcfg"));new Chart(c,{type:d.type,data:d.data,options:{responsive:true,plugins:{legend:{labels:{font:{family:'Lato'}}}}}});}catch(e){}});
    ${collapsible ? `document.querySelectorAll(".sec-hdr").forEach(function(el){el.addEventListener("click",function(){this.classList.toggle("collapsed");var body=this.nextElementSibling;if(body)body.classList.toggle("hidden");});});` : ''}
  });`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>${escapeHtml(gi.title || 'CALO Report')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
    <style>${css}</style></head>
    <body><div class="ctr">
    <div class="hdr">
      <div style="margin-bottom:4px"><svg viewBox="0 0 746 320" height="44" style="display:inline-block;vertical-align:middle" xmlns="http://www.w3.org/2000/svg"><g fill="white"><path d="M89.2,299.5c-18.1,0-33.5-6.3-46.1-19s-18.9-28-18.9-46v-149c0-18,6.4-33.4,19.1-46 c12.7-12.7,28.1-19,45.9-19c18.1,0,33.4,6.4,46,19.1c12.6,12.7,18.9,28,18.9,46v31h-42.5V84.8c0-6.6-2.3-12.2-6.9-16.8 s-10.2-6.9-16.8-6.9c-6.5,0-12,2.3-16.6,6.9c-4.6,4.6-6.9,10.2-6.9,16.8v149.4c0,6.6,2.3,12.1,6.9,16.7c4.6,4.6,10.1,6.9,16.6,6.9 c6.6,0,12.2-2.3,16.8-6.9s6.9-10.2,6.9-16.7v-37.5h42.5v37.9c0,18.1-6.4,33.5-19.1,46C122.3,293.2,107,299.5,89.2,299.5z"/><path d="M260.7,233.5l-10,62.5h-42.7l46.1-272.1h56.5l45.5,272.1h-43l-9.7-62.5H260.7z M282.2,86.3L267,193.6h30.4 L282.2,86.3z"/><path d="M533.3,296.1H421.4V23.9h41v231.4h70.9L533.3,296.1L533.3,296.1z"/><path d="M656.7,20.6c18.1,0,33.5,6.4,46.2,19.1s19,28.1,19,46.1v148.4c0,18.1-6.4,33.5-19.1,46.2 c-12.7,12.7-28.1,19-46.1,19s-33.3-6.4-45.9-19.1c-12.6-12.7-18.9-28.1-18.9-46.1V85.9c0-18.1,6.4-33.5,19.1-46.2 C623.7,27,639,20.6,656.7,20.6z M679,85.1c0-6.6-2.3-12.1-6.8-16.6c-4.5-4.5-10.1-6.8-16.6-6.8c-6.5,0-12,2.3-16.6,6.8 S632,78.5,632,85.1V234c0,6.5,2.3,12,6.9,16.5s10.2,6.9,16.6,6.9c6.6,0,12.1-2.3,16.6-6.9c4.5-4.6,6.8-10.1,6.8-16.5V85.1z"/></g></svg></div>
      <h1>${escapeHtml(gi.title || 'Report')}</h1>
      ${gi.reportDate ? `<div style="margin-top:8px;font-size:14px;opacity:.9">${escapeHtml(gi.reportDate)}</div>` : ''}
      ${gi.prevMonth ? `<div style="display:inline-block;margin-top:8px;padding:4px 14px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);border-radius:20px;font-size:12px">${escapeHtml(gi.prevMonth)}</div>` : ''}
      ${gi.companyName ? `<div style="margin-top:8px;font-size:13px;opacity:.7">${escapeHtml(gi.companyName)}</div>` : ''}
    </div>
    ${kpiCards ? `<div class="kpi-grid">${kpiCards}</div>` : ''}
    ${sections.map(s => `<div class="sec">
      <div class="sec-hdr">
        <div class="sec-icon">${escapeHtml(s.icon || '📊')}</div>
        <div class="sec-title">${escapeHtml(s.title || '')}</div>
      </div>
      <div class="sec-body">
        ${(s.blocks || []).map(renderBlock).join('')}
      </div>
    </div>`).join('')}
    ${data?.summary ? `<div class="summary-box">
      <h3 style="font-size:18px;font-weight:700;margin-bottom:12px;color:#1A1D23">Executive Summary</h3>
      <p style="color:#5F6B7A;line-height:1.8;font-size:14px">${escapeHtml(data.summary)}</p>
    </div>` : ''}
    ${(data?.insights || []).length ? `<div class="sec" style="overflow:visible">
      <div class="sec-hdr" style="cursor:default">
        <div class="sec-icon">💡</div>
        <div class="sec-title">Key Insights</div>
      </div>
      <div class="sec-body">
        ${data.insights.map(i => `<div class="insight-item">${escapeHtml(i)}</div>`).join('')}
      </div>
    </div>` : ''}
    <div class="footer">
      <svg viewBox="0 0 746 320" height="18" style="display:inline-block;vertical-align:middle" xmlns="http://www.w3.org/2000/svg"><g fill="#9ca3af"><path d="M89.2,299.5c-18.1,0-33.5-6.3-46.1-19s-18.9-28-18.9-46v-149c0-18,6.4-33.4,19.1-46 c12.7-12.7,28.1-19,45.9-19c18.1,0,33.4,6.4,46,19.1c12.6,12.7,18.9,28,18.9,46v31h-42.5V84.8c0-6.6-2.3-12.2-6.9-16.8 s-10.2-6.9-16.8-6.9c-6.5,0-12,2.3-16.6,6.9c-4.6,4.6-6.9,10.2-6.9,16.8v149.4c0,6.6,2.3,12.1,6.9,16.7c4.6,4.6,10.1,6.9,16.6,6.9 c6.6,0,12.2-2.3,16.8-6.9s6.9-10.2,6.9-16.7v-37.5h42.5v37.9c0,18.1-6.4,33.5-19.1,46C122.3,293.2,107,299.5,89.2,299.5z"/><path d="M260.7,233.5l-10,62.5h-42.7l46.1-272.1h56.5l45.5,272.1h-43l-9.7-62.5H260.7z M282.2,86.3L267,193.6h30.4 L282.2,86.3z"/><path d="M533.3,296.1H421.4V23.9h41v231.4h70.9L533.3,296.1L533.3,296.1z"/><path d="M656.7,20.6c18.1,0,33.5,6.4,46.2,19.1s19,28.1,19,46.1v148.4c0,18.1-6.4,33.5-19.1,46.2 c-12.7,12.7-28.1,19-46.1,19s-33.3-6.4-45.9-19.1c-12.6-12.7-18.9-28.1-18.9-46.1V85.9c0-18.1,6.4-33.5,19.1-46.2 C623.7,27,639,20.6,656.7,20.6z M679,85.1c0-6.6-2.3-12.1-6.8-16.6c-4.5-4.5-10.1-6.8-16.6-6.8c-6.5,0-12,2.3-16.6,6.8 S632,78.5,632,85.1V234c0,6.5,2.3,12,6.9,16.5s10.2,6.9,16.6,6.9c6.6,0,12.1-2.3,16.6-6.9c4.5-4.6,6.8-10.1,6.8-16.5V85.1z"/></g></svg>
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
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [isOwner, setIsOwner] = useState(true);
  const [status, setStatus] = useState('draft');
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [shareUsers, setShareUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [shareSearch, setShareSearch] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareAll, setShareAll] = useState(false);

  // Tweak panel — modular report styling
  const [showTweaks, setShowTweaks] = useState(false);
  const [variant, setVariant] = useState('editorial');
  const [brandColor, setBrandColor] = useState('#02B376');
  const [density, setDensity] = useState('comfortable');
  const [pageWidth, setPageWidth] = useState('medium');
  const [showHero, setShowHero] = useState(true);
  const [showKpis, setShowKpis] = useState(true);
  const [showSummary, setShowSummary] = useState(true);
  const [showSections, setShowSections] = useState(true);
  const [showInsights, setShowInsights] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  const [densifySections, setDensifySections] = useState(false);
  const [savingTweaks, setSavingTweaks] = useState(false);

  useEffect(() => {
    api.getReport(id)
      .then(res => {
        setReport(res.report);
        setNetlifyUrl(res.report.netlify_url || '');
        setVisibility(res.report.visibility || 'private');
        setIsOwner(res.report.is_owner !== false);
        setStatus(res.report.status || 'draft');
        const sw = res.report.shared_with || [];
        setSelectedUsers(Array.isArray(sw) ? sw : []);
        setShareAll(res.report.visibility === 'shared');
        const gi = res.report.report_data?.generalInfo || {};
        const v = (gi.variant || 'editorial').toLowerCase();
        setVariant(v);
        setBrandColor(gi.brandColor || '#02B376');
        // Variant-aware tweak defaults
        const presets = {
          editorial: { density: 'spacious',    pageWidth: 'medium', densifySections: false },
          dashboard: { density: 'compact',     pageWidth: 'wide',   densifySections: true  },
          minimal:   { density: 'comfortable', pageWidth: 'narrow', densifySections: false },
          brief:     { density: 'comfortable', pageWidth: 'narrow', densifySections: false },
        };
        const preset = presets[v] || presets.editorial;
        const saved = gi.tweaks || {};
        setDensity(saved.density || preset.density);
        setPageWidth(saved.pageWidth || preset.pageWidth);
        setShowHero(saved.showHero ?? true);
        setShowKpis(saved.showKpis ?? true);
        setShowSummary(saved.showSummary ?? true);
        setShowSections(saved.showSections ?? (v !== 'brief'));
        setShowInsights(saved.showInsights ?? true);
        setShowFooter(saved.showFooter ?? true);
        setDensifySections(saved.densifySections ?? preset.densifySections);
      })
      .catch(() => { toast.error('Report not found'); navigate('/reports'); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => {
    if (!report || !iframeRef.current) return;
    let cancelled = false;
    const tweaks = {
      density, pageWidth,
      showHero, showKpis, showSummary, showSections, showInsights, showFooter,
      densifySections,
    };
    api.exportHTML(report.report_data, brandColor, report.title, null, variant, tweaks)
      .then(res => {
        if (cancelled || !iframeRef.current) return;
        const doc = iframeRef.current.contentDocument;
        doc.open(); doc.write(res.html); doc.close();
      })
      .catch(() => {
        if (cancelled || !iframeRef.current) return;
        const html = renderReportHTML(report.report_data);
        const doc = iframeRef.current.contentDocument;
        doc.open(); doc.write(html); doc.close();
      });
    return () => { cancelled = true; };
  }, [report, variant, brandColor, density, pageWidth, showHero, showKpis, showSummary, showSections, showInsights, showFooter, densifySections]);

  const currentTweaks = () => ({
    density, pageWidth, showHero, showKpis, showSummary, showSections, showInsights, showFooter, densifySections,
  });

  const handleExportHTML = async () => {
    setExporting(true);
    try {
      const res = await api.exportHTML(report.report_data, brandColor, report.title, null, variant, currentTweaks());
      const blob = new Blob([res.html], { type: 'text/html' });
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

  const handleCopyHTML = async () => {
    try {
      const res = await api.exportHTML(report.report_data, brandColor, report.title, null, variant, currentTweaks());
      await navigator.clipboard.writeText(res.html);
      toast.success('HTML copied!');
    } catch {
      toast.error('Copy failed');
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      // Build HTML with optional password protection + selected variant
      const password = accessCode.trim() || undefined;
      const res1 = await api.exportHTML(report.report_data, brandColor, report.title, password, variant, currentTweaks());
      const html = res1.html;
      const slug = (report.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      // Pass reportId so backend reuses existing Netlify site on republish
      const res = await api.deployNetlify(html, slug, id);
      const url = res.url || res.netlifyUrl;
      if (url) {
        setNetlifyUrl(url);
        setStatus('published');
        setShowPublishPanel(false);
        setAccessCode('');
        toast.success(password ? 'Published with password protection!' : 'Published successfully!');
      }
    } catch (err) {
      toast.error(err.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      await api.updateReportStatus(id, newStatus);
      setStatus(newStatus);
      toast.success(`Report marked as ${newStatus}`);
    } catch (err) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  const handleOpenSharePanel = async () => {
    setShowSharePanel(!showSharePanel);
    if (!showSharePanel && shareUsers.length === 0) {
      try {
        const res = await api.getUsersForShare();
        setShareUsers(res.users || []);
      } catch (err) {
        console.error('Failed to load users:', err);
      }
    }
  };

  const handleShareSave = async () => {
    setShareLoading(true);
    try {
      let newVis, sw;
      if (shareAll) { newVis = 'shared'; sw = []; }
      else if (selectedUsers.length > 0) { newVis = 'specific'; sw = selectedUsers; }
      else { newVis = 'private'; sw = []; }
      const res = await api.shareReport(id, { visibility: newVis, sharedWith: sw });
      setVisibility(res.visibility);
      setSelectedUsers(res.sharedWith || []);
      setShowSharePanel(false);
      if (newVis === 'shared') toast.success('Shared with all team members');
      else if (newVis === 'specific') toast.success('Shared with ' + selectedUsers.length + ' user(s)');
      else toast.success('Report set to private');
    } catch (err) {
      toast.error(err.message || 'Failed to update sharing');
    } finally {
      setShareLoading(false);
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => prev.includes(userId) ? prev.filter(x => x !== userId) : [...prev, userId]);
  };

  const filteredShareUsers = shareUsers.filter(u =>
    !shareSearch || u.name.toLowerCase().includes(shareSearch.toLowerCase()) || u.email.toLowerCase().includes(shareSearch.toLowerCase())
  );

  // Persist all tweaks into report.generalInfo.tweaks
  const handleSaveTweaks = async () => {
    if (!isOwner) { toast.error('Only the owner can change tweaks'); return; }
    setSavingTweaks(true);
    try {
      const newData = {
        ...report.report_data,
        generalInfo: {
          ...(report.report_data?.generalInfo || {}),
          variant, brandColor,
          tweaks: currentTweaks(),
        },
      };
      await api.updateReport(id, { title: report.title, description: report.description, reportData: newData });
      setReport(prev => ({ ...prev, report_data: newData }));
      toast.success('Tweaks saved');
      setShowTweaks(false);
    } catch (err) {
      toast.error(err.message || 'Failed to save');
    } finally { setSavingTweaks(false); }
  };

  // When user switches variant, apply that variant's preset to sensible defaults
  const applyVariant = (v) => {
    setVariant(v);
    const presets = {
      editorial: { density: 'spacious',    pageWidth: 'medium', showSections: true,  densifySections: false },
      dashboard: { density: 'compact',     pageWidth: 'wide',   showSections: true,  densifySections: true  },
      minimal:   { density: 'comfortable', pageWidth: 'narrow', showSections: true,  densifySections: false },
      brief:     { density: 'comfortable', pageWidth: 'narrow', showSections: false, densifySections: false },
    };
    const p = presets[v] || presets.editorial;
    setDensity(p.density);
    setPageWidth(p.pageWidth);
    setShowSections(p.showSections);
    setDensifySections(p.densifySections);
  };

  const variantOptions = [
    { id: 'editorial', label: 'Editorial',  desc: 'Magazine — long-form, expressive, all the depth' },
    { id: 'dashboard', label: 'Dashboard',  desc: 'Compact — tight grid, summarized, data-first' },
    { id: 'minimal',   label: 'Minimal',    desc: 'Paper — print-ready, quiet, no decoration' },
    { id: 'brief',     label: 'Brief',      desc: 'One-pager — KPIs + summary + insights' },
  ];

  const densityOptions = [
    { id: 'compact',     label: 'Compact' },
    { id: 'comfortable', label: 'Comfortable' },
    { id: 'spacious',    label: 'Spacious' },
  ];

  const widthOptions = [
    { id: 'narrow', label: 'Narrow', px: '760' },
    { id: 'medium', label: 'Medium', px: '960' },
    { id: 'wide',   label: 'Wide',   px: '1120' },
  ];

  const colorPresets = [
    { c: '#02B376', name: 'Calo green' },
    { c: '#027D53', name: 'Forest' },
    { c: '#0A1F17', name: 'Ink' },
    { c: '#4F7CD9', name: 'Ocean' },
    { c: '#E8A33D', name: 'Ember' },
    { c: '#8C2929', name: 'Burgundy' },
  ];

  // Only meaningful toggles given variant
  const toggleList = [
    { key: 'showHero',     label: 'Hero',     value: showHero,     set: setShowHero },
    { key: 'showKpis',     label: 'KPIs',     value: showKpis,     set: setShowKpis },
    { key: 'showSummary',  label: 'Summary',  value: showSummary,  set: setShowSummary },
    { key: 'showSections', label: 'Sections', value: showSections, set: setShowSections, disabled: variant === 'brief' },
    { key: 'showInsights', label: 'Insights', value: showInsights, set: setShowInsights },
    { key: 'showFooter',   label: 'Footer',   value: showFooter,   set: setShowFooter },
  ];

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
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900 truncate">{report.title}</h1>
            {isOwner && (
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                visibility === 'shared' ? 'bg-blue-100 text-blue-700' :
                visibility === 'specific' ? 'bg-purple-100 text-purple-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                {visibility === 'shared' ? <Users className="h-3 w-3" /> : visibility === 'specific' ? <UserCheck className="h-3 w-3" /> : <LockKeyhole className="h-3 w-3" />}
                {visibility === 'shared' ? 'Team' : visibility === 'specific' ? selectedUsers.length + ' users' : 'Private'}
              </span>
            )}
            {!isOwner && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
                <Users className="h-3 w-3" /> Shared by {report.author_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-500">Preview & Export</p>
            {isOwner && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                status === 'done' ? 'bg-blue-100 text-blue-700' :
                status === 'published' ? 'bg-green-100 text-green-700' :
                status === 'archived' ? 'bg-gray-100 text-gray-600' :
                'bg-amber-100 text-amber-700'
              }`}>
                <CircleDot className="h-3 w-3" /> {status}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {isOwner && status !== 'done' && status !== 'published' && (
            <button onClick={() => handleStatusChange('done')} className="btn-secondary flex items-center gap-2 text-sm text-blue-600 border-blue-200 hover:bg-blue-50">
              <CheckCircle2 className="h-4 w-4" /> Mark Done
            </button>
          )}
          {isOwner && status === 'done' && (
            <button onClick={() => handleStatusChange('draft')} className="btn-secondary flex items-center gap-2 text-sm text-gray-500">
              <CircleDot className="h-4 w-4" /> Back to Draft
            </button>
          )}
          <button onClick={() => navigate(`/reports/${id}`)} className="btn-secondary flex items-center gap-2 text-sm">
            <Edit className="h-4 w-4" /> Edit
          </button>
          {isOwner && (
            <button
              onClick={() => setShowTweaks(v => !v)}
              className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full transition-colors"
              style={{
                background: showTweaks ? 'var(--ink-900)' : '#fff',
                color: showTweaks ? '#fff' : 'var(--ink-900)',
                border: showTweaks ? '1px solid var(--ink-900)' : '1px solid var(--ink-200)',
              }}
            >
              <Sliders className="h-4 w-4" /> Tweaks
            </button>
          )}
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
          {isOwner && (
            <button onClick={handleOpenSharePanel} className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
              showSharePanel ? 'bg-green-600 text-white' :
              visibility !== 'private' ? 'bg-green-100 text-green-700 hover:bg-green-200 border border-green-300' :
              'btn-secondary text-green-600 border-green-200 hover:bg-green-50'
            }`}>
              <Share2 className="h-4 w-4" /> Share
            </button>
          )}
          <button onClick={() => setShowPublishPanel(!showPublishPanel)} disabled={publishing} className="btn-primary flex items-center gap-2 text-sm">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />} Publish
          </button>
        </div>
      </div>

      {/* Tweak Panel — modular report styling */}
      {showTweaks && isOwner && (
        <div style={{
          background: '#fff', borderRadius: 'var(--r-lg)',
          border: '1px solid var(--ink-200)',
          boxShadow: 'var(--shadow-md)', padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Sliders className="h-4 w-4" style={{ color: 'var(--calo-700)' }} />
            <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.01em' }}>Tweaks</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', background: 'var(--calo-50)', color: 'var(--calo-800)', border: '1px solid var(--calo-100)', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>Live preview</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowTweaks(false)} style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-500)' }}>
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 1. Layout (full-width — it's the primary control) */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-500)', marginBottom: 10 }}>
              Layout
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
              {variantOptions.map(v => {
                const active = variant === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => applyVariant(v.id)}
                    style={{
                      textAlign: 'left', padding: '12px 14px',
                      border: active ? '1px solid var(--calo-500)' : '1px solid var(--ink-200)',
                      background: active ? 'var(--calo-50)' : '#fff',
                      borderRadius: 'var(--r-sm)', cursor: 'pointer',
                      transition: 'all .15s ease',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 900, color: active ? 'var(--calo-800)' : 'var(--ink-900)', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {active && <CheckCircle2 className="h-3 w-3" />}
                      {v.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 4, lineHeight: 1.35 }}>{v.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Density + Page width (two-col) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-500)', marginBottom: 10 }}>
                Density
              </div>
              <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--ink-100)', borderRadius: 999 }}>
                {densityOptions.map(d => (
                  <button
                    key={d.id}
                    onClick={() => setDensity(d.id)}
                    style={{
                      flex: 1, padding: '7px 12px', fontSize: 12, fontWeight: 700,
                      borderRadius: 999, border: 'none', cursor: 'pointer',
                      background: density === d.id ? 'var(--ink-900)' : 'transparent',
                      color: density === d.id ? '#fff' : 'var(--ink-600)',
                      transition: 'all .15s',
                    }}
                  >{d.label}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-500)', marginBottom: 10 }}>
                Page width
              </div>
              <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--ink-100)', borderRadius: 999 }}>
                {widthOptions.map(w => (
                  <button
                    key={w.id}
                    onClick={() => setPageWidth(w.id)}
                    style={{
                      flex: 1, padding: '7px 12px', fontSize: 12, fontWeight: 700,
                      borderRadius: 999, border: 'none', cursor: 'pointer',
                      background: pageWidth === w.id ? 'var(--ink-900)' : 'transparent',
                      color: pageWidth === w.id ? '#fff' : 'var(--ink-600)',
                      transition: 'all .15s',
                    }}
                  >{w.label} <span style={{ opacity: .6, fontSize: 10 }}>{w.px}</span></button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Accent color */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-500)', marginBottom: 10 }}>
              Accent color
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {colorPresets.map(p => {
                const active = brandColor.toLowerCase() === p.c.toLowerCase();
                return (
                  <button
                    key={p.c}
                    onClick={() => setBrandColor(p.c)}
                    title={p.name}
                    style={{
                      padding: 4, border: active ? '2px solid var(--ink-900)' : '1px solid var(--ink-200)',
                      borderRadius: 10, background: '#fff', cursor: 'pointer',
                    }}
                  >
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: p.c }} />
                  </button>
                );
              })}
              <div style={{ width: 1, height: 32, background: 'var(--ink-200)', marginInline: 4 }} />
              <input
                type="color"
                value={brandColor}
                onChange={e => setBrandColor(e.target.value)}
                style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--ink-200)', cursor: 'pointer', padding: 0 }}
              />
              <input
                value={brandColor}
                onChange={e => setBrandColor(e.target.value)}
                className="input-field"
                style={{ flex: 1, minWidth: 110, maxWidth: 180 }}
                placeholder="#02B376"
              />
            </div>
          </div>

          {/* 4. Section visibility + densify */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-500)', marginBottom: 10 }}>
              Show in report
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {toggleList.map(t => (
                <button
                  key={t.key}
                  onClick={() => !t.disabled && t.set(!t.value)}
                  disabled={t.disabled}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 999,
                    fontSize: 12, fontWeight: 700,
                    background: t.disabled ? 'var(--ink-50)' : (t.value ? 'var(--calo-50)' : '#fff'),
                    color: t.disabled ? 'var(--ink-400)' : (t.value ? 'var(--calo-800)' : 'var(--ink-600)'),
                    border: t.value ? '1px solid var(--calo-200)' : '1px solid var(--ink-200)',
                    cursor: t.disabled ? 'not-allowed' : 'pointer',
                    transition: 'all .15s',
                  }}
                  title={t.disabled ? `Not available in ${variant} layout` : ''}
                >
                  <span style={{
                    width: 12, height: 12, borderRadius: 2,
                    background: t.value && !t.disabled ? 'var(--calo-500)' : 'transparent',
                    border: t.value && !t.disabled ? 'none' : '1px solid var(--ink-300)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 9, fontWeight: 900,
                  }}>{t.value && !t.disabled ? '✓' : ''}</span>
                  {t.label}
                </button>
              ))}
            </div>
            {/* Densify toggle (only on variants where it's meaningful) */}
            {(variant === 'dashboard' || variant === 'editorial') && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', fontSize: 12, color: 'var(--ink-600)', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={densifySections}
                  onChange={e => setDensifySections(e.target.checked)}
                  style={{ accentColor: 'var(--calo-500)' }}
                />
                <span>Summarize sections (keep data blocks, trim long notes)</span>
              </label>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, paddingTop: 14, borderTop: '1px solid var(--ink-100)' }}>
            <button
              onClick={handleSaveTweaks}
              disabled={savingTweaks}
              className="btn-primary"
              style={{ flex: 1 }}
            >
              {savingTweaks ? 'Saving…' : 'Save tweaks'}
            </button>
            <button
              onClick={() => applyVariant('editorial')}
              className="btn-secondary"
              title="Reset all tweaks to Editorial defaults"
            >
              Reset
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 8, textAlign: 'center' }}>
            Preview updates live. Save locks changes into published exports, Netlify, and password-gated copies.
          </div>
        </div>
      )}

      {/* Share Panel */}
      {showSharePanel && isOwner && (
        <div className="card p-5 border-green-200 bg-green-50/50 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-base">
              <Share2 className="h-5 w-5 text-green-600" /> Share Report
            </h3>
            <button onClick={() => setShowSharePanel(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Share with all toggle */}
          <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
            <div>
              <div className="font-medium text-sm text-gray-900">Share with All Team Members</div>
              <div className="text-xs text-gray-500 mt-0.5">Everyone in the organization can view this report</div>
            </div>
            <button
              onClick={() => { setShareAll(!shareAll); if (!shareAll) setSelectedUsers([]); }}
              className={`relative w-11 h-6 rounded-full transition-colors ${shareAll ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${shareAll ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          {/* Specific users section */}
          {!shareAll && (
            <div className="space-y-3">
              <div className="text-sm font-medium text-gray-700">Or share with specific people:</div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  className="input-field pl-9 text-sm"
                  placeholder="Search users by name or email..."
                  value={shareSearch}
                  onChange={e => setShareSearch(e.target.value)}
                />
              </div>

              {/* User list */}
              <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-200 rounded-lg bg-white p-1">
                {filteredShareUsers.length === 0 ? (
                  <div className="text-sm text-gray-400 text-center py-4">No users found</div>
                ) : filteredShareUsers.map(user => (
                  <label
                    key={user.id}
                    className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      selectedUsers.includes(user.id) ? 'bg-green-50 border border-green-200' : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(user.id)}
                      onChange={() => toggleUserSelection(user.id)}
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{user.name}</div>
                      <div className="text-xs text-gray-500 truncate">{user.email}</div>
                    </div>
                    {user.department && (
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full shrink-0">{user.department}</span>
                    )}
                  </label>
                ))}
              </div>

              {selectedUsers.length > 0 && (
                <div className="text-xs text-green-600 font-medium">{selectedUsers.length} user(s) selected</div>
              )}
            </div>
          )}

          {/* Save button */}
          <button
            onClick={handleShareSave}
            disabled={shareLoading}
            className="btn-primary flex items-center justify-center gap-2 w-full"
          >
            {shareLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            {shareLoading ? 'Saving...' : shareAll ? 'Share with Everyone' : selectedUsers.length > 0 ? 'Share with ' + selectedUsers.length + ' User(s)' : 'Make Private'}
          </button>
        </div>
      )}

      {/* Publish Panel */}
      {showPublishPanel && (
        <div className="card p-4 border-blue-200 bg-blue-50/50 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-600" /> Publish to Netlify
            </h3>
            <button onClick={() => setShowPublishPanel(false)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Access Code <span className="text-gray-400 font-normal">(optional — leave empty for no password)</span>
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. calo2026"
              value={accessCode}
              onChange={e => setAccessCode(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">If set, viewers must enter this code to see the report.</p>
          </div>
          <button onClick={handlePublish} disabled={publishing} className="btn-primary flex items-center gap-2">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            {publishing ? 'Publishing...' : accessCode.trim() ? 'Publish with Password' : 'Publish Now'}
          </button>
        </div>
      )}

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
