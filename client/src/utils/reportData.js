// Pure normalizer for report_data.
//
// Accepts EITHER the canonical shape:
//   { generalInfo: { title, subtitle, reportDate, brandColor, kpiStrip, ... }, sections: [...] }
// or the legacy flat shape older AI responses (and reports already saved in the
// prod DB) may have:
//   { title, subtitle, reportDate, brandColor, kpis: [...], summary, insights: [...], sections: [...] }
// and returns the canonical shape. Never mutates its input. Dependency-free.

const DEFAULT_BRAND_COLOR = '#02B376';

// Stable per-block id so React keys survive reorder/remove (otherwise index keys
// leave block editors' local state attached to the wrong block). Persisted in
// report_data; htmlBuilder and the AI ignore unknown keys.
let _bidSeq = 0;
export const genBlockId = () => `b_${Date.now().toString(36)}_${(_bidSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function normalizeBlock(block) {
  if (!block || typeof block !== 'object') return block;
  let b = block;
  // Legacy notes: { content: "line1\nline2" } -> { items: ['line1', 'line2'] } (label kept)
  if (b.type === 'notes' && !Array.isArray(b.items) && typeof b.content === 'string') {
    const { content, ...rest } = b;
    b = { ...rest, items: content.split('\n').filter(Boolean) };
  } else if (b.type === 'badge' && !b.title && b.label) {
    // Legacy badge: { label, style } without a title -> title = label
    b = { ...b, title: b.label };
  }
  return b._id ? b : { ...b, _id: genBlockId() };
}

function normalizeSection(section) {
  if (!section || typeof section !== 'object') return null;
  return {
    ...section,
    blocks: Array.isArray(section.blocks) ? section.blocks.map(normalizeBlock) : [],
  };
}

export function normalizeReportData(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const {
    title, subtitle, reportDate, brandColor, kpis, summary, insights,
    generalInfo: rawGeneralInfo, sections: rawSections,
    ...rest
  } = src;

  const hasGeneralInfo = Boolean(
    rawGeneralInfo && typeof rawGeneralInfo === 'object' && !Array.isArray(rawGeneralInfo)
  );
  const generalInfo = hasGeneralInfo ? { ...rawGeneralInfo } : {};

  // Fold flat fields into generalInfo (build it when missing, fill gaps when present).
  if (generalInfo.title == null && title != null) generalInfo.title = title;
  if (generalInfo.subtitle == null && subtitle != null) generalInfo.subtitle = subtitle;
  if (generalInfo.reportDate == null && reportDate != null) generalInfo.reportDate = reportDate;
  if (!generalInfo.brandColor) generalInfo.brandColor = brandColor || DEFAULT_BRAND_COLOR;
  if (!Array.isArray(generalInfo.kpiStrip) || generalInfo.kpiStrip.length === 0) {
    generalInfo.kpiStrip = Array.isArray(kpis) && kpis.length
      ? kpis.slice()
      : (Array.isArray(generalInfo.kpiStrip) ? generalInfo.kpiStrip : []);
  }

  const sections = Array.isArray(rawSections)
    ? rawSections.map(normalizeSection).filter(Boolean)
    : [];

  // Fold flat summary/insights into a prepended Executive Summary section
  // (only when one doesn't already exist).
  const hasExecSummary = sections.some(
    s => typeof s.title === 'string' && s.title.trim().toLowerCase() === 'executive summary'
  );
  const summaryItems = [summary, ...(Array.isArray(insights) ? insights : [])].filter(Boolean);
  if (summaryItems.length && !hasExecSummary) {
    sections.unshift({
      title: 'Executive Summary',
      icon: '📋',
      blocks: [{ type: 'notes', label: 'Summary', items: summaryItems }],
    });
  }

  // `rest` keeps unknown root keys but drops the now-folded flat ones
  // (title/subtitle/reportDate/brandColor/kpis/summary/insights).
  return { ...rest, generalInfo, sections };
}

export default normalizeReportData;
