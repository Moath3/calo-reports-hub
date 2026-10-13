// SheetJS file reading for the OT calculator. Kept apart from engine.js so the
// engine stays dependency-free and unit-testable under node; this module is the
// only place that touches XLSX. SheetJS is lazy-loaded (the calculator is
// admin-only) so it stays out of the main app bundle.
import { scoreHeader, detectMap, isBlank, buildMaster } from './engine.js';

let _XLSX = null;
async function xlsx() { if (!_XLSX) _XLSX = await import('xlsx'); return _XLSX; }

// Read a workbook and pick the sheet whose best header row scores highest
// (ties broken by row count). Returns { sn, rows(header:1), off, sc } or null.
export async function readBook(buf, name) {
  const XLSX = await xlsx();
  const isCsv = /\.csv$/i.test(name);
  const wb = XLSX.read(buf, { type: 'array', raw: isCsv, cellDates: false });
  let best = null;
  wb.SheetNames.forEach((sn) => {
    const ws = wb.Sheets[sn]; if (!ws || !ws['!ref']) return;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const off = XLSX.utils.decode_range(ws['!ref']).s.r;
    let sc = 0; for (let i = 0; i < Math.min(rows.length, 25); i++) sc = Math.max(sc, scoreHeader(rows[i]));
    if (!best || sc > best.sc || (sc === best.sc && rows.length > best.rows.length)) best = { sn, rows, off, sc };
  });
  return best;
}

// Read a punch/transaction file into { rows, hdrIdx, rowOffset, headers, map, ... }.
export async function readPunchFile(file) {
  const buf = await file.arrayBuffer();
  const b = await readBook(buf, file.name);
  if (!b || !b.rows.length) throw new Error('That file has no rows to read.');
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(b.rows.length, 25); i++) { const sc = scoreHeader(b.rows[i]); if (sc > bestScore) { bestScore = sc; best = i; } }
  const headers = (b.rows[best] || []).map((h, i) => (isBlank(h) ? 'Column ' + (i + 1) : String(h).trim()));
  const map = detectMap(headers);
  return { fileName: file.name, sheetName: b.sn, rows: b.rows, hdrIdx: best, rowOffset: b.off || 0, headers, score: bestScore, map };
}

// Return every sheet of a salary master as [{ sn, rows }]. Also understands the
// "## Sheet name:" multi-sheet text-dump format used by some exports.
export async function masterSheets(buf, name) {
  const XLSX = await xlsx();
  const out = []; let txt = null;
  if (!/\.(xlsx|xls|xlsm)$/i.test(name)) { try { txt = new TextDecoder().decode(buf); } catch { /* binary */ } }
  if (txt && /^## Sheet name:/m.test(txt)) {
    const parts = txt.split(/^## Sheet name:[ \t]*(.*)$/m);
    for (let i = 1; i < parts.length; i += 2) {
      const wb = XLSX.read(parts[i + 1].replace(/^\s+/, ''), { type: 'string', raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (ws && ws['!ref']) out.push({ sn: parts[i].trim(), rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) });
    }
  } else {
    const wb = XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
    wb.SheetNames.forEach((sn) => {
      const ws = wb.Sheets[sn];
      if (ws && ws['!ref']) out.push({ sn, rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) });
    });
  }
  return out;
}

// Read + build the salary master directory for a company.
export async function readMasterFile(file, companyTab, dateOrder) {
  const buf = await file.arrayBuffer();
  const sheets = await masterSheets(buf, file.name);
  return buildMaster(sheets, companyTab, dateOrder, file.name);
}
