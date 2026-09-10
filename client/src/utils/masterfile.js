/**
 * Masterfile loading + cross-check utilities for the Zelt data hygiene audit.
 *
 * The user uploads HR masterfile XLSXs in the audit page; this module parses
 * them entirely in the browser (no upload to the server, no PII leaves the
 * machine), normalizes the rows into a common shape, and persists a compact
 * form to localStorage so they don't have to re-upload every visit.
 *
 * Cross-check logic compares the uploaded masterfiles against Zelt's active
 * users (which the server includes as report.activeUsers). Mismatches and
 * orphans become new "checks" merged into the audit report so the data
 * hygiene score immediately reflects cross-source health.
 */

// 2026 people-structure fields shared by every parse path. Candidates cover
// the header spellings across the three canonical tabs AND the legacy sheets,
// so one pickFirst list works everywhere (missing columns just yield null).
const STRUCTURE_COLUMNS = {
  businessLine: ['Business Line'],
  team: ['Branch/Team', 'Team / Branch', 'Section/Branch', 'Section'],
  org: ['Organisation', 'Organization'],
  roleLevel: ['Role Level'],
  jobFamily: ['Job Family', 'Production / Non-Production'],
  legalEntity: ['Legal Entity', 'Entity', 'Sponsor'],
  workCountry: ['Work Country', 'Region', 'Working Location'],
};

// Canonical NEW-structure tabs in the "KSA Masterfile - Luqmat" workbook.
// Matched EXACTLY (whitespace/case-insensitive) so legacy/archive tabs like
// 'Luqmat Active Employees', 'Copy of Luqmat' or 'MD ...' never match.
const STRUCTURE_TABS = [
  { sheet: 'GCC Masterfile', source: 'GCC' },
  { sheet: 'Luqmat', source: 'Luqmat' },
  { sheet: 'Production Masterfile', source: '3rd-Party' },
];

// LEGACY source configurations (kept as fallback so old files still work):
// - KSA Masterfile: only the "Luqmat Active Employees" sheet (skip everything else)
// - 3rd Party Masterfile: only the "Data-Full Time" sheet (skip Data-Monthly Contractor)
const SOURCES = {
  ksaLuqmat: {
    label: 'KSA Masterfile (Luqmat Active)',
    rowSource: 'Luqmat',
    // The actual sheet name has a trailing space in the file we inspected;
    // fall through to a fuzzy match if exact-match fails.
    sheetCandidates: ['Luqmat Active Employees ', 'Luqmat Active Employees', 'Luqmat Active'],
    columns: {
      iqamaId: ['Iqama No', 'Iqama number', 'National ID'],
      empId: ['Emp No', 'EMP ID', 'Emp ID'],
      name: ['Full Name', 'Name'],
      dept: ['Dept', 'Department'],
      position: ['Position', 'Job Title'],
      status: ['Status'],
      entity: ['Entity', 'Sponsor', 'Calo Organisation', 'Legal Entity'],
      joiningDate: ['Joining Date', 'Hire Date'],
      ...STRUCTURE_COLUMNS,
    },
  },
  thirdParty: {
    label: 'HR Masterfile (3rd Party Production)',
    rowSource: '3rd-Party',
    sheetCandidates: ['Data-Full Time', 'Main_Sheet'],
    columns: {
      iqamaId: ['National ID', 'Iqama No', 'Iqama number'],
      empId: ['Emp\nNumber', 'Emp Number', 'EMP ID', 'Emp No'],
      name: ['Name', 'Full Name'],
      dept: ['Dept', 'Department'],
      position: ['Position', 'Job Title'],
      status: ['Status'],
      entity: ['Legal Entity', 'Sponsor', 'Entity'],
      joiningDate: ['Hire Date', 'Joining Date'],
      ...STRUCTURE_COLUMNS,
    },
  },
};

// Column map for the canonical new-structure tabs. Header spellings differ
// per tab; pickFirst falls through, so one map covers all three.
const STRUCTURE_TAB_COLUMNS = {
  iqamaId: ['Iqama No', 'Iqama number', 'National ID'],
  empId: ['Empl. ID', 'Emp No', 'Emp Number', 'Emp\nNumber', 'EMP ID', 'Emp ID'],
  name: ['Name', 'Full Name'],
  dept: ['Department', 'Dept'],
  position: ['Position', 'Job Title'],
  status: ['Status'],
  joiningDate: ['Joining Date', 'Hire Date'],
  ...STRUCTURE_COLUMNS,
};

