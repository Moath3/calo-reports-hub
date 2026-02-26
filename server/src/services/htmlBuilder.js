export function buildStandaloneHTML(reportData, brandColor, title) {
  const r = reportData || {};
  const color = brandColor || r.brandColor || "#22c55e";
  const rt = title || r.title || "Report";
  
  function rb(b) {
    if (!b) return "";
    var h = "";
    if (b.type === "badge") {
      var cs = {green:"#dcfce7;color:#166534",amber:"#fef3c7;color:#92400e",red:"#fee2e2;color:#991b1b",blue:"#dbeafe;color:#1e40af"};
      return "<span style=\"display:inline-block;padding:4px 14px;border-radius:99px;font-size:13px;font-weight:600;background:"+(cs[b.style]||cs.blue)+"\">"+(b.label||"")+"</span>";
    }
    if (b.type === "notes") {
      var nc = b.items ? b.items.map(function(it){return "<li>"+it+"</li>";}).join("") : (b.content||b.text||"").replace(/\n/g,"<br>");
      return b.items ? "<ul style=\"color:#374151;line-height:1.7;font-size:14px;padding-left:20px\">"+nc+"</ul>" : "<div style=\"color:#374151;line-height:1.7;font-size:14px\">"+nc+"</div>";
    }
    if (b.type === "metrics") {
      h = "<div style=\"display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px\">";
      (b.items||[]).forEach(function(m){
        var tc = m.trend==="up"?"#16a34a":m.trend==="down"?"#dc2626":"#6b7280";
        h+="<div style=\"background:#f9fafb;padding:16px;border-radius:10px;border:1px solid #e5e7eb\">";
        h+="<div style=\"font-size:12px;color:#6b7280\">"+(m.label||"")+"</div>";
        h+="<div style=\"font-size:24px;font-weight:700\">"+(m.value||"")+"</div>";
        if(m.change) h+="<div style=\"font-size:12px;color:"+tc+"\">"+m.change+"</div>";
        h+="</div>";
      });
      return h+"</div>";
    }
    if (b.type === "table") {
      h="<table style=\"width:100%;border-collapse:collapse;font-size:13px\"><thead><tr>";
      (b.headers||[]).forEach(function(hd){h+="<th style=\"padding:10px 12px;text-align:left;font-weight:600;border-bottom:2px solid #e5e7eb;background:#f9fafb\">"+hd+"</th>";});
      h+="</tr></thead><tbody>";
      (b.rows||[]).forEach(function(row,i){
        h+="<tr style=\"background:"+(i%2===0?"#fff":"#f9fafb")+"\">";
        row.forEach(function(cell){h+="<td style=\"padding:8px 12px;border-bottom:1px solid #f3f4f6\">"+cell+"</td>";});
        h+="</tr>";
      });
      return h+"</tbody></table>";
    }
    if (b.type === "keyvalue") {
      h="<div style=\"display:grid;gap:8px\">";
      (b.items||[]).forEach(function(kv){
        h+="<div style=\"display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6\">";
        h+="<span style=\"color:#6b7280\">"+(kv.key||"")+"</span><span style=\"font-weight:600\">"+(kv.value||"")+"</span></div>";
      });
      return h+"</div>";
    }
    if (b.type === "comparison") {
      h="<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:16px\">";
      [[b.leftTitle,b.leftRows],[b.rightTitle,b.rightRows]].forEach(function(pair){
        h+="<div style=\"background:#f9fafb;padding:16px;border-radius:10px;border:1px solid #e5e7eb\">";
        h+="<div style=\"font-weight:700;margin-bottom:12px\">"+(pair[0]||"")+"</div>";
        (pair[1]||[]).forEach(function(rv){
          h+="<div style=\"display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb\">";
          h+="<span style=\"color:#6b7280\">"+(rv.key||"")+"</span><span style=\"font-weight:600\">"+(rv.value||"")+"</span></div>";
        });
        h+="</div>";
      });
      return h+"</div>";
    }
    if (b.type === "callout") {
      return "<div style=\"background:linear-gradient(135deg,"+color+"15,"+color+"08);border-radius:12px;padding:20px;text-align:center\">"+
        "<div style=\"font-size:28px;margin-bottom:8px\">"+(b.icon||"")+"</div>"+
        "<div style=\"font-size:13px;color:#6b7280\">"+(b.title||"")+"</div>"+
        "<div style=\"font-size:22px;font-weight:700\">"+(b.value||"")+"</div></div>";
    }
    if (b.type === "chart") {
      var cid="ch"+Math.random().toString(36).slice(2,8);
      var cd=JSON.stringify({type:b.chartType||"bar",data:{labels:b.labels||[],datasets:b.datasets||[]}}).replace(/"/g,"&quot;");
      return "<div style=\"background:#f9fafb;padding:20px;border-radius:10px\"><div style=\"font-weight:600;margin-bottom:8px\">"+(b.title||"Chart")+"</div><canvas id=\""+cid+"\" data-chartcfg=\""+cd+"\"></canvas></div>";
    }
    return "";
  }

  var css = "*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#111827;line-height:1.5}";
  css+=".ctr{max-width:1000px;margin:0 auto;padding:24px}";
  css+=".hdr{background:linear-gradient(135deg,"+color+","+color+"cc);color:#fff;padding:48px 40px;border-radius:16px;margin-bottom:24px}";
  css+=".hdr h1{font-size:32px;font-weight:800}";
  css+=".ks{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:24px}";
  css+=".kc{background:#fff;padding:18px;border-radius:12px;border:1px solid #e5e7eb}";
  css+=".kl{font-size:11px;color:#6b7280;text-transform:uppercase}.kv{font-size:26px;font-weight:800}";
  css+=".sec{background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:24px;margin-bottom:16px}";
  css+=".st{font-size:18px;font-weight:700;margin-bottom:16px}.blk{margin-bottom:16px}";
  css+=".sb{background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:24px;margin-bottom:16px}";
  css+=".ii{padding:10px 16px;background:#f0fdf4;border-left:3px solid "+color+";margin-bottom:8px;border-radius:0 8px 8px 0;font-size:14px;color:#166534}";

  var chartScript = 'document.addEventListener("DOMContentLoaded",function(){document.querySelectorAll("canvas[data-chartcfg]").forEach(function(c){try{var d=JSON.parse(c.getAttribute("data-chartcfg"));new Chart(c,{type:d.type,data:d.data,options:{responsive:true}});}catch(e){}});});';

  var o = "";
  o+='<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">';
  o+="<title>"+rt+"<\/title>";
  o+='<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">';
  o+='<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>';
  o+="<style>"+css+"<\/style><\/head><body><div class=\"ctr\">";
  o+="<div class=\"hdr\"><h1>"+(r.title||rt)+"<\/h1>";
  if(r.subtitle) o+="<div style=\"font-size:16px;opacity:.9\">"+r.subtitle+"<\/div>";
  if(r.reportDate) o+="<div style=\"font-size:13px;opacity:.7;margin-top:8px\">"+r.reportDate+"<\/div>";
  o+="<\/div>";

  if(r.kpis && r.kpis.length){
    o+="<div class=\"ks\">";
    r.kpis.forEach(function(k){o+="<div class=\"kc\"><div class=\"kl\">"+(k.label||"")+"<\/div><div class=\"kv\">"+(k.value||"")+"<\/div><\/div>";});
    o+="<\/div>";
  }

  (r.sections||[]).forEach(function(s){
    o+="<div class=\"sec\"><div class=\"st\">"+(s.icon||"")+" "+(s.title||"")+"<\/div>";
    (s.blocks||[]).forEach(function(b){o+="<div class=\"blk\">"+rb(b)+"<\/div>";});
    o+="<\/div>";
  });

  if(r.summary) o+="<div class=\"sb\"><h3 style=\"font-size:18px;font-weight:700;margin-bottom:12px\">Executive Summary<\/h3><p style=\"color:#4b5563;line-height:1.7;font-size:14px\">"+r.summary+"<\/p><\/div>";
  if(r.insights && r.insights.length){
    o+="<div class=\"sb\"><h3 style=\"font-size:18px;font-weight:700;margin-bottom:12px\">Key Insights<\/h3>";
    r.insights.forEach(function(i){o+="<div class=\"ii\">"+i+"<\/div>";});
    o+="<\/div>";
  }
  o+="<\/div><script>"+chartScript+"<\/script><\/body><\/html>";
  return o;
}
