import { createHash } from 'crypto';

function sha256(str) { return createHash('sha256').update(str).digest('hex'); }

// Official CALO logo SVG paths
const LOGO_PATHS = [
  'M89.2,299.5c-18.1,0-33.5-6.3-46.1-19s-18.9-28-18.9-46v-149c0-18,6.4-33.4,19.1-46 c12.7-12.7,28.1-19,45.9-19c18.1,0,33.4,6.4,46,19.1c12.6,12.7,18.9,28,18.9,46v31h-42.5V84.8c0-6.6-2.3-12.2-6.9-16.8 s-10.2-6.9-16.8-6.9c-6.5,0-12,2.3-16.6,6.9c-4.6,4.6-6.9,10.2-6.9,16.8v149.4c0,6.6,2.3,12.1,6.9,16.7c4.6,4.6,10.1,6.9,16.6,6.9 c6.6,0,12.2-2.3,16.8-6.9s6.9-10.2,6.9-16.7v-37.5h42.5v37.9c0,18.1-6.4,33.5-19.1,46C122.3,293.2,107,299.5,89.2,299.5z',
  'M260.7,233.5l-10,62.5h-42.7l46.1-272.1h56.5l45.5,272.1h-43l-9.7-62.5H260.7z M282.2,86.3L267,193.6h30.4 L282.2,86.3z',
  'M533.3,296.1H421.4V23.9h41v231.4h70.9L533.3,296.1L533.3,296.1z',
  'M656.7,20.6c18.1,0,33.5,6.4,46.2,19.1s19,28.1,19,46.1v148.4c0,18.1-6.4,33.5-19.1,46.2 c-12.7,12.7-28.1,19-46.1,19s-33.3-6.4-45.9-19.1c-12.6-12.7-18.9-28.1-18.9-46.1V85.9c0-18.1,6.4-33.5,19.1-46.2 C623.7,27,639,20.6,656.7,20.6z M679,85.1c0-6.6-2.3-12.1-6.8-16.6c-4.5-4.5-10.1-6.8-16.6-6.8c-6.5,0-12,2.3-16.6,6.8 S632,78.5,632,85.1V234c0,6.5,2.3,12,6.9,16.5s10.2,6.9,16.6,6.9c6.6,0,12.1-2.3,16.6-6.9c4.5-4.6,6.8-10.1,6.8-16.5V85.1z',
];

function caloLogoSvg(fill, height) {
  const paths = LOGO_PATHS.map(d => `<path d="${d}"/>`).join('');
  return `<svg viewBox="0 0 746 320" height="${height}" style="display:inline-block;vertical-align:middle" xmlns="http://www.w3.org/2000/svg"><g fill="${fill}">${paths}</g></svg>`;
}

// ─── Shared block renderer (reused across all variants) ──────────────────────

