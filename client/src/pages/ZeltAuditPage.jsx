import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { Icon, Btn, Card, Pill, Eyebrow } from '../components/ui';
import {
  loadMasterfile,
  saveMasterfilesToStorage,
  loadMasterfilesFromStorage,
  clearMasterfilesFromStorage,
  crossCheckMasterfiles,
  collectMasterfileRows,
} from '../utils/masterfile';
import { runStructureChecks } from '../utils/structureChecks';

const SEVERITY = {
  activeWithLeaveDate: 'high',
  // 'info' = displayed but not penalized in the score. These two checks turned
  // out to be filtering/categorization quirks rather than real data debt:
  //   - activeButTerminated: people in mid-termination flow who are filtered
  //     out by HR's normal queries; not a hygiene problem.
  //   - staleCreated (further down): pre-onboarding records held in 'Created'
  //     status for >90 days, which is just how Zelt buckets them. Not stale.
  // Real cleanness/accuracy will come from masterfile cross-checks once the
  // KSA Luqmat + 3rd Party masterfiles are uploaded.
  activeButTerminated: 'info',
  duplicateEmployeeIds: 'high',
  // Entity = payroll entity (Basecamp/MP) is the DECIDED model; the legal CR
  // lives in a separate field. Brand-division names are expected here, so this
  // is now informational, not a penalized violation.
  brandDivisionAsEntity: 'info',
  legacySiteAssigned: 'high',
  currencyMismatch: 'high',
  placeholderEmails: 'high',
  // Cross-source checks (vs uploaded masterfiles)
  zeltNotInMasterfile: 'high',
  mfStatusMismatch: 'high',
  masterfileNotInZelt: 'high',
  deptMismatchVsMasterfile: 'medium',
  positionMismatchVsMasterfile: 'low',
  // Masterfile structure checks (2026 people-structure canon)
  mfDeptFamilyMismatch: 'high',
  mfHqProductionClash: 'high',
  mfEntityCountry: 'high',
  mfRetiredBusinessLine: 'high',
  mfRetiredDepartment: 'medium',
  mfInvalidBusinessLine: 'medium',
  mfInvalidDepartment: 'medium',
  mfFamilyLevelMismatch: 'medium',
  mfTitleMismatch: 'medium',
  mfRetailBranch: 'medium',
  mfTeamNotInDept: 'low',
  mfTitleVariant: 'low',
  // Server-side Zelt canon checks (arrive in the audit response)
  retiredDepartment: 'high',
  titleDeptMismatch: 'medium',
  nonCanonicalTitle: 'low', // catalog-spelling cosmetics — advisory, not health-scoring
  missingEmployeeId: 'medium',
  duplicateNames: 'medium',
  missingEntity: 'medium',
  missingDepartment: 'low',
  missingSite: 'low',
  missingManager: 'medium',
  unapprovedEntity: 'medium',
  unapprovedDepartment: 'low',
  unclassifiedCountry: 'medium',
  unclassifiedOrganization: 'medium',
  duplicateJobTitleVariants: 'low', // casing/whitespace variants — advisory, not health-scoring
  rareJobTitles: 'low',
  futureJoiners: 'low',
  staleCreated: 'info',
  testUsers: 'medium',
  departmentList: 'info',
  entityList: 'info',
};

