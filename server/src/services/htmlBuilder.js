import { createHash } from 'crypto';

/**
 * Compute SHA-256 hash of a string (server-side).
 * The hash is embedded in the published HTML instead of the plaintext password.
 */
function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

/**
 * Build standalone HTML report with CALO branding.
 * @param {object} reportData - Report data (sections, kpis, summary, insights)
 * @param {string} brandColor - Brand color override
 * @param {string} title - Title override
 * @param {object} options - { password: string|null } — if set, wraps report in password gate
 */
export function buildStandaloneHTML(reportData, brandColor, title, options = {}) {
  const r = reportData || {};
  const gi = r.generalInfo || {};
  const color = brandColor || gi.brandColor || r.brandColor || "#02B376";
  const colorDark = "#027D53";
  const rt = title || gi.title || r.title || "Report";
  const accessPassword = options.password || null;

  function rb(b) {
    if (!b) return "";
    var h = "";
    if (b.type === "badge") {
      var cs = {
        green: { bg: "#E8F8F0", border: "#02B376", text: "#166534" },
        amber: { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E" },
        red:   { bg: "#FEE2E2", border: "#EF4444", text: "#991B1B" },
        blue:  { bg: "#DBEAFE", border: "#3B82F6", text: "#1E40AF" }
      };
      var c = cs[b.style] || cs.green;
      return '<div style="background:' + c.bg + ';border-left:4px solid ' + c.border + ';border-radius:10px;padding:14px 18px;margin-bottom:14px">' +
        '<div style="font-size:15px;font-weight:700;color:' + c.text + '">' + (b.title || b.label || '') + '</div>' +
        (b.subtitle ? '<div style="font-size:13px;color:' + c.text + ';opacity:.8;margin-top:2px">' + b.subtitle + '</div>' : '') +
        (b.period ? '<div style="font-size:12px;color:' + c.text + ';opacity:.6;margin-top:4px">' + b.period + '</div>' : '') +
        '</div>';
    }
    if (b.type === "notes") {
      var items = b.items || (b.content ? b.content.split('\n').filter(Boolean) : (b.text ? [b.text] : []));
      var label = b.label ? '<div style="font-weight:600;margin-bottom:8px;color:#1A1D23;font-size:14px">' + b.label + '</div>' : '';
      return '<div style="margin-bottom:14px">' + label +
        '<ul style="margin:0;padding-left:20px;color:#5F6B7A;font-size:13.5px;line-height:1.85">' +
        items.map(function(it) { return '<li style="margin-bottom:4px">' + it + '</li>'; }).join('') +
        '</ul></div>';
    }
    if (b.type === "metrics") {
      h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px;margin-bottom:14px">';
      (b.items || []).forEach(function(m) {
        var tc = m.trend === "up" ? "#16a34a" : m.trend === "down" ? "#dc2626" : "#6b7280";
        h += '<div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)">';
        h += '<div style="font-size:11px;color:#5F6B7A;text-transform:uppercase;letter-spacing:.3px">' + (m.label || '') + '</div>';
        h += '<div style="font-size:22px;font-weight:800;color:#1A1D23;margin-top:4px">' + (m.value || '') + '</div>';
        if (m.change) h += '<div style="font-size:12px;color:' + tc + ';font-weight:600;margin-top:4px">' + m.change + '</div>';
        h += '</div>';
      });
      return h + '</div>';
    }
    if (b.type === "table") {
      h = '<div style="overflow-x:auto;margin-bottom:14px;border-radius:10px;border:1px solid #E2E8F0;overflow:hidden">';
      h += '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>';
      (b.headers || []).forEach(function(hd) {
        h += '<th style="background:' + color + ';color:white;padding:11px 14px;text-align:left;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.3px">' + hd + '</th>';
      });
      h += '</tr></thead><tbody>';
      (b.rows || []).forEach(function(row, i) {
        h += '<tr class="trow" style="background:' + (i % 2 ? '#F8FAFB' : 'white') + '">';
        row.forEach(function(cell) {
          var isNeg = typeof cell === 'string' && cell.startsWith('-');
          h += '<td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;' + (isNeg ? 'color:#dc2626;font-weight:600' : '') + '">' + cell + '</td>';
        });
        h += '</tr>';
      });
      return h + '</tbody></table></div>';
    }
    if (b.type === "keyvalue") {
      var kvLabel = b.label ? '<div style="font-weight:600;margin-bottom:10px;color:#1A1D23;font-size:14px">' + b.label + '</div>' : '';
      h = '<div style="margin-bottom:14px">' + kvLabel + '<div style="display:grid;gap:6px">';
      (b.items || []).forEach(function(kv) {
        h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#F8FAFB;border-radius:10px;border:1px solid #E2E8F0">';
        h += '<span style="color:#5F6B7A;font-size:13px">' + (kv.key || '') + '</span>';
        h += '<span style="font-weight:700;color:#1A1D23;font-size:13px">' + (kv.value || '') + '</span></div>';
      });
      return h + '</div></div>';
    }
    if (b.type === "comparison") {
      h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">';
      [[b.leftTitle, b.leftRows], [b.rightTitle, b.rightRows]].forEach(function(pair) {
        h += '<div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)">';
        h += '<div style="font-weight:700;margin-bottom:10px;color:' + color + ';font-size:14px;padding-bottom:8px;border-bottom:2px solid ' + color + '33">' + (pair[0] || '') + '</div>';
        (pair[1] || []).forEach(function(rv) {
          h += '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #F1F5F9">';
          h += '<span style="color:#5F6B7A">' + (rv.key || rv.label || '') + '</span><span style="font-weight:600;color:#1A1D23">' + (rv.value || '') + '</span></div>';
        });
        h += '</div>';
      });
      return h + '</div>';
    }
    if (b.type === "callout") {
      return '<div style="background:linear-gradient(135deg,' + (b.bgColor || '#E8F8F0') + ',' + (b.bgColor || '#E8F8F0') + 'dd);border:2px solid ' + (b.borderColor || color) + ';border-radius:14px;padding:24px;text-align:center;margin-bottom:14px">' +
        (b.icon ? '<div style="font-size:32px;margin-bottom:8px">' + b.icon + '</div>' : '') +
        '<div style="font-size:14px;color:' + (b.textColor || '#166534') + ';font-weight:600">' + (b.title || '') + '</div>' +
        '<div style="font-size:30px;font-weight:800;color:' + (b.textColor || '#166534') + ';margin-top:6px">' + (b.value || '') + '</div></div>';
    }
    if (b.type === "chart") {
      var cid = "ch" + Math.random().toString(36).slice(2, 8);
      var cd = JSON.stringify({ type: b.chartType || "bar", data: { labels: b.labels || [], datasets: b.datasets || [] } }).replace(/"/g, "&quot;");
      return '<div style="background:white;padding:20px;border-radius:12px;border:1px solid #E2E8F0;margin-bottom:14px"><div style="font-weight:700;margin-bottom:10px;color:#1A1D23">' + (b.title || "Chart") + '</div><canvas id="' + cid + '" data-chartcfg="' + cd + '"></canvas></div>';
    }
    if (b.type === "link") {
      return '<div style="margin-bottom:14px;padding:14px 18px;background:#E8F8F0;border:1px solid #bbf7d0;border-radius:10px;display:flex;align-items:center;gap:12px">' +
        '<div style="width:36px;height:36px;border-radius:10px;background:' + color + ';display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:white;font-size:16px">&#128279;</span></div>' +
        '<div><a href="' + (b.url || '#') + '" target="_blank" rel="noopener noreferrer" style="color:' + color + ';font-weight:700;font-size:14px;text-decoration:none">' + (b.text || b.url || 'Link') + '</a>' +
        (b.description ? '<div style="font-size:12px;color:#5F6B7A;margin-top:2px">' + b.description + '</div>' : '') +
        '</div></div>';
    }
    if (b.type === "image") {
      return '<div style="margin-bottom:14px;text-align:center"><img src="' + (b.url || '') + '" style="max-width:100%;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.08)" alt="' + (b.caption || '') + '" />' +
        (b.caption ? '<div style="font-size:12px;color:#5F6B7A;margin-top:8px">' + b.caption + '</div>' : '') + '</div>';
    }
    return "";
  }

  var css = "*{margin:0;padding:0;box-sizing:border-box}";
  css += "body{font-family:'Lato','Inter',system-ui,sans-serif;background:#F4F6F9;color:#1A1D23;line-height:1.6;-webkit-font-smoothing:antialiased}";
  css += ".ctr{max-width:960px;margin:0 auto;padding:28px 20px}";
  css += ".hdr{background:linear-gradient(135deg," + color + "," + colorDark + ");color:white;padding:44px 40px 56px;border-radius:18px;margin-bottom:0;position:relative;overflow:hidden;box-shadow:0 4px 20px rgba(2,179,118,.25)}";
  css += ".hdr::before{content:'';position:absolute;top:-50%;right:-20%;width:70%;height:200%;background:radial-gradient(circle,rgba(255,255,255,.08) 0%,transparent 60%);pointer-events:none}";
  css += ".hdr::after{content:'';position:absolute;bottom:-40%;left:-10%;width:60%;height:160%;background:radial-gradient(circle,rgba(255,255,255,.05) 0%,transparent 50%);pointer-events:none}";
  css += ".hdr *{position:relative;z-index:1}";
  css += ".hdr h1{font-size:2rem;font-weight:800;letter-spacing:-.5px;margin-top:6px}";
  css += ".logo-text{font-family:'Lato','Inter',sans-serif;font-weight:900;font-size:28px;letter-spacing:-1px;color:white;display:inline-block;text-shadow:0 2px 8px rgba(0,0,0,.12)}";
  css += ".kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px;margin-top:-32px;margin-bottom:28px;position:relative;z-index:2;padding:0 8px}";
  css += ".kpi-card{background:white;border-radius:14px;padding:18px;border:1px solid #E2E8F0;box-shadow:0 2px 8px rgba(0,0,0,.04);transition:transform .15s,box-shadow .15s;text-align:center}";
  css += ".kpi-card:hover{transform:translateY(-3px);box-shadow:0 6px 20px rgba(0,0,0,.08)}";
  css += ".kpi-label{font-size:11px;color:#5F6B7A;text-transform:uppercase;letter-spacing:.4px;font-weight:600}";
  css += ".kpi-value{font-size:24px;font-weight:800;color:#1A1D23;margin-top:4px}";
  css += ".kpi-unit{font-size:11px;color:#5F6B7A;margin-top:2px}";
  css += ".sec{background:white;border-radius:16px;border:1px solid #E2E8F0;overflow:hidden;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,.03)}";
  css += ".sec-hdr{display:flex;align-items:center;gap:12px;padding:16px 22px;cursor:pointer;user-select:none;transition:background .15s;position:relative}";
  css += ".sec-hdr:hover{background:#F8FAFB}";
  css += ".sec-hdr::after{content:'\\25BC';position:absolute;right:20px;top:50%;transform:translateY(-50%);font-size:11px;color:#9ca3af;transition:transform .2s}";
  css += ".sec-hdr.collapsed::after{transform:translateY(-50%) rotate(-90deg)}";
  css += ".sec-icon{width:40px;height:40px;border-radius:12px;background:" + color + "15;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}";
  css += ".sec-title{font-size:16px;font-weight:700;color:#1A1D23}";
  css += ".sec-body{padding:18px 22px;border-top:1px solid #E2E8F0;transition:max-height .3s ease,opacity .2s}";
  css += ".sec-body.hidden{max-height:0!important;opacity:0;padding:0 22px;overflow:hidden;border-top:none}";
  css += ".summary-box{background:linear-gradient(135deg," + color + "08," + color + "04);border:1px solid " + color + "30;border-radius:14px;padding:24px;margin-bottom:18px}";
  css += ".insight-item{padding:12px 18px;background:" + color + "08;border-left:4px solid " + color + ";margin-bottom:8px;border-radius:0 10px 10px 0;font-size:13.5px;color:#166534;line-height:1.6}";
  css += ".footer{text-align:center;padding:28px;color:#9ca3af;font-size:12px;display:flex;align-items:center;justify-content:center;gap:8px}";
  css += ".trow:hover{background:#E8F8F0!important}";
  css += "@media print{body{background:white}.ctr{padding:0;max-width:100%}.sec-hdr::after{display:none}.sec-body.hidden{max-height:none!important;opacity:1;padding:18px 22px;border-top:1px solid #E2E8F0}.kpi-card:hover{transform:none}}";
  css += "@media(max-width:768px){.kpi-grid{grid-template-columns:repeat(3,1fr)}}";
  css += "@media(max-width:480px){.kpi-grid{grid-template-columns:repeat(2,1fr)}.hdr{padding:28px 24px 44px}.hdr h1{font-size:1.5rem}}";

  // Password gate CSS
  if (accessPassword) {
    css += ".pw-gate{position:fixed;inset:0;background:#F4F6F9;z-index:9999;display:flex;align-items:center;justify-content:center}";
    css += ".pw-box{background:white;border-radius:18px;padding:40px;max-width:400px;width:90%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.1);border:1px solid #E2E8F0}";
    css += ".pw-box .logo-text{color:" + color + ";font-size:32px;text-shadow:none;margin-bottom:6px}";
    css += ".pw-box h2{font-size:18px;font-weight:700;color:#1A1D23;margin-bottom:4px}";
    css += ".pw-box p{font-size:13px;color:#5F6B7A;margin-bottom:20px}";
    css += ".pw-box input{width:100%;padding:12px 16px;border:2px solid #E2E8F0;border-radius:12px;font-size:14px;outline:none;transition:border-color .2s;font-family:inherit}";
    css += ".pw-box input:focus{border-color:" + color + "}";
    css += ".pw-box button{width:100%;padding:12px;background:" + color + ";color:white;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;margin-top:12px;transition:background .2s;font-family:inherit}";
    css += ".pw-box button:hover{background:" + colorDark + "}";
    css += ".pw-err{color:#dc2626;font-size:13px;margin-top:8px;display:none}";
    css += ".pw-notice{font-size:11px;color:#9ca3af;margin-top:16px}";
  }

  var chartScript = 'document.addEventListener("DOMContentLoaded",function(){';
  chartScript += 'document.querySelectorAll("canvas[data-chartcfg]").forEach(function(c){try{var d=JSON.parse(c.getAttribute("data-chartcfg"));new Chart(c,{type:d.type,data:d.data,options:{responsive:true,plugins:{legend:{labels:{font:{family:"Lato"}}}}}});}catch(e){}});';
  chartScript += 'document.querySelectorAll(".sec-hdr").forEach(function(el){el.addEventListener("click",function(){this.classList.toggle("collapsed");var body=this.nextElementSibling;if(body)body.classList.toggle("hidden");});});';
  chartScript += '});';

  // Password gate script — uses SHA-256 hashing so the password isn't in plaintext
  var pwScript = '';
  if (accessPassword) {
    // Hash the password using a simple client-side approach
    // We store a SHA-256 hash of the password, then compare on input
    pwScript = `
    (function(){
      var gate=document.getElementById('pw-gate');
      var content=document.getElementById('pw-content');
      var input=document.getElementById('pw-input');
      var btn=document.getElementById('pw-btn');
      var err=document.getElementById('pw-err');
      if(!gate||!content)return;
      content.style.display='none';
      async function hashStr(s){var e=new TextEncoder().encode(s);var h=await crypto.subtle.digest('SHA-256',e);return Array.from(new Uint8Array(h)).map(function(b){return b.toString(16).padStart(2,'0')}).join('');}
      async function check(){
        var val=input.value.trim();
        if(!val){err.style.display='block';err.textContent='Please enter the access code.';return;}
        var h=await hashStr(val);
        if(h===gate.getAttribute('data-h')){
          gate.style.display='none';
          content.style.display='block';
          sessionStorage.setItem('calo-pw-ok','1');
        }else{
          err.style.display='block';
          err.textContent='Incorrect access code. Please try again.';
          input.value='';
          input.focus();
        }
      }
      if(sessionStorage.getItem('calo-pw-ok')==='1'){gate.style.display='none';content.style.display='block';return;}
      btn.addEventListener('click',check);
      input.addEventListener('keydown',function(e){if(e.key==='Enter')check();});
      input.focus();
    })();`;
  }

  // Support both flat and generalInfo structures
  var reportTitle = gi.title || r.title || rt;
  var reportDate = gi.reportDate || r.reportDate || '';
  var reportSubtitle = gi.subtitle || r.subtitle || '';
  var prevMonth = gi.prevMonth || '';
  var companyName = gi.companyName || '';
  var kpis = gi.kpiStrip || r.kpis || [];
  var sections = r.sections || [];
  var summary = r.summary || '';
  var insights = r.insights || [];

  var o = "";
  o += '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">';
  o += '<meta name="robots" content="noindex,nofollow">';
  o += "<title>" + reportTitle + "<\/title>";
  o += '<link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">';
  o += '<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>';
  o += "<style>" + css + "<\/style><\/head><body>";

  // Password gate overlay (if enabled)
  if (accessPassword) {
    // Compute SHA-256 hash of password to embed (not plaintext)
    var hashHex = sha256(accessPassword);
    o += '<div id="pw-gate" class="pw-gate" data-h="' + hashHex + '">';
    o += '<div class="pw-box">';
    o += '<div class="logo-text">CALO<\/div>';
    o += '<h2>Confidential Report<\/h2>';
    o += '<p>This report is restricted to authorized CALO personnel only.<\/p>';
    o += '<input id="pw-input" type="password" placeholder="Enter access code" autocomplete="off" />';
    o += '<button id="pw-btn">View Report<\/button>';
    o += '<div id="pw-err" class="pw-err"><\/div>';
    o += '<div class="pw-notice">&#128274; Protected by CALO Reports Platform<\/div>';
    o += '<\/div><\/div>';
  }

  o += '<div id="pw-content" class="ctr">';

  // Header
  o += '<div class="hdr">';
  o += '<div class="logo-text">CALO<\/div>';
  o += '<h1>' + reportTitle + '<\/h1>';
  if (reportDate) o += '<div style="margin-top:8px;font-size:14px;opacity:.9">' + reportDate + '<\/div>';
  if (prevMonth) o += '<div style="display:inline-block;margin-top:8px;padding:4px 14px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);border-radius:20px;font-size:12px">' + prevMonth + '<\/div>';
  if (companyName) o += '<div style="margin-top:8px;font-size:13px;opacity:.7">' + companyName + '<\/div>';
  if (reportSubtitle) o += '<div style="font-size:16px;opacity:.9;margin-top:6px">' + reportSubtitle + '<\/div>';
  o += '<\/div>';

  // KPI Grid
  if (kpis && kpis.length) {
    o += '<div class="kpi-grid">';
    kpis.forEach(function(k) {
      var trendIcon = k.trend === 'up' ? '&#9650;' : k.trend === 'down' ? '&#9660;' : '&#8226;';
      var trendColor = k.trend === 'up' ? '#16a34a' : k.trend === 'down' ? '#dc2626' : '#6b7280';
      o += '<div class="kpi-card">';
      o += '<div class="kpi-label">' + (k.label || '') + '<\/div>';
      o += '<div class="kpi-value">' + (k.value || '') + '<\/div>';
      if (k.unit) o += '<div class="kpi-unit">' + k.unit + '<\/div>';
      if (k.trend) o += '<div style="font-size:11px;color:' + trendColor + ';margin-top:4px"><span>' + trendIcon + '</span> ' + (k.change || k.trend) + '<\/div>';
      o += '<\/div>';
    });
    o += '<\/div>';
  }

  // Sections
  sections.forEach(function(s) {
    o += '<div class="sec">';
    o += '<div class="sec-hdr">';
    o += '<div class="sec-icon">' + (s.icon || '&#128202;') + '<\/div>';
    o += '<div class="sec-title">' + (s.title || '') + '<\/div>';
    o += '<\/div>';
    o += '<div class="sec-body">';
    (s.blocks || []).forEach(function(b) { o += rb(b); });
    o += '<\/div><\/div>';
  });

  // Executive Summary
  if (summary) {
    o += '<div class="summary-box">';
    o += '<h3 style="font-size:18px;font-weight:700;margin-bottom:12px;color:#1A1D23">Executive Summary<\/h3>';
    o += '<p style="color:#5F6B7A;line-height:1.8;font-size:14px">' + summary + '<\/p><\/div>';
  }

  // Key Insights
  if (insights && insights.length) {
    o += '<div class="sec" style="overflow:visible">';
    o += '<div class="sec-hdr" style="cursor:default">';
    o += '<div class="sec-icon">&#128161;<\/div>';
    o += '<div class="sec-title">Key Insights<\/div>';
    o += '<\/div><div class="sec-body">';
    insights.forEach(function(i) { o += '<div class="insight-item">' + i + '<\/div>'; });
    o += '<\/div><\/div>';
  }

  // Footer
  o += '<div class="footer">';
  o += '<span class="logo-text" style="font-size:16px;color:#9ca3af;text-shadow:none">CALO<\/span>';
  o += '<span>Reports Platform<\/span>';
  o += '<\/div>';

  o += "<\/div>";
  o += "<script>" + chartScript + "<\/script>";
  if (accessPassword) {
    o += "<script>" + pwScript + "<\/script>";
  }
  o += "<\/body><\/html>";
  return o;
}

