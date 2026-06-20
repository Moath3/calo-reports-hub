# T&A diagnostic tools

Repeatable, country-agnostic utilities for the Time & Attendance engine. Both
read file paths from env vars (no hardcoded paths), print **aggregate stats
only**, and keep any name-level detail in a local CSV — never in stdout.

Run from the repo root with Node 18+:

```powershell
export PATH="/c/Program Files/nodejs:$PATH"   # Git Bash on Windows
```

## identityMapping.mjs — who is badging, and are they in scope?

Matches an attendance export against one or more HR masters (KSA Luqmat, KSA
3rd-party, GCC, …), auto-detecting the join-key column **per master** by overlap
with the attendance IDs, then splits matched employees into blue-collar
production (in scope) vs managers/admins (excluded by position).

```powershell
$env:TNA_ATTENDANCE = 'C:\path\First In Last Out ... .csv'
$env:TNA_MASTERS    = 'Luqmat=C:\path\KSA Masterfile.xlsx;3rd-Party=C:\path\HR Masterfile 3rd Party.xlsx'
# add GCC the same way: ...;GCC=C:\path\Calo Master Employee Tracker GCC.xlsx
# optional: $env:TNA_DETAIL_CSV = 'C:\path\out.csv'   (default ./tna-mapping-detail.csv)
node server/src/services/tna/tools/identityMapping.mjs
```

Notes:
- Masters are `Label=path` pairs separated by `;` (label optional).
- The join key is chosen automatically: KSA resolves to numeric `Emp Number`;
  GCC IDs look like `FTE0001` so the key there is `Empl. ID` / `National_ID` —
  confirmed by which column actually overlaps the attendance.
- To run GCC you also need **GCC attendance** (a GCC export or a BioTime pull
  filtered to a GCC country). The KSA export only contains KSA badgers.

## parityCheck.mjs — does the engine reproduce the recon?

Runs the real `classifyDay` over an attendance export and diffs per-employee
OT-days against the recon's `Employee Detail` sheet. Exits non-zero on any
mismatch, so it can gate a build.

```powershell
$env:TNA_ATTENDANCE = 'C:\path\First In Last Out ... .csv'
$env:TNA_RECON      = 'C:\path\CALO_May2026_Attendance_Report.xlsx'
# optional: $env:TNA_MONTH = '2026-05'   (else derived from the recon filename)
node server/src/services/tna/tools/parityCheck.mjs
```

Validated on May 2026: 537/537 employees exact, 6,386 OT-days, 512 with OT.

## runPeriod.mjs — the actual OT run (per-country thresholds)

Computes per-employee overtime using the **per-country** rule — **UAE counts OT
after 10h; KSA, Kuwait and Bahrain after 9h** — joins to HR masters by ID (no
name-gating; attendance often has first-name only), and scopes to blue-collar
production. Prints a per-country summary; per-employee detail -> local CSV.

```powershell
$env:TNA_ATTENDANCE = 'C:\path\Over time Punch IN & OUT Report ... .csv'
$env:TNA_MASTERS    = 'GCC=C:\path\Calo Master Employee Tracker GCC.xlsx'   # optional: enables scope + names
# optional: $env:TNA_MONTH = '2026-05'   (YYYY-MM filter; omit for a custom pay period)
node server/src/services/tna/tools/runPeriod.mjs
```

Country is resolved from the attendance `Department` (e.g. "CALO UAE"), falling
back to the master's entity/location; unknown-country employees use the 9h
default and are flagged. The summary also shows what a flat-9h rule *would* have
counted, so the per-country saving is visible.

Validated on the UAE May 16–Jun 15 period: 145/145 joined, 100 blue-collar in
scope, 1,249 OT-days at 10h (vs 1,657 if 9h were wrongly applied).

## mappingReport.mjs (in ../identity/)

Same idea as `identityMapping.mjs` but pulls employees **live from BioTime**
instead of an attendance file. Run it yourself with your BioTime login — it
keeps all PII local.