const LABELS = {
  activeWithLeaveDate: 'Active employees with leaveDate set',
  activeButTerminated: 'Active but marked Terminated/Resigned',
  duplicateEmployeeIds: 'Duplicate employee IDs',
  missingEmployeeId: 'Active users missing employee ID',
  duplicateNames: 'Duplicate display names',
  missingEntity: 'Missing entity',
  missingSite: 'Missing site',
  missingDepartment: 'Missing department',
  missingManager: 'Missing manager',
  futureJoiners: 'Future joiners (>90 days out)',
  staleCreated: 'Stale "Created" status (>90 days)',
  testUsers: 'Test users on Active status',
  // Guide-driven
  unapprovedEntity: 'Entity not in legal CR list',
  unapprovedDepartment: 'Department needs confirmation against approved list',
  legacySiteAssigned: 'Active user on a legacy "[Not in use]" site',
  currencyMismatch: 'Entity currency mismatch with country (e.g. KSA in GBP)',
  rareJobTitles: 'Job titles used by only 1 employee (typos / not in mastersheet)',
  duplicateJobTitleVariants: 'Job title case/spacing duplicates (LINE COOK vs Line Cook)',
  placeholderEmails: 'Active users with @dummy / @noreply emails',
  brandDivisionAsEntity: 'Brand-division name used as Entity (should be Organization tag)',
  unclassifiedCountry: 'Country can\'t be derived from entity/site',
  unclassifiedOrganization: 'Organization can\'t be derived (Basecamp / MP-XX)',
  departmentList: 'All active departments — review against approved list',
  entityList: 'All entities seen — confirm CR vs brand-division',
  // Cross-source checks
  zeltNotInMasterfile: 'Active in Zelt but not in any uploaded masterfile',
  mfStatusMismatch: 'Active in Zelt but inactive in masterfile',
  masterfileNotInZelt: 'Active in masterfile but not active in Zelt',
  deptMismatchVsMasterfile: 'Department mismatch: Zelt vs masterfile',
  positionMismatchVsMasterfile: 'Position mismatch: Zelt vs masterfile',
  // Masterfile structure checks (2026 people-structure canon)
  mfRetiredBusinessLine: 'Retired business line (masterfile)',
  mfInvalidBusinessLine: 'Business line not in approved list (masterfile)',
  mfRetiredDepartment: 'Retired department (masterfile)',
  mfInvalidDepartment: 'Department not in approved list (masterfile)',
  mfFamilyLevelMismatch: 'Job family vs role level mismatch',
  mfDeptFamilyMismatch: 'Department vs job family mismatch',
  mfHqProductionClash: 'MP HQ business line on a production department',
  mfRetailBranch: 'Retail branch tagging issue',
  mfTeamNotInDept: 'Team not listed under its department',
  mfTitleMismatch: 'Job title contradicts dept/family (masterfile)',
  mfTitleVariant: 'Off-catalog job title spelling',
  mfEntityCountry: 'Legal entity country vs work country mismatch',
  // Server-side Zelt canon checks
  retiredDepartment: 'Retired department (Zelt)',
  titleDeptMismatch: 'Title vs department mismatch',
  nonCanonicalTitle: 'Non-catalog job title',
};