export const SOURCE_LABELS = Object.fromEntries(
  Object.entries(SOURCES).map(([k, v]) => [k, v.label])
);

const STORAGE_KEY = 'calo-zelt-masterfiles-v1';

function pickFirst(row, candidates) {
  for (const c of candidates) {
    if (row[c] != null && row[c] !== '') return row[c];
  }
  return null;
}

function findSheet(wb, candidates) {
  for (const c of candidates) {
    const exact = wb.SheetNames.find(n => n === c);
    if (exact) return exact;
  }
  // Fuzzy: case + whitespace insensitive
  const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  for (const c of candidates) {
    const target = norm(c);
    const fuzzy = wb.SheetNames.find(n => norm(n) === target);
    if (fuzzy) return fuzzy;
  }
  return null;
}

function mapRow(raw, columns) {
  const out = {};
  for (const [key, candidates] of Object.entries(columns)) {
    out[key] = pickFirst(raw, candidates);
  }
  return out;
}

/**
 * Parse an XLSX File handle into a normalized masterfile snapshot.
 * Returns { source, label, sheet, rows, loadedAt }.
 * Dynamic import of `xlsx` keeps the ~400KB SheetJS bundle off the main chunk.
 *
 * NEW-structure path: when the workbook contains any of the canonical 2026
 * tabs (GCC Masterfile / Luqmat / Production Masterfile) we parse ALL that
 * are present — one workbook can now supply every source. Each row is tagged
 * with source: 'GCC' | 'Luqmat' | '3rd-Party'. Legacy sheets remain the
 * fallback so old files still work.
 */
export async function loadMasterfile(file, sourceKey) {
  const config = SOURCES[sourceKey];
  if (!config) throw new Error(`Unknown masterfile source: ${sourceKey}`);

  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  // ---- New-structure path: canonical tabs win over legacy sheets ----
  const canonicalTabs = STRUCTURE_TABS
    .map(t => ({ ...t, sheetName: findSheet(wb, [t.sheet]) }))
    .filter(t => t.sheetName);

  if (canonicalTabs.length > 0) {
    const rows = [];
    for (const tab of canonicalTabs) {
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[tab.sheetName], { defval: null });
      for (const r of raw) {
        const out = mapRow(r, STRUCTURE_TAB_COLUMNS);
        if (!(out.iqamaId || out.empId || out.name)) continue;
        out.source = tab.source;
        // Keep the legacy cross-check field populated too.
        out.entity = out.entity ?? out.legalEntity;
        rows.push(out);
      }
    }
    return {
      source: sourceKey,
      label: `New masterfile (${canonicalTabs.map(t => t.sheet).join(' + ')})`,
      sheet: canonicalTabs.map(t => t.sheetName).join(' + '),
      structure: true,
      rows,
      loadedAt: Date.now(),
      fileName: file.name,
    };
  }

  // ---- Legacy fallback path ----
  const sheetName = findSheet(wb, config.sheetCandidates);
  if (!sheetName) {
    const wanted = STRUCTURE_TABS.map(t => t.sheet).concat(config.sheetCandidates);
    throw new Error(`Sheet not found. Looked for: ${wanted.join(', ')}. Available: ${wb.SheetNames.join(', ')}`);
  }

  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  const rows = raw
    .map(r => {
      const out = mapRow(r, config.columns);
      out.source = config.rowSource;
      out.legalEntity = out.legalEntity ?? out.entity;
      return out;
    })
    .filter(r => r.iqamaId || r.empId || r.name);

  return {
    source: sourceKey,
    label: config.label,
    sheet: sheetName,
    rows,
    loadedAt: Date.now(),
    fileName: file.name,
  };
}

/**
 * Flatten every parsed masterfile into one row list for the structure checks.
 * Dedupes on source+id so the same workbook uploaded into both slots (the new
 * file covers everything) doesn't double-count.
 */
export function collectMasterfileRows(masterfiles) {
  const rows = [];
  const seen = new Set();
  for (const mf of Object.values(masterfiles || {})) {
    if (!mf || !Array.isArray(mf.rows)) continue;
    for (const r of mf.rows) {
      const id = String(r.empId ?? '').trim() || String(r.iqamaId ?? '').trim() || String(r.name ?? '').trim();
      const key = `${r.source || mf.source || ''}|${id.toLowerCase()}`;
      if (id && seen.has(key)) continue;
      seen.add(key);
      rows.push(r);
    }
  }
  return rows;
}