function renderBlock(b, color, colorDark) {
  if (!b) return "";
  var h = "";
  if (b.type === "badge") {
    var cs = {
      green: { bg: "#E6F9F1", border: "#02B376", text: "#016040" },
      amber: { bg: "#FEF5E4", border: "#E8A33D", text: "#8A5A1A" },
      red:   { bg: "#FDECEC", border: "#D94F4F", text: "#8C2929" },
      blue:  { bg: "#E9EEFA", border: "#4F7CD9", text: "#2E4699" }
    };
    var c = cs[b.style] || cs.green;
    return '<div style="background:' + c.bg + ';border-left:4px solid ' + c.border + ';border-radius:14px;padding:18px 22px;margin-bottom:16px">' +
      '<div style="font-size:15px;font-weight:900;color:' + c.text + ';letter-spacing:-0.01em">' + (b.title || b.label || '') + '</div>' +
      (b.subtitle ? '<div style="font-size:13px;color:' + c.text + ';opacity:.82;margin-top:3px">' + b.subtitle + '</div>' : '') +
      (b.period ? '<div style="font-size:11px;color:' + c.text + ';opacity:.7;margin-top:5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">' + b.period + '</div>' : '') +
      '</div>';
  }
  if (b.type === "notes") {
    var items = b.items || (b.content ? b.content.split('\n').filter(Boolean) : (b.text ? [b.text] : []));
    var label = b.label ? '<div style="font-size:11px;font-weight:900;color:' + color + ';letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px">' + b.label + '</div>' : '';
    return '<div style="margin-bottom:16px">' + label +
      '<ul style="margin:0;padding-left:22px;color:#2F332C;font-size:15px;line-height:1.7;font-weight:300">' +
      items.map(function(it) { return '<li style="margin-bottom:6px">' + it + '</li>'; }).join('') +
      '</ul></div>';
  }
  if (b.type === "metrics") {
    h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-bottom:16px">';
    (b.items || []).forEach(function(m) {
      var tc = m.trend === "up" ? "#029A66" : m.trend === "down" ? "#D94F4F" : "#787C72";
      h += '<div style="background:#FAFAF7;border:1px solid #E8E9E3;border-radius:14px;padding:16px 18px">';
      h += '<div style="font-size:11px;color:#787C72;text-transform:uppercase;letter-spacing:.1em;font-weight:900">' + (m.label || '') + '</div>';
      h += '<div class="num" style="font-size:26px;font-weight:900;color:#0A1F17;margin-top:6px;letter-spacing:-0.03em">' + (m.value || '') + '</div>';
      if (m.change) h += '<div style="font-size:12px;color:' + tc + ';font-weight:700;margin-top:4px">' + m.change + '</div>';
      h += '</div>';
    });
    return h + '</div>';
  }
  if (b.type === "table") {
    var headerCols = (b.headers || []).length || 1;
    h = '<div style="margin-bottom:16px;border-radius:14px;border:1px solid #E8E9E3;overflow:hidden">';
    h += '<div style="display:grid;grid-template-columns:repeat(' + headerCols + ', 1fr);background:#0A1F17;color:#fff;padding:14px 20px;font-size:11px;font-weight:900;letter-spacing:.1em;text-transform:uppercase">';
    (b.headers || []).forEach(function(hd) { h += '<span>' + hd + '</span>'; });
    h += '</div>';
    (b.rows || []).forEach(function(row, i) {
      var cols = row.length || 1;
      h += '<div class="trow" style="display:grid;grid-template-columns:repeat(' + cols + ', 1fr);padding:14px 20px;border-bottom:' + (i < (b.rows || []).length - 1 ? '1px solid #F4F4F0' : 'none') + ';background:' + (i % 2 ? '#FAFAF7' : '#fff') + ';align-items:center">';
      row.forEach(function(cell) {
        var isNeg = typeof cell === 'string' && cell.startsWith('-');
        var isPos = typeof cell === 'string' && /^[+↑]/.test(cell);
        h += '<span class="num" style="font-size:14px;font-weight:700;' + (isNeg ? 'color:#D94F4F;' : '') + (isPos ? 'color:' + color + ';font-weight:900;' : '') + '">' + cell + '</span>';
      });
      h += '</div>';
    });
    return h + '</div>';
  }
  if (b.type === "keyvalue") {
    var kvLabel = b.label ? '<div style="font-size:11px;font-weight:900;color:' + color + ';letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px">' + b.label + '</div>' : '';
    h = '<div style="margin-bottom:16px">' + kvLabel + '<div style="display:grid;gap:8px">';
    (b.items || []).forEach(function(kv) {
      h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#FAFAF7;border-radius:12px;border:1px solid #F4F4F0">';
      h += '<span style="color:#4E524A;font-size:13px;font-weight:700">' + (kv.key || '') + '</span>';
      h += '<span class="num" style="font-weight:900;color:#0A1F17;font-size:14px">' + (kv.value || '') + '</span></div>';
    });
    return h + '</div></div>';
  }
  if (b.type === "comparison") {
    h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">';
    var panes = [
      { title: b.leftTitle,  rows: b.leftRows,  accent: false, meta: 'Previous' },
      { title: b.rightTitle, rows: b.rightRows, accent: true,  meta: 'This' },
    ];
    panes.forEach(function(p) {
      var bg = p.accent ? 'background:linear-gradient(135deg,' + colorDark + ',' + color + ');color:#fff;' : 'background:#fff;color:#0A1F17;border:1px solid #E8E9E3;';
      var sh = p.accent ? 'box-shadow:0 10px 30px rgba(2,179,118,.25);' : '';
      h += '<div style="padding:22px;border-radius:14px;' + bg + sh + '">';
      h += '<div style="font-size:11px;font-weight:900;letter-spacing:.14em;opacity:' + (p.accent ? '.85' : '.6') + ';text-transform:uppercase">' + p.meta + '</div>';
      h += '<div style="font-size:17px;font-weight:900;margin-top:4px;letter-spacing:-0.01em">' + (p.title || '') + '</div>';
      h += '<div style="border-top:1px solid ' + (p.accent ? 'rgba(255,255,255,.2)' : '#F4F4F0') + ';margin-top:14px;padding-top:12px">';
      (p.rows || []).forEach(function(rv) {
        h += '<div style="display:flex;justify-content:space-between;padding:7px 0;font-size:13px;font-weight:700">';
        h += '<span style="opacity:' + (p.accent ? '.85' : '.7') + '">' + (rv.key || rv.label || '') + '</span>';
        h += '<span class="num">' + (rv.value || '') + '</span></div>';
      });
      h += '</div></div>';
    });
    return h + '</div>';
  }
  if (b.type === "callout") {
    return '<div style="padding:32px;background:#0A1F17;border-radius:18px;color:#fff;display:flex;gap:22px;align-items:center;margin-bottom:16px;position:relative;overflow:hidden">' +
      '<div style="position:absolute;right:-40px;bottom:-40px;width:220px;height:220px;border-radius:50%;background:' + color + ';opacity:.12;pointer-events:none"></div>' +
      (b.icon ? '<div style="font-size:44px;flex-shrink:0;position:relative">' + b.icon + '</div>' : '') +
      '<div style="position:relative">' +
      '<div style="font-size:11px;font-weight:900;letter-spacing:.2em;color:#66D7A5;margin-bottom:6px;text-transform:uppercase">' + (b.title || 'Highlight') + '</div>' +
      '<div style="font-size:26px;font-weight:900;letter-spacing:-0.03em;line-height:1.15">' + (b.value || '') + '</div>' +
      '</div></div>';
  }
  if (b.type === "chart") {
    var cid = "ch" + Math.random().toString(36).slice(2, 8);
    var cd = JSON.stringify({ type: b.chartType || "bar", data: { labels: b.labels || [], datasets: b.datasets || [] } }).replace(/"/g, "&quot;");
    return '<div style="background:#FAFAF7;padding:24px;border-radius:16px;border:1px solid #F4F4F0;margin-bottom:16px"><div style="font-size:11px;font-weight:900;color:' + color + ';letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px">' + (b.title || "Chart") + '</div><canvas id="' + cid + '" data-chartcfg="' + cd + '"></canvas></div>';
  }
  if (b.type === "link") {
    return '<div style="margin-bottom:16px;padding:16px 20px;background:#E6F9F1;border:1px solid #CFF3E3;border-radius:14px;display:flex;align-items:center;gap:14px">' +
      '<div style="width:40px;height:40px;border-radius:12px;background:' + color + ';display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:white;font-size:18px">&#128279;</span></div>' +
      '<div><a href="' + (b.url || '#') + '" target="_blank" rel="noopener noreferrer" style="color:' + colorDark + ';font-weight:900;font-size:15px;text-decoration:none;letter-spacing:-0.01em">' + (b.text || b.url || 'Link') + '</a>' +
      (b.description ? '<div style="font-size:13px;color:#4E524A;margin-top:2px">' + b.description + '</div>' : '') +
      '</div></div>';
  }
  if (b.type === "image") {
    return '<div style="margin-bottom:16px;text-align:center"><img src="' + (b.url || '') + '" style="max-width:100%;border-radius:14px;box-shadow:0 4px 10px rgba(10,31,23,.08)" alt="' + (b.caption || '') + '" />' +
      (b.caption ? '<div style="font-size:12px;color:#787C72;margin-top:10px;font-weight:700">' + b.caption + '</div>' : '') + '</div>';
  }
  return "";
}

// ─── Shared chart/collapse script + password gate ────────────────────────────

function chartAndCollapseScript(hasCollapse) {
  var s = 'document.addEventListener("DOMContentLoaded",function(){';
  s += 'document.querySelectorAll("canvas[data-chartcfg]").forEach(function(c){try{var d=JSON.parse(c.getAttribute("data-chartcfg"));new Chart(c,{type:d.type,data:d.data,options:{responsive:true,plugins:{legend:{labels:{font:{family:"Lato",weight:700}}}}}});}catch(e){}});';
  if (hasCollapse) {
    s += 'document.querySelectorAll(".sec-title").forEach(function(el){el.addEventListener("click",function(){this.classList.toggle("collapsed");var body=this.parentElement.querySelector(".sec-body");if(body)body.classList.toggle("hidden");});});';
  }
  s += '});';
  return s;
}

function passwordGateCSS(color) {
  var c = "";
  c += ".pw-gate{position:fixed;inset:0;background:#F4F4F0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}";
  c += ".pw-box{background:white;border-radius:20px;padding:40px;max-width:420px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(10,31,23,.10),0 8px 24px rgba(10,31,23,.06);border:1px solid #E8E9E3}";
  c += ".pw-logo{margin-bottom:20px}";
  c += ".pw-box h2{font-size:22px;font-weight:900;color:#0A1F17;margin-bottom:6px;letter-spacing:-0.02em}";
  c += ".pw-box p{font-size:13px;color:#787C72;margin-bottom:22px}";
  c += ".pw-box input{width:100%;padding:13px 16px;border:1px solid #E8E9E3;border-radius:12px;font-size:14px;outline:none;transition:border-color .2s;font-family:inherit}";
  c += ".pw-box input:focus{border-color:" + color + ";box-shadow:0 0 0 3px rgba(2,179,118,.12)}";
  c += ".pw-box button{width:100%;padding:13px;background:" + color + ";color:white;border:none;border-radius:999px;font-size:14px;font-weight:900;cursor:pointer;margin-top:14px;transition:background .2s;font-family:inherit;letter-spacing:-0.01em}";
  c += ".pw-box button:hover{background:#029A66}";
  c += ".pw-err{color:#D94F4F;font-size:13px;margin-top:8px;display:none;font-weight:700}";
  c += ".pw-notice{font-size:11px;color:#A8ABA1;margin-top:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}";
  return c;
}

function passwordGateHTML(color, accessPassword) {
  var hashHex = sha256(accessPassword);
  var o = '<div id="pw-gate" class="pw-gate" data-h="' + hashHex + '">';
  o += '<div class="pw-box">';
  o += '<div class="pw-logo">' + caloLogoSvg(color, 32) + '</div>';
  o += '<h2>Confidential report</h2>';
  o += '<p>This report is restricted to authorized Calo personnel only.</p>';
  o += '<input id="pw-input" type="password" placeholder="Enter access code" autocomplete="off" />';
  o += '<button id="pw-btn">View report</button>';
  o += '<div id="pw-err" class="pw-err"></div>';
  o += '<div class="pw-notice">&#128274; Protected by Calo Reports</div>';
  o += '</div></div>';
  return o;
}

var PW_SCRIPT = `
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

// Shared HTML shell — head + body open + optional password gate
function htmlShell(title, css, innerBody, accessPassword, extraScript) {
  var o = "";
  o += '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">';
  o += '<meta name="robots" content="noindex,nofollow">';
  o += "<title>" + title + "</title>";
  o += '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
  o += '<link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">';
  o += '<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>';
  o += "<style>" + css + "</style></head><body>";
  if (accessPassword) o += passwordGateHTML((innerBody && innerBody.color) || '#02B376', accessPassword);
  o += innerBody.html;
  if (extraScript) o += "<script>" + extraScript + "</script>";
  if (accessPassword) o += "<script>" + PW_SCRIPT + "</script>";
  o += "</body></html>";
  return o;
}

// ─── VARIANT: Editorial ──────────────────────────────────────────────────────
function buildEditorialHTML(r, color, colorDark, colorDeepest, title, accessPassword) {
  var gi = r.generalInfo || {};
  var reportTitle = gi.title || r.title || title;
  var reportDate = gi.reportDate || r.reportDate || '';
  var reportSubtitle = gi.subtitle || r.subtitle || '';
  var prevMonth = gi.prevMonth || '';
  var companyName = gi.companyName || '';
  var kpis = gi.kpiStrip || r.kpis || [];
  var sections = r.sections || [];
  var summary = r.summary || '';
  var insights = r.insights || [];

  var css = "*{margin:0;padding:0;box-sizing:border-box}";
  css += "body{font-family:'Lato',system-ui,sans-serif;background:#F4F4F0;color:#0A1F17;line-height:1.6;-webkit-font-smoothing:antialiased}";
  css += ".num{font-variant-numeric:tabular-nums;font-feature-settings:'tnum'}";
  css += ".ctr{max-width:960px;margin:0 auto;padding:32px 20px}";
  css += ".paper{background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(10,31,23,.10),0 8px 24px rgba(10,31,23,.06)}";
  css += ".hero{background:linear-gradient(135deg," + colorDeepest + " 0%," + colorDark + " 45%," + color + " 100%);color:#fff;padding:56px 48px;position:relative;overflow:hidden}";
  css += ".hero *{position:relative;z-index:1}";
  css += ".hero-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px;flex-wrap:wrap;gap:12px}";
  css += ".hero-eyebrow{font-size:11px;font-weight:900;letter-spacing:.2em;opacity:.8}";
  css += ".hero-sub{font-size:12px;font-weight:900;letter-spacing:.18em;opacity:.85;margin-bottom:12px}";
  css += ".hero h1{font-size:56px;font-weight:900;letter-spacing:-0.04em;line-height:1.02;margin:0;max-width:700px}";
  css += ".hero-meta{display:flex;flex-wrap:wrap;gap:28px;margin-top:36px;padding-top:22px;border-top:1px solid rgba(255,255,255,.2)}";
  css += ".meta-item{min-width:120px}.meta-label{font-size:10px;font-weight:900;opacity:.7;letter-spacing:.16em;text-transform:uppercase}.meta-value{font-size:14px;font-weight:900;margin-top:3px}";
  css += ".kpi-strip{background:#fff;padding:32px 48px;border-bottom:1px solid #F4F4F0}";
  css += ".kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:22px}";
  css += ".kpi-label{font-size:11px;font-weight:900;color:#787C72;letter-spacing:.1em;text-transform:uppercase}";
  css += ".kpi-value{font-size:42px;font-weight:900;letter-spacing:-0.04em;line-height:1;margin-top:6px}";
  css += ".kpi-unit{font-size:18px;color:#787C72;font-weight:700;margin-left:3px}";
  css += ".kpi-trend{font-size:12px;font-weight:700;margin-top:4px;display:inline-flex;align-items:center;gap:4px}";
  css += ".kpi-up{color:#029A66}.kpi-down{color:#D94F4F}.kpi-stable{color:#787C72}";
  css += ".sec{padding:36px 48px;border-top:1px solid #F4F4F0}";
  css += ".sec-eyebrow{font-size:11px;font-weight:900;color:" + color + ";letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px}";
  css += ".sec-title{font-size:32px;font-weight:900;letter-spacing:-0.03em;margin:0 0 22px;line-height:1.1;color:#0A1F17;cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;gap:10px}";
  css += ".sec-title .chev{font-size:16px;color:#A8ABA1;transition:transform .2s;flex-shrink:0}";
  css += ".sec-title.collapsed .chev{transform:rotate(-90deg)}";
  css += ".sec-body{transition:max-height .35s ease,opacity .25s}";
  css += ".sec-body.hidden{max-height:0!important;opacity:0;overflow:hidden;margin-top:0!important}";
  css += ".summary{padding:28px;background:linear-gradient(135deg,#E6F9F1,#fff);border:1px solid #CFF3E3;border-radius:16px;font-size:17px;font-weight:300;line-height:1.6;color:#1A1D17}";
  css += ".summary strong{font-weight:900;color:" + colorDark + "}";
  css += ".insights{display:flex;flex-direction:column;gap:12px}";
  css += ".insight{padding:16px 20px;background:#E6F9F1;border-left:4px solid " + color + ";border-radius:0 14px 14px 0;font-size:14px;color:#016040;line-height:1.6;font-weight:400}";
  css += ".footer{padding:32px 48px;border-top:1px solid #F4F4F0;background:#FAFAF7;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}";
  css += ".footer-brand{display:flex;align-items:center;gap:14px}.footer-brand-text{font-size:12px;font-weight:700;color:#2F332C}.footer-brand-sub{font-size:11px;color:#787C72;margin-top:2px}";
  css += ".footer-tag{font-size:11px;color:#787C72;font-weight:700;letter-spacing:.08em;text-transform:uppercase}";
  css += ".trow:hover{background:#E6F9F1!important}";
  css += "@media print{body{background:white}.ctr{padding:0;max-width:100%}.paper{box-shadow:none;border-radius:0}.sec-body.hidden{max-height:none!important;opacity:1}.sec-title{cursor:default}.sec-title .chev{display:none}}";
  css += "@media(max-width:768px){.hero{padding:40px 28px}.hero h1{font-size:38px}.kpi-strip{padding:24px 28px}.kpi-value{font-size:32px}.sec{padding:28px 28px}.sec-title{font-size:24px}.footer{padding:22px 28px}.hero-meta{gap:16px}.meta-item{min-width:100px}}";
  if (accessPassword) css += passwordGateCSS(color);

  var o = '<div id="pw-content" class="ctr"><div class="paper">';
  // Hero
  o += '<div class="hero">';
  o += '<div class="hero-top">' + caloLogoSvg('#ffffff', 28);
  if (prevMonth || reportDate) o += '<div class="hero-eyebrow">' + (prevMonth || reportDate) + '</div>';
  o += '</div>';
  if (reportSubtitle) o += '<div class="hero-sub">' + reportSubtitle + '</div>';
  o += '<h1>' + reportTitle + '</h1>';
  var metaItems = [];
  if (reportDate && !prevMonth) metaItems.push({ l: 'Date', v: reportDate });
  if (prevMonth && reportDate) metaItems.push({ l: 'Published', v: reportDate });
  if (companyName) metaItems.push({ l: 'Organization', v: companyName });
  metaItems.push({ l: 'Sections', v: sections.length || 0 });
  if (metaItems.length) {
    o += '<div class="hero-meta">';
    metaItems.forEach(function(m) { o += '<div class="meta-item"><div class="meta-label">' + m.l + '</div><div class="meta-value">' + m.v + '</div></div>'; });
    o += '</div>';
  }
  o += '</div>';
  // KPIs
  if (kpis && kpis.length) {
    o += '<div class="kpi-strip"><div class="kpi-grid">';
    kpis.forEach(function(k) {
      var trendClass = k.trend === 'up' ? 'kpi-up' : k.trend === 'down' ? 'kpi-down' : 'kpi-stable';
      var trendIcon  = k.trend === 'up' ? '&#9650;' : k.trend === 'down' ? '&#9660;' : '';
      o += '<div><div class="kpi-label">' + (k.label || '') + '</div>';
      o += '<div class="kpi-value num">' + (k.value || '');
      if (k.unit) o += '<span class="kpi-unit">' + k.unit + '</span>';
      o += '</div>';
      if (k.trend || k.change) {
        o += '<div class="kpi-trend ' + trendClass + '">';
        if (trendIcon) o += '<span>' + trendIcon + '</span> ';
        o += (k.change || k.trend || '');
        o += '</div>';
      }
      o += '</div>';
    });
    o += '</div></div>';
  }
  // Sections
  if (summary) {
    o += '<div class="sec"><div class="sec-eyebrow">Executive summary</div><h2 class="sec-title"><span>Highlights</span><span class="chev">&#9662;</span></h2>';
    o += '<div class="sec-body"><div class="summary">' + summary + '</div></div></div>';
  }
  sections.forEach(function(s, idx) {
    o += '<div class="sec"><div class="sec-eyebrow">Section · ' + String(idx + 1).padStart(2, '0') + '</div>';
    o += '<h2 class="sec-title"><span>' + (s.icon ? s.icon + ' ' : '') + (s.title || '') + '</span><span class="chev">&#9662;</span></h2>';
    o += '<div class="sec-body">';
    (s.blocks || []).forEach(function(b) { o += renderBlock(b, color, colorDark); });
    o += '</div></div>';
  });
  if (insights && insights.length) {
    o += '<div class="sec"><div class="sec-eyebrow">Next quarter</div><h2 class="sec-title"><span>Key insights</span><span class="chev">&#9662;</span></h2>';
    o += '<div class="sec-body"><div class="insights">';
    insights.forEach(function(i) { o += '<div class="insight">' + i + '</div>'; });
    o += '</div></div></div>';
  }
  // Footer
  o += '<div class="footer"><div class="footer-brand">' + caloLogoSvg('#A8ABA1', 18);
  o += '<div><div class="footer-brand-text">Calo Reports Platform</div>';
  o += '<div class="footer-brand-sub">Prepared with care' + (reportDate ? ' · ' + reportDate : '') + '</div></div></div>';
  o += '<div class="footer-tag">Confidential · Internal use only</div></div>';
  o += '</div></div>';

  return { html: o, css, color };
}

// ─── VARIANT: Dashboard ──────────────────────────────────────────────────────
function buildDashboardHTML(r, color, colorDark, colorDeepest, title, accessPassword) {
  var gi = r.generalInfo || {};
  var reportTitle = gi.title || r.title || title;
  var reportDate = gi.reportDate || r.reportDate || '';
  var reportSubtitle = gi.subtitle || r.subtitle || '';
  var prevMonth = gi.prevMonth || '';
  var kpis = gi.kpiStrip || r.kpis || [];
  var sections = r.sections || [];
  var summary = r.summary || '';
  var insights = r.insights || [];

  var css = "*{margin:0;padding:0;box-sizing:border-box}";
  css += "body{font-family:'Lato',system-ui,sans-serif;background:#F4F4F0;color:#0A1F17;line-height:1.55;-webkit-font-smoothing:antialiased}";
  css += ".num{font-variant-numeric:tabular-nums;font-feature-settings:'tnum'}";
  css += ".ctr{max-width:1100px;margin:0 auto;padding:24px 20px}";
  css += ".paper{background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(10,31,23,.10),0 8px 24px rgba(10,31,23,.06)}";
  css += ".dash-header{padding:24px 40px;background:#0A1F17;color:#fff;display:flex;align-items:center;gap:20px;flex-wrap:wrap}";
  css += ".dash-header .divider{width:1px;height:26px;background:rgba(255,255,255,.2)}";
  css += ".dash-eyebrow{font-size:11px;font-weight:900;color:#66D7A5;letter-spacing:.16em;text-transform:uppercase}";
  css += ".dash-title{font-size:22px;font-weight:900;letter-spacing:-0.02em;margin-top:2px}";
  css += ".live-pill{background:" + color + ";color:#fff;padding:6px 12px;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:-0.01em;display:inline-flex;align-items:center;gap:6px;margin-left:auto}";
  css += ".kpi-strip{padding:20px 40px;border-bottom:1px solid #F4F4F0;display:grid;grid-template-columns:repeat(6,1fr);gap:20px}";
  css += ".kpi-col{border-right:1px solid #F4F4F0;padding-right:16px}.kpi-col:last-child{border-right:none;padding-right:0}";
  css += ".kpi-label{font-size:10px;font-weight:900;color:#787C72;letter-spacing:.1em;text-transform:uppercase}";
  css += ".kpi-value{font-size:26px;font-weight:900;letter-spacing:-0.03em;margin-top:3px}";
  css += ".kpi-unit{font-size:14px;color:#787C72;font-weight:700;margin-left:2px}";
  css += ".kpi-change{font-size:11px;color:#029A66;font-weight:700;margin-top:2px}";
  css += ".section-label{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}";
  css += ".section-num{font-size:22px;font-weight:900;color:" + color + ";letter-spacing:-0.02em;min-width:30px}";
  css += ".section-title{font-size:18px;font-weight:900;letter-spacing:-0.02em;color:#0A1F17}";
  css += ".section-rule{flex:1;height:1px;background:#E8E9E3}";
  css += ".dash-grid{padding:32px 40px;display:grid;grid-template-columns:1fr 1fr;gap:24px}";
  css += ".dash-full{grid-column:span 2}";
  css += ".dash-box{padding:20px;background:#fff;border:1px solid #E8E9E3;border-radius:14px}";
  css += ".summary{padding:24px;background:linear-gradient(135deg,#E6F9F1,#fff);border:1px solid #CFF3E3;border-radius:14px;font-size:15px;line-height:1.55;color:#2F332C;font-weight:400}";
  css += ".summary strong{font-weight:900;color:" + colorDark + "}";
  css += ".insights{display:flex;flex-direction:column;gap:8px}";
  css += ".insight{padding:12px 16px;background:#FAFAF7;border-left:3px solid " + color + ";border-radius:0 10px 10px 0;font-size:13px;color:#2F332C}";
  css += ".footer{padding:22px 40px;border-top:1px solid #F4F4F0;background:#FAFAF7;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}";
  css += ".footer-brand{display:flex;align-items:center;gap:14px}.footer-brand-text{font-size:12px;font-weight:700;color:#2F332C}.footer-brand-sub{font-size:11px;color:#787C72;margin-top:2px}";
  css += ".footer-tag{font-size:11px;color:#787C72;font-weight:700;letter-spacing:.08em;text-transform:uppercase}";
  css += ".trow:hover{background:#E6F9F1!important}";
  css += "@media print{body{background:white}.ctr{padding:0;max-width:100%}.paper{box-shadow:none;border-radius:0}}";
  css += "@media(max-width:900px){.kpi-strip{grid-template-columns:repeat(3,1fr)}.kpi-col:nth-child(3n){border-right:none}.dash-grid{grid-template-columns:1fr}.dash-full{grid-column:span 1}}";
  css += "@media(max-width:500px){.kpi-strip{grid-template-columns:repeat(2,1fr)}.kpi-col{border-right:none}.dash-header{padding:18px 24px}.dash-grid{padding:24px 24px}.footer{padding:18px 24px}}";
  if (accessPassword) css += passwordGateCSS(color);

  var o = '<div id="pw-content" class="ctr"><div class="paper">';
  // Header
  o += '<div class="dash-header">' + caloLogoSvg('#ffffff', 24);
  o += '<div class="divider"></div>';
  o += '<div style="flex:1;min-width:200px"><div class="dash-eyebrow">' + (reportSubtitle || prevMonth || 'REPORT') + '</div>';
  o += '<div class="dash-title">' + reportTitle + '</div></div>';
  o += '<span class="live-pill">' + (reportDate || 'LIVE') + '</span></div>';

  // KPI strip (6-col)
  if (kpis && kpis.length) {
    var ks = kpis.slice(0, 6);
    while (ks.length < 6) ks.push({ label: '', value: '' });
    o += '<div class="kpi-strip">';
    ks.forEach(function(k, i) {
      o += '<div class="kpi-col">';
      o += '<div class="kpi-label">' + (k.label || '') + '</div>';
      if (k.value) {
        o += '<div class="kpi-value num">' + k.value;
        if (k.unit) o += '<span class="kpi-unit">' + k.unit + '</span>';
        o += '</div>';
      }
      if (k.change || k.trend) o += '<div class="kpi-change">' + (k.change || k.trend) + '</div>';
      o += '</div>';
    });
    o += '</div>';
  }

  // Content grid — alternating full / half layouts
  o += '<div class="dash-grid">';
  var slot = 0;
  if (summary) {
    o += '<div class="dash-full"><div class="section-label"><span class="section-num">01</span><span class="section-title">Executive summary</span><span class="section-rule"></span></div>';
    o += '<div class="summary">' + summary + '</div></div>';
    slot = 1;
  }
  sections.forEach(function(s, idx) {
    var isFull = (s.blocks || []).some(function(b) { return b.type === 'table' || b.type === 'chart' || b.type === 'comparison'; }) || (s.blocks || []).length > 2;
    var wrap = isFull ? 'dash-full' : '';
    var numStr = String(slot + idx + 1).padStart(2, '0');
    o += '<div class="' + wrap + '"><div class="section-label"><span class="section-num">' + numStr + '</span><span class="section-title">' + (s.icon ? s.icon + ' ' : '') + (s.title || '') + '</span><span class="section-rule"></span></div>';
    (s.blocks || []).forEach(function(b) { o += renderBlock(b, color, colorDark); });
    o += '</div>';
  });
  if (insights && insights.length) {
    var insNum = String(slot + sections.length + 1).padStart(2, '0');
    o += '<div class="dash-full"><div class="section-label"><span class="section-num">' + insNum + '</span><span class="section-title">Key insights</span><span class="section-rule"></span></div>';
    o += '<div class="insights">';
    insights.forEach(function(i) { o += '<div class="insight">' + i + '</div>'; });
    o += '</div></div>';
  }
  o += '</div>';

  // Footer
  o += '<div class="footer"><div class="footer-brand">' + caloLogoSvg('#A8ABA1', 18);
  o += '<div><div class="footer-brand-text">Calo Reports Platform</div>';
  o += '<div class="footer-brand-sub">Dashboard view' + (reportDate ? ' · ' + reportDate : '') + '</div></div></div>';
  o += '<div class="footer-tag">Confidential · Internal use only</div></div>';

  o += '</div></div>';

  return { html: o, css, color };
}

// ─── VARIANT: Minimal ────────────────────────────────────────────────────────
function buildMinimalHTML(r, color, colorDark, colorDeepest, title, accessPassword) {
  var gi = r.generalInfo || {};
  var reportTitle = gi.title || r.title || title;
  var reportDate = gi.reportDate || r.reportDate || '';
  var reportSubtitle = gi.subtitle || r.subtitle || '';
  var prevMonth = gi.prevMonth || '';
  var kpis = gi.kpiStrip || r.kpis || [];
  var sections = r.sections || [];
  var summary = r.summary || '';
  var insights = r.insights || [];

  var css = "*{margin:0;padding:0;box-sizing:border-box}";
  css += "body{font-family:'Lato',system-ui,sans-serif;background:#F4F4F0;color:#0A1F17;line-height:1.55;-webkit-font-smoothing:antialiased}";
  css += ".num{font-variant-numeric:tabular-nums;font-feature-settings:'tnum'}";
  css += ".ctr{max-width:760px;margin:0 auto;padding:40px 20px}";
  css += ".paper{background:#FDFDFA;border-radius:6px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.08);padding:72px 72px 56px;min-height:900px}";
  css += ".min-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:72px}";
  css += ".min-stamp{font-size:10px;font-weight:700;letter-spacing:.2em;color:#787C72;text-transform:uppercase}";
  css += ".eyebrow{font-size:11px;font-weight:900;letter-spacing:.22em;color:" + color + ";text-transform:uppercase;margin-bottom:14px}";
  css += "h1.min-title{font-size:48px;font-weight:900;letter-spacing:-0.04em;line-height:1.02;margin:0 0 40px;color:#0A1F17}";
  css += ".kpi-rule{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:22px 0;border-top:2px solid #0A1F17;border-bottom:1px solid #D5D6CF;margin-bottom:36px}";
  css += ".kpi-label{font-size:10px;font-weight:700;color:#787C72;letter-spacing:.12em;text-transform:uppercase}";
  css += ".kpi-value{font-size:28px;font-weight:900;letter-spacing:-0.03em;margin-top:4px}";
  css += ".kpi-unit{font-size:16px;color:#787C72;font-weight:700;margin-left:2px}";
  css += ".min-sec{margin-bottom:32px}";
  css += ".min-sec-label{font-size:11px;font-weight:900;letter-spacing:.16em;color:" + color + ";text-transform:uppercase;margin-bottom:12px}";
  css += ".min-sec-title{font-size:22px;font-weight:900;letter-spacing:-0.02em;color:#0A1F17;margin-bottom:14px}";
  css += ".min-body{font-size:16px;line-height:1.65;color:#1A1D17;font-weight:300;margin-bottom:16px}";
  css += ".min-body strong{font-weight:900;color:#0A1F17}";
  css += ".min-foot{margin-top:40px;padding-top:20px;border-top:1px solid #D5D6CF;font-size:11px;color:#787C72;font-weight:700;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}";
  css += "@media print{body{background:white}.ctr{padding:0;max-width:100%}.paper{box-shadow:none;border-radius:0;padding:48px 56px}}";
  css += "@media(max-width:640px){.paper{padding:36px 28px}h1.min-title{font-size:36px}.kpi-rule{grid-template-columns:repeat(2,1fr)}.min-top{margin-bottom:36px}}";
  if (accessPassword) css += passwordGateCSS(color);

  var o = '<div id="pw-content" class="ctr"><div class="paper">';
  // Top
  o += '<div class="min-top">' + caloLogoSvg(colorDark, 18);
  o += '<div class="min-stamp">' + (prevMonth || reportDate || 'Internal') + '</div></div>';
  o += '<div class="eyebrow">' + (reportSubtitle || 'Report') + '</div>';
  o += '<h1 class="min-title">' + reportTitle + '</h1>';
  // KPI rule
  if (kpis && kpis.length) {
    var ks = kpis.slice(0, 4);
    o += '<div class="kpi-rule">';
    ks.forEach(function(k) {
      o += '<div><div class="kpi-label">' + (k.label || '') + '</div>';
      if (k.value) {
        o += '<div class="kpi-value num">' + k.value;
        if (k.unit) o += '<span class="kpi-unit">' + k.unit + '</span>';
        o += '</div>';
      }
      o += '</div>';
    });
    o += '</div>';
  }
  // Summary (as inline paragraph)
  if (summary) {
    o += '<div class="min-sec"><div class="min-sec-label">§ 01 — Summary</div>';
    o += '<p class="min-body">' + summary + '</p></div>';
  }
  // Sections
  sections.forEach(function(s, idx) {
    var num = String(idx + (summary ? 2 : 1)).padStart(2, '0');
    o += '<div class="min-sec"><div class="min-sec-label">§ ' + num + ' — ' + (s.title || 'Section') + '</div>';
    (s.blocks || []).forEach(function(b) { o += renderBlock(b, color, colorDark); });
    o += '</div>';
  });
  // Insights
  if (insights && insights.length) {
    var insNum = String(sections.length + (summary ? 2 : 1)).padStart(2, '0');
    o += '<div class="min-sec"><div class="min-sec-label">§ ' + insNum + ' — Takeaways</div>';
    o += '<ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.65;color:#2F332C;font-weight:300">';
    insights.forEach(function(i) { o += '<li style="margin-bottom:8px">' + i + '</li>'; });
    o += '</ul></div>';
  }
  // Footer
  o += '<div class="min-foot"><span>Calo Reports · Prepared' + (reportDate ? ' ' + reportDate : '') + '</span>';
  o += '<span>Confidential · Internal use only</span></div>';

  o += '</div></div>';

  return { html: o, css, color };
}

// ─── Public entry point — dispatches on generalInfo.variant ──────────────────

export function buildStandaloneHTML(reportData, brandColor, title, options = {}) {
  const r = reportData || {};
  const gi = r.generalInfo || {};
  const color = brandColor || gi.brandColor || r.brandColor || "#02B376";
  const colorDark = "#027D53";
  const colorDeepest = "#01432D";
  const rt = title || gi.title || r.title || "Report";
  const accessPassword = options.password || null;
  const variant = (options.variant || gi.variant || r.variant || 'editorial').toLowerCase();

  let body;
  if (variant === 'dashboard') body = buildDashboardHTML(r, color, colorDark, colorDeepest, rt, accessPassword);
  else if (variant === 'minimal') body = buildMinimalHTML(r, color, colorDark, colorDeepest, rt, accessPassword);
  else body = buildEditorialHTML(r, color, colorDark, colorDeepest, rt, accessPassword);

  // Editorial supports section collapse; dashboard + minimal don't
  const hasCollapse = variant === 'editorial' || !variant;
  return htmlShell(rt, body.css, body, accessPassword, chartAndCollapseScript(hasCollapse));
}