export default function ZeltAuditPage() {
  const { user } = useAuth();
  const [reportRaw, setReportRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [masterfiles, setMasterfiles] = useState(() => loadMasterfilesFromStorage());
  const [mfError, setMfError] = useState(null);
  const [mfBusy, setMfBusy] = useState(false);
  // Watch state (snapshots) bubbled up from WatcherCard so the health card
  // can show the flagged-people trend without a second /zelt/watch request.
  const [watchData, setWatchData] = useState(null);

  const load = useCallback((force = false) => {
    setLoading(true);
    setError(null);
    api.zeltAudit({ force })
      .then(r => setReportRaw(r))
      .catch(e => setError(e.message || 'Failed to load audit'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(false); }, [load]);

  const onRefresh = () => load(true);

  // Augment the audit report with cross-checks against uploaded masterfiles
  // AND the 2026 people-structure checks over the masterfile rows themselves.
  // Recomputes whenever the raw report or any masterfile changes; the score
  // (which reads from report.checks) updates automatically.
  const report = useMemo(() => {
    if (!reportRaw) return null;
    const cross = crossCheckMasterfiles(reportRaw.activeUsers, masterfiles);
    // Structure checks operate on ACTIVE masterfile rows only. Inactive rows
    // (active === false) are kept by the parser for the status cross-check but
    // must not generate structure noise; rows without the flag (old persisted
    // data) pass through unchanged.
    const mfRows = collectMasterfileRows(masterfiles).filter(r => r.active !== false);
    const structure = mfRows.length ? runStructureChecks(mfRows) : null;
    if (!cross && !structure) return reportRaw;
    const checks = { ...reportRaw.checks };
    const summary = { ...reportRaw.summary };
    for (const [k, items] of Object.entries(cross || {})) {
      checks[k] = items;
      summary[k] = items.length;
    }
    for (const [k, items] of Object.entries(structure?.checks || {})) {
      checks[k] = items;
      summary[k] = items.length;
    }
    return { ...reportRaw, checks, summary };
  }, [reportRaw, masterfiles]);

  // One upload field now. The canonical-tab path in loadMasterfile ignores the
  // source key, so try 'ksaLuqmat' first; if a legacy single-source file
  // doesn't match its sheets, retry as 'thirdParty' before surfacing an error.
  // An upload REPLACES the stored masterfile data (one workbook = all sources).
  const handleMasterfileUpload = useCallback(async (file) => {
    setMfError(null);
    setMfBusy(true);
    try {
      let parsed;
      try {
        parsed = await loadMasterfile(file, 'ksaLuqmat');
      } catch (firstErr) {
        try {
          parsed = await loadMasterfile(file, 'thirdParty');
        } catch {
          throw firstErr;
        }
      }
      const next = { workbook: parsed };
      saveMasterfilesToStorage(next);
      setMasterfiles(next);
    } catch (e) {
      setMfError(e.message);
    } finally {
      setMfBusy(false);
    }
  }, []);

  const clearMasterfiles = useCallback(() => {
    clearMasterfilesFromStorage();
    setMasterfiles({});
  }, []);

  if (loading) return <Wrap><Spinner /></Wrap>;
  if (error) return <Wrap><Header /><div style={errBanner}>{error}</div><WatcherCard /></Wrap>;
  if (!report) return null;

  const checkKeys = Object.keys(report.summary).filter(k => !['ksaActiveCount'].includes(k));
  const sorted = checkKeys.sort((a, b) => {
    const sa = SEVERITY[a] || 'low';
    const sb = SEVERITY[b] || 'low';
    const order = { high: 0, medium: 1, low: 2 };
    return (order[sa] - order[sb]) || (report.summary[b] - report.summary[a]);
  });

  return (
    <Wrap>
      <Header onRefresh={onRefresh} report={report} />

      <WatcherCard onData={setWatchData} />

      <HealthCard report={report} snapshots={watchData?.snapshots} />

      <MasterfileUploadPanel
        masterfiles={masterfiles}
        onUpload={handleMasterfileUpload}
        onClear={clearMasterfiles}
        busy={mfBusy}
        error={mfError}
      />

      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <StatCard label="Total Zelt users" value={report.totalUsers} />
        <StatCard label="Unique entities" value={report.stats?.totalUniqueEntities ?? '—'} />
        <StatCard label="Unique departments" value={report.stats?.totalUniqueDepartments ?? '—'} />
        <StatCard label="Unique job titles" value={report.stats?.totalUniqueJobTitles ?? '—'} />
        <StatCard label="Countries detected" value={report.stats?.totalCountries ?? '—'} />
        <StatCard label="Organizations detected" value={report.stats?.totalOrganizations ?? '—'} />
        {Object.entries(report.statusCounts).map(([k, v]) => (
          <StatCard key={k} label={k} value={v} muted />
        ))}
      </div>

      {/* Active by country */}
      {report.byCountry && (
        <div style={{ ...panel, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            Active employees by country
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(report.byCountry).sort((a,b) => b[1] - a[1]).map(([c, n]) => (
              <span key={c} style={{
                padding: '6px 12px', borderRadius: 999,
                background: c === 'Unclassified' ? '#FDECEC' : 'var(--calo-50, #d9f0e5)',
                color: c === 'Unclassified' ? '#9f2f2f' : 'var(--calo-700, #1e8359)',
                fontSize: 13, fontWeight: 700,
              }}>{c} · {n}</span>
            ))}
          </div>
        </div>
      )}

      {/* Active by organization */}
      {report.byOrganization && (
        <div style={{ ...panel, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            Active employees by organization (Basecamp / MP-XX)
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(report.byOrganization).sort((a,b) => b[1] - a[1]).map(([o, n]) => (
              <span key={o} style={{
                padding: '6px 12px', borderRadius: 999,
                background: o === 'Unclassified' ? '#FDECEC' : 'var(--calo-50, #d9f0e5)',
                color: o === 'Unclassified' ? '#9f2f2f' : 'var(--calo-700, #1e8359)',
                fontSize: 13, fontWeight: 700,
              }}>{o} · {n}</span>
            ))}
          </div>
        </div>
      )}

      {/* Check cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {sorted.map(key => {
          const count = report.summary[key];
          const sev = SEVERITY[key] || 'low';
          const items = report.checks[key] || [];
          const isOpen = expanded === key;
          return (
            <div key={key} style={{ ...panel, padding: 0, overflow: 'hidden', borderLeft: `4px solid ${sevColor(sev)}` }}>
              <button
                onClick={() => setExpanded(isOpen ? null : key)}
                style={{ width: '100%', textAlign: 'left', padding: '14px 16px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-900)' }}>{LABELS[key] || key}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sevColor(sev), letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2 }}>
                    {sev}
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: count === 0 ? 'var(--ink-500)' : sevColor(sev), letterSpacing: '-0.02em' }}>
                  {count}
                </div>
              </button>
              {isOpen && Array.isArray(items) && items.length > 0 && (
                <div style={{ borderTop: '1px solid var(--ink-100)', maxHeight: 320, overflowY: 'auto' }}>
                  {items.slice(0, 50).map((it, i) => (
                    <div key={i} style={{ padding: '8px 16px', borderBottom: '1px solid var(--ink-100)', fontSize: 13 }}>
                      <div style={{ fontWeight: 700 }}>
                        {it.name || it.legalName || it.value || it.employeeId || it.email || prettyFallback(it)}
                      </div>
                      {it.employeeId && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ID: {it.employeeId}</div>}
                      {it.leaveDate && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>leaveDate: {it.leaveDate}</div>}
                      {it.eventStatus && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>event: {it.eventStatus}</div>}
                      {it.startDate && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>start: {it.startDate}</div>}
                      {it.suggestion && <div style={{ fontSize: 11, color: 'var(--ink-500)', fontStyle: 'italic' }}>{it.suggestion}</div>}
                      {it.detail && <div style={{ fontSize: 11, color: 'var(--ink-500)', fontStyle: 'italic' }}>{it.detail}</div>}
                      {it.source && (
                        <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>
                          {[it.source, it.dept, it.position].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {it.count != null && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>{it.count} matches</div>}
                    </div>
                  ))}
                  {items.length > 50 && (
                    <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--ink-500)', textAlign: 'center' }}>
                      …and {items.length - 50} more
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Wrap>
  );
}

function Wrap({ children }) {
  return <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>;
}

// Last-resort renderer for audit-row shapes the explicit fields above don't cover.
// Joins primitive values from the object into "key: value · key: value" instead of
// dumping a truncated JSON.stringify, which read as gibberish in the UI.
function prettyFallback(it) {
  if (it == null) return '';
  if (typeof it !== 'object') return String(it);
  const pairs = Object.entries(it)
    .filter(([, v]) => v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${v}`);
  return pairs.join(' · ') || '(no displayable fields)';
}

function Header({ onRefresh, report }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.16em', color: 'var(--ink-500)' }}>HR · ZELT</div>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: 'var(--ink-900)', letterSpacing: '-0.025em', margin: '4px 0 0 0' }}>Data Hygiene</h1>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {report && (
          <>
            <button onClick={() => downloadHtmlReport(report)} style={ghostBtn} title="Download as a self-contained HTML report"><Icon name="FileText" size={14} /> Download HTML</button>
            <button onClick={() => downloadCsvReport(report)} style={ghostBtn} title="Download flagged items as a spreadsheet (.csv)"><Icon name="Table" size={14} /> Download CSV</button>
          </>
        )}
        {onRefresh && <button onClick={onRefresh} style={ghostBtn}><Icon name="RefreshCw" size={14} /> Refresh</button>}
      </div>
    </div>
  );
}

// ---- Watcher ---------------------------------------------------------------
//
// Nightly snapshot trend + diff-since-last-snapshot, with a manual "run now"
// and a Slack digest trigger. Self-contained: loads from /zelt/watch on mount,
// independent of the audit load — a watcher failure shows a muted inline
// message and never breaks the page.

function fmtWhen(x) {
  if (!x) return 'never';
  const d = new Date(x);
  return isNaN(d.getTime()) ? String(x) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function WatcherCard({ onData }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [watchErr, setWatchErr] = useState(null);
  const [running, setRunning] = useState(false);
  const [digesting, setDigesting] = useState(false);
  const [digest, setDigest] = useState(null);

  useEffect(() => {
    let alive = true;
    api.zeltWatch()
      .then(r => { if (alive) { setData(r); onData?.(r); setWatchErr(null); } })
      .catch(e => { if (alive) setWatchErr(e?.message || 'Watcher unavailable'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runNow = async () => {
    setRunning(true);
    setWatchErr(null);
    try {
      // Takes ~30s — the server walks all Zelt users and re-runs every check.
      const r = await api.zeltWatchRun();
      setData(r);
      onData?.(r);
    } catch (e) {
      setWatchErr(e?.message || 'Snapshot run failed');
    } finally {
      setRunning(false);
    }
  };

  const sendDigest = async () => {
    setDigesting(true);
    setDigest(null);
    try {
      const r = await api.zeltWatchDigest();
      setDigest(r);
    } catch (e) {
      setDigest({ error: e?.message || 'Digest failed' });
    } finally {
      setDigesting(false);
    }
  };

  const snaps = (data?.snapshots || []).slice(-30);
  const maxFlagged = Math.max(...snaps.map(s => s.totalFlagged || 0), 1);
  const lastSnapshotAt = data?.latest?.capturedAt || data?.lastRun || null;
  const diff = data?.diff;
  const hasDiff = diff && ((diff.newFlags || []).length > 0 || (diff.resolved || []).length > 0 || (diff.deltas || []).length > 0);

  return (
    <Card padding={20}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Eyebrow style={{ marginBottom: 0 }}>Watcher</Eyebrow>
        <Pill tone="neutral" size="sm" icon="History">
          {lastSnapshotAt ? `Last snapshot ${fmtWhen(lastSnapshotAt)}` : 'Last snapshot: never'}
        </Pill>
        {data && (data.slackConfigured ? (
          <Pill tone="green" size="sm" icon="MessageSquare">Slack configured</Pill>
        ) : (
          <span title="Set SLACK_WEBHOOK_URL on the server to enable Slack digests.">
            <Pill tone="neutral" size="sm" icon="MessageSquare">webhook not set</Pill>
          </span>
        ))}
        {data?.lastDigestAt && (
          <Pill tone="neutral" size="sm" icon="Send">Last digest {fmtWhen(data.lastDigestAt)}</Pill>
        )}
        <div style={{ flex: 1 }} />
        <Btn variant="secondary" size="sm" icon={running ? 'LoaderCircle' : 'Camera'} onClick={runNow} disabled={running || loading}>
          {running ? 'Running… (~30s)' : 'Run snapshot now'}
        </Btn>
        <Btn variant="secondary" size="sm" icon={digesting ? 'LoaderCircle' : 'Send'} onClick={sendDigest} disabled={digesting || loading}>
          {digesting ? 'Sending…' : 'Send digest now'}
        </Btn>
      </div>

      {/* Digest result */}
      {digest && (
        <div style={{ marginTop: 12 }}>
          {digest.error ? (
            <div style={{ fontSize: 13, color: 'var(--ink-500)' }}>Digest failed — {digest.error}</div>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, color: digest.sent ? 'var(--calo-700, #1e8359)' : 'var(--ink-500)' }}>
              {digest.sent
                ? (typeof digest.sent === 'string' ? digest.sent : 'Digest sent to Slack.')
                : `Skipped${typeof digest.skipped === 'string' ? ` — ${digest.skipped}` : '.'}`}
            </div>
          )}
          {digest.preview && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-500)', cursor: 'pointer' }}>Digest preview</summary>
              <pre style={{ marginTop: 6, padding: 12, background: 'var(--ink-50, #f6f6f4)', borderRadius: 8, fontSize: 12, color: 'var(--ink-700)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {digest.preview}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Body: loading / error / trend + diff */}
      {loading ? (
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-500)' }}>Loading watcher…</div>
      ) : watchErr && !data ? (
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-500)' }}>Watcher unavailable — {watchErr}</div>
      ) : (
        <>
          {watchErr && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-500)' }}>{watchErr}</div>}

          {/* Trend of flagged totals across snapshots */}
          {snaps.length === 0 ? (
            <div style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-500)' }}>
              No snapshots yet — the watcher runs nightly, or click Run snapshot now.
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64, marginTop: 16 }}>
              {snaps.map((s, i) => {
                const isLast = i === snaps.length - 1;
                return (
                  <div
                    key={s.capturedAt || i}
                    title={`${fmtWhen(s.capturedAt)} — ${s.totalFlagged ?? 0} flagged`}
                    style={{
                      width: 14, flexShrink: 0,
                      height: Math.max(3, Math.round(((s.totalFlagged || 0) / maxFlagged) * 60)),
                      background: isLast ? 'var(--calo-500, #02B376)' : 'var(--ink-200)',
                      borderRadius: '3px 3px 0 0',
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Diff since previous snapshot */}
          {hasDiff && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--ink-100)', paddingTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
                What changed since {fmtWhen(diff.since)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                <WatcherDiffList title="New flags" color="#9A6F0E" items={diff.newFlags || []} />
                <WatcherDiffList title="Resolved" color="#28b17b" items={diff.resolved || []} />
              </div>
              {(diff.deltas || []).length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  {(diff.deltas || []).map((d, i) => {
                    const down = (d.after ?? 0) < (d.before ?? 0);
                    return (
                      <span key={`${d.check}-${i}`} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                        background: down ? 'var(--calo-50, #d9f0e5)' : '#FEF5E4',
                        color: down ? 'var(--calo-800, #16694a)' : '#8A5A1A',
                        border: `1px solid ${down ? 'var(--calo-100, #c2e8d6)' : '#F6E0B6'}`,
                      }}>
                        {LABELS[d.check] || d.check} {d.before ?? 0}→{d.after ?? 0}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// Grouped by check so the check label renders ONCE per check instead of
// repeating on every affected employee row. Owner names are intentionally not
// rendered (records may or may not carry an `owner` field — ignore it).
function WatcherDiffList({ title, color, items }) {
  const byCheck = new Map();
  for (const f of items) {
    const key = f.check || 'unknown';
    let g = byCheck.get(key);
    if (!g) { g = { check: key, records: [] }; byCheck.set(key, g); }
    g.records.push(f);
  }
  const groups = [...byCheck.values()].sort((a, b) => b.records.length - a.records.length);

  return (
    <div style={{ border: '1px solid var(--ink-100)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        {title} · {items.length}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>None.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map(g => {
            const shown = g.records.slice(0, 10);
            const more = g.records.length - shown.length;
            return (
              <div key={g.check}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-900)' }}>{LABELS[g.check] || g.check}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 800, color,
                    background: 'var(--ink-50, #f6f6f4)', border: '1px solid var(--ink-100)',
                    borderRadius: 999, padding: '1px 8px',
                  }}>{g.records.length}</span>
                </div>
                <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                  {shown.map(f => `${f.name || '—'}${f.employeeId ? ` · ${f.employeeId}` : ''}`).join(',  ')}
                  {more > 0 && <span style={{ fontWeight: 700 }}> +{more} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Masterfile upload panel ----------------------------------------------
//
// SINGLE upload field: the "KSA Masterfile - Luqmat" workbook carries the
// canonical GCC Masterfile / Luqmat / Production Masterfile tabs and is parsed
// into all sources at once (masterfile.js auto-detects canonical vs legacy
// sheets). Uploading REPLACES whatever was stored before. Files are parsed
// entirely in the browser via dynamic import of SheetJS (no PII upload);
// parsed snapshots persist in localStorage so the user doesn't have to
// re-upload every visit.

// Rows-per-source counts across everything loaded (rows carry a source tag:
// 'GCC' | 'Luqmat' | '3rd-Party'; legacy files tag their single source).
// Each source now splits active vs inactive; rows without the normalized
// `active` flag (old persisted data) count as active.
function masterfileSourceCounts(masterfiles) {
  const counts = {};
  for (const mf of Object.values(masterfiles || {})) {
    if (!mf || !Array.isArray(mf.rows)) continue;
    for (const r of mf.rows) {
      const s = r.source || mf.source || 'Masterfile';
      if (!counts[s]) counts[s] = { active: 0, inactive: 0 };
      if (r.active === false) counts[s].inactive += 1;
      else counts[s].active += 1;
    }
  }
  const order = ['GCC', 'Luqmat', '3rd-Party'];
  return Object.entries(counts).sort((a, b) => {
    const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function MasterfileUploadPanel({ masterfiles, onUpload, onClear, busy, error }) {
  const loadedFiles = Object.values(masterfiles || {}).filter(mf => mf && Array.isArray(mf.rows));
  const hasLoaded = loadedFiles.length > 0;
  const sourceCounts = masterfileSourceCounts(masterfiles);
  const fileNames = [...new Set(loadedFiles.map(mf => mf.fileName).filter(Boolean))];

  return (
    <div style={{ ...panel, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
        Masterfile workbook (parsed in your browser, never uploaded)
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 10 }}>
        One file covers GCC + Luqmat + 3rd-party (canonical tabs auto-detected); legacy files also work.
        Cross-source checks run automatically once uploaded.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ ...ghostBtn, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="Upload" size={14} />
          {busy ? 'Parsing…' : (hasLoaded ? 'Replace workbook' : 'Upload XLSX')}
          <input
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
          />
        </label>
        {hasLoaded && (
          <>
            {sourceCounts.map(([source, n]) => (
              <span key={source} style={{
                padding: '4px 12px', borderRadius: 999,
                background: 'var(--calo-50, #d9f0e5)', color: 'var(--calo-700, #1e8359)',
                fontSize: 12, fontWeight: 700,
              }}>{source} · {n.active} active · {n.inactive} inactive</span>
            ))}
            {fileNames.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{fileNames.join(', ')}</span>
            )}
            <button onClick={onClear} style={{ ...ghostBtn, color: '#9f2f2f', padding: '6px 10px', fontSize: 12 }}>Clear</button>
          </>
        )}
      </div>
      {error && <div style={{ ...errBanner, marginTop: 10, fontSize: 12 }}>{error}</div>}
    </div>
  );
}

// ---- Data health ------------------------------------------------------------
//
// One number anyone can read: the % of active employees with ZERO flags.
// Denominator = report.activeUsers. Numerator = active employees who never
// appear in any violation check. Deliberately Zelt-only:
//   - info-severity checks don't count (they're lists, not violations)
//   - inventory keys (departmentList, entityList) don't count
//   - mf*/masterfile cross-checks don't count — those are masterfile-side and
//     render in their own panels below without moving this number.
function isHealthCheckKey(key) {
  if (key === 'departmentList' || key === 'entityList') return false;
  if (key.startsWith('mf')) return false;
  if (/masterfile/i.test(key)) return false;
  return (SEVERITY[key] || 'low') !== 'info';
}

function computeDataHealth(report) {
  const total = Array.isArray(report.activeUsers) ? report.activeUsers.length : 0;
  // Only HIGH + MEDIUM issues make a person "unhealthy" — low-severity items
  // (rare titles, catalog spellings, missing site) are advisories and shouldn't
  // tank the score right after a clean import.
  const flagged = new Set();
  const advisory = new Set();
  const perCheck = new Map(); // check key -> distinct people (high+medium only)
  const sevCounts = { high: 0, medium: 0, low: 0 };
  for (const [key, items] of Object.entries(report.checks || {})) {
    if (!Array.isArray(items) || items.length === 0) continue;
    if (!isHealthCheckKey(key)) continue;
    const sev = SEVERITY[key] || 'low';
    sevCounts[sev] = (sevCounts[sev] || 0) + items.length;
    for (const it of items) {
      if (it == null || typeof it !== 'object') continue;
      const id = it.userId ?? it.employeeId ?? it.name;
      if (id == null || String(id).trim() === '') continue;
      const k = String(id).trim().toLowerCase();
      if (sev === 'low') { advisory.add(k); continue; }
      flagged.add(k);
      if (!perCheck.has(key)) perCheck.set(key, new Set());
      perCheck.get(key).add(k);
    }
  }
  for (const k of flagged) advisory.delete(k); // advisory = low-only people
  const clean = Math.max(0, total - flagged.size);
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((clean / total) * 100))) : null;
  // The checks costing the most people — so a surprising score explains itself.
  const topDrivers = [...perCheck.entries()]
    .map(([key, set]) => ({ key, count: set.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return { pct, clean, total, sevCounts, advisoryCount: advisory.size, topDrivers };
}

function scoreTier(score) {
  if (score >= 90) return { label: 'Excellent',       color: '#28b17b' };
  if (score >= 75) return { label: 'Good',            color: '#5b8c4a' };
  if (score >= 60) return { label: 'Needs attention', color: '#9A6F0E' };
  return                  { label: 'Critical',        color: '#c0392b' };
}

// Trend of flagged PEOPLE across watcher snapshots. flaggedEmployees is new
// server-side and may be null on old rows: compare the latest snapshot to the
// previous non-null one; hide entirely when either side is unavailable.
function flaggedPeopleTrend(snapshots) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  if (list.length < 2) return null;
  const latest = list[list.length - 1];
  if (latest?.flaggedEmployees == null) return null;
  let prev = null;
  for (let i = list.length - 2; i >= 0; i--) {
    if (list[i]?.flaggedEmployees != null) { prev = list[i]; break; }
  }
  if (!prev) return null;
  const delta = latest.flaggedEmployees - prev.flaggedEmployees;
  if (delta === 0) return null;
  const n = Math.abs(delta);
  const noun = n === 1 ? 'person' : 'people';
  return delta < 0
    ? { text: `▼ ${n} fewer flagged ${noun} than last snapshot`, color: 'var(--calo-700, #1e8359)' }
    : { text: `▲ ${n} more flagged ${noun} than last snapshot`, color: '#9A6F0E' };
}

function HealthCard({ report, snapshots }) {
  const { pct, clean, total, sevCounts, advisoryCount, topDrivers } = computeDataHealth(report);
  const trend = flaggedPeopleTrend(snapshots);
  if (pct == null) return null; // no active-user list in the audit response
  const { label, color } = scoreTier(pct);
  const chips = [
    { sev: 'high', count: sevCounts.high },
    { sev: 'medium', count: sevCounts.medium },
    { sev: 'low', count: sevCounts.low },
  ].filter(c => c.count > 0);
  return (
    <div style={{ ...panel, padding: 24, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 160 }}>
        <div style={{ fontSize: 64, fontWeight: 900, color, letterSpacing: '-0.04em', lineHeight: 1 }}>{pct}%</div>
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-900)', margin: '4px 0' }}>Data health</div>
        <div style={{ fontSize: 13, color: 'var(--ink-700)', fontWeight: 700 }}>
          {clean} of {total} active records with no high/medium issues
        </div>
        {advisoryCount > 0 && (
          <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>
            {advisoryCount} more have only low-severity advisories (don’t affect the score)
          </div>
        )}
        {trend && (
          <div style={{ fontSize: 13, fontWeight: 800, color: trend.color, marginTop: 6 }}>{trend.text}</div>
        )}
        {topDrivers && topDrivers.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
              What’s costing the score
            </div>
            {topDrivers.map(d => (
              <div key={d.key} style={{ fontSize: 12.5, color: 'var(--ink-700)', marginTop: 3 }}>
                {LABELS[d.key] || d.key} · <b>{d.count}</b> {d.count === 1 ? 'person' : 'people'}
              </div>
            ))}
          </div>
        )}
        {chips.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {chips.map(c => (
              <span key={c.sev} style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                background: 'var(--ink-50, #f6f6f4)', border: '1px solid var(--ink-100)',
                color: sevColor(c.sev),
              }}>{c.sev} · {c.count} flags</span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--ink-400, #999)', marginTop: 6 }}>
          Zelt-only: % of active employees with zero flags. Masterfile checks show in their own panels below and don't move this number.
        </div>
      </div>
    </div>
  );
}

// ---- Client-side report builders ------------------------------------------

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isoDateTag(report) {
  return new Date(report.asOf || Date.now()).toISOString().slice(0, 10);
}

function downloadHtmlReport(report) {
  const html = buildHtmlReport(report);
  triggerDownload(`calo-zelt-data-hygiene-${isoDateTag(report)}.html`, html, 'text/html;charset=utf-8');
}

function downloadCsvReport(report) {
  const csv = buildCsvReport(report);
  triggerDownload(`calo-zelt-data-hygiene-${isoDateTag(report)}.csv`, csv, 'text/csv;charset=utf-8');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function compactDetails(it) {
  if (it == null || typeof it !== 'object') return '';
  const skip = new Set(['name', 'legalName', 'value', 'employeeId', 'email', 'entity', 'department', 'site', 'suggestion']);
  const pairs = Object.entries(it)
    .filter(([k, v]) => !skip.has(k) && v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .map(([k, v]) => `${k}=${v}`);
  return pairs.join('; ');
}

function buildCsvReport(report) {
  const cols = ['Check', 'Severity', 'Name', 'Employee ID', 'Entity', 'Department', 'Site', 'Suggestion', 'Details'];
  const rows = [cols];
  for (const [key, items] of Object.entries(report.checks || {})) {
    if (!Array.isArray(items) || !items.length) continue;
    const sev = SEVERITY[key] || 'low';
    const label = LABELS[key] || key;
    for (const it of items) {
      rows.push([
        label,
        sev,
        it.name || it.legalName || it.value || '',
        it.employeeId || '',
        it.entity || '',
        it.department || '',
        it.site || '',
        it.suggestion || it.detail || '',
        compactDetails(it),
      ]);
    }
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

function buildHtmlReport(report) {
  const asOf = new Date(report.asOf || Date.now()).toLocaleString('en-GB');
  const checkBlocks = Object.entries(report.checks || {})
    .filter(([, items]) => Array.isArray(items) && items.length > 0)
    .sort(([a], [b]) => {
      const order = { high: 0, medium: 1, low: 2, info: 3 };
      return (order[SEVERITY[a] || 'low'] - order[SEVERITY[b] || 'low']);
    })
    .map(([key, items]) => {
      const sev = SEVERITY[key] || 'low';
      const sevColor = sev === 'high' ? '#c0392b' : sev === 'medium' ? '#9A6F0E' : sev === 'info' ? '#5b6ee1' : '#28b17b';
      const rows = items.map(it => {
        const title = it.name || it.legalName || it.value || it.employeeId || it.email || '(item)';
        const meta = [
          it.employeeId && `ID ${it.employeeId}`,
          it.entity, it.department, it.site,
          it.leaveDate && `leaveDate ${it.leaveDate}`,
          it.suggestion,
          it.detail,
          it.source,
        ].filter(Boolean).map(escapeHtml).join(' · ');
        return `<li style="padding:6px 0;border-bottom:1px solid #eee"><strong>${escapeHtml(title)}</strong>${meta ? `<div style="font-size:12px;color:#777">${meta}</div>` : ''}</li>`;
      }).join('');
      return `
        <section style="margin-top:24px">
          <div style="border-left:4px solid ${sevColor};padding-left:12px">
            <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${sevColor}">${sev} · ${items.length} flagged</div>
            <h2 style="margin:4px 0 0;font-size:16px;color:#222">${escapeHtml(LABELS[key] || key)}</h2>
          </div>
          <ul style="list-style:none;padding:0;margin:8px 0 0">${rows}</ul>
        </section>`;
    })
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Calo · Zelt Data Hygiene · ${escapeHtml(asOf)}</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;background:#f7f7f7;margin:0;padding:24px;color:#222">
  <div style="max-width:820px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.06)">
    <header style="border-bottom:1px solid #eee;padding-bottom:16px">
      <div style="font-size:11px;font-weight:900;letter-spacing:.16em;color:#888">CALO · ZELT</div>
      <h1 style="margin:4px 0 0;font-size:24px;letter-spacing:-0.02em">Data Hygiene Report</h1>
      <div style="font-size:13px;color:#666;margin-top:6px">${escapeHtml(asOf)} · ${report.totalUsers} total Zelt users</div>
      ${(() => {
        const { pct, clean, total } = computeDataHealth(report);
        if (pct == null) return '';
        const tier = scoreTier(pct);
        return `<div style="margin-top:14px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
          <span style="font-size:48px;font-weight:900;color:${tier.color};letter-spacing:-0.04em;line-height:1">${pct}%</span>
          <span style="font-size:11px;font-weight:800;color:${tier.color};letter-spacing:.06em;text-transform:uppercase;margin-left:8px">${tier.label}</span>
          <span style="font-size:13px;color:#666;font-weight:700">${clean} of ${total} active records fully clean (Zelt-only)</span>
        </div>`;
      })()}
    </header>
    ${checkBlocks || '<p style="margin-top:24px;color:#666">No flagged items.</p>'}
    <footer style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#888">
      Generated from CALO Reports Hub · Data Hygiene
    </footer>
  </div>
</body></html>`;
}

function StatCard({ label, value, muted }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-md)', padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-500)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: muted ? 'var(--ink-700)' : 'var(--ink-900)', letterSpacing: '-0.02em', marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Spinner() {
  return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-500 border-t-transparent" />
  </div>;
}

function sevColor(s) {
  if (s === 'high') return '#c0392b';
  if (s === 'medium') return '#9A6F0E';
  if (s === 'info') return '#5b6ee1';
  return '#28b17b';
}

const panel = { background: '#fff', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)', padding: 24, boxShadow: 'var(--shadow-sm)' };
const errBanner = { background: '#FDECEC', border: '1px solid #f5c6c6', color: '#9f2f2f', padding: 12, borderRadius: 8 };
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: 'var(--ink-700)', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