export function saveMasterfilesToStorage(byKey) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byKey));
  } catch (e) {
    console.warn('[masterfile] localStorage save failed:', e.message);
  }
}

export function loadMasterfilesFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function clearMasterfilesFromStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ---- Cross-check ---------------------------------------------------------

function normKey(v) {
  if (v == null) return '';
  return String(v).trim().toLowerCase();
}

function buildIndex(rows) {
  const byIqama = new Map();
  const byEmp = new Map();
  for (const r of rows) {
    if (r.iqamaId) byIqama.set(normKey(r.iqamaId), r);
    if (r.empId) byEmp.set(normKey(r.empId), r);
  }
  return { byIqama, byEmp };
}

function lookup(zeltEmployeeId, indexedFiles) {
  if (!zeltEmployeeId) return null;
  const k = normKey(zeltEmployeeId);
  for (const mf of indexedFiles) {
    const hit = mf.index.byIqama.get(k) || mf.index.byEmp.get(k);
    if (hit) return { row: hit, source: mf.source, label: mf.label };
  }
  return null;
}

/**
 * Compares Zelt active users against uploaded masterfiles. Returns an
 * object of new check arrays that can be merged into report.checks. Each
 * array contains the same item shape used elsewhere in the audit so the
 * existing renderer + score logic just work.
 *
 * Pass `report.activeUsers` (compact list from the server) and the keyed
 * masterfiles object: { ksaLuqmat: {rows,...}, thirdParty: {rows,...} }.
 */
export function crossCheckMasterfiles(activeUsers, masterfiles) {
  if (!Array.isArray(activeUsers) || activeUsers.length === 0) return null;

  const indexedFiles = Object.values(masterfiles)
    .filter(mf => mf && Array.isArray(mf.rows) && mf.rows.length)
    .map(mf => ({ ...mf, index: buildIndex(mf.rows) }));

  if (indexedFiles.length === 0) return null;

  const seenMasterfileRows = new Set();
  const phantoms = [];
  const deptMismatches = [];
  const positionMismatches = [];

  for (const u of activeUsers) {
    const match = lookup(u.employeeId, indexedFiles);
    if (!match) {
      phantoms.push({
        userId: u.userId,
        employeeId: u.employeeId,
        name: u.name,
        entity: u.entity,
        dept: u.dept,
        suggestion: 'Active in Zelt but not found in any uploaded masterfile',
      });
      continue;
    }
    seenMasterfileRows.add(match.row);

    const zDept = normKey(u.dept);
    const mDept = normKey(match.row.dept);
    if (zDept && mDept && zDept !== mDept) {
      deptMismatches.push({
        employeeId: u.employeeId,
        name: u.name,
        zeltValue: u.dept,
        masterfileValue: match.row.dept,
        source: match.label,
        suggestion: `Zelt: ${u.dept} → ${match.label}: ${match.row.dept}`,
      });
    }

    const zPos = normKey(u.position);
    const mPos = normKey(match.row.position);
    if (zPos && mPos && zPos !== mPos) {
      positionMismatches.push({
        employeeId: u.employeeId,
        name: u.name,
        zeltValue: u.position,
        masterfileValue: match.row.position,
        source: match.label,
        suggestion: `Zelt: ${u.position} → ${match.label}: ${match.row.position}`,
      });
    }
  }

  // Masterfile rows marked as Active that didn't match any Zelt user.
  const orphans = [];
  for (const mf of indexedFiles) {
    for (const row of mf.rows) {
      const status = String(row.status || '').toLowerCase();
      // Only count rows the masterfile considers active — empty status counts
      // as active (some masterfiles only list active employees on the source sheet).
      if (status && !status.includes('active')) continue;
      if (seenMasterfileRows.has(row)) continue;
      orphans.push({
        employeeId: row.empId || row.iqamaId,
        name: row.name,
        dept: row.dept,
        position: row.position,
        entity: row.entity,
        source: mf.label,
        suggestion: `Active in ${mf.label} but not active in Zelt`,
      });
    }
  }

  return {
    zeltNotInMasterfile: phantoms,
    masterfileNotInZelt: orphans,
    deptMismatchVsMasterfile: deptMismatches,
    positionMismatchVsMasterfile: positionMismatches,
  };
}
