// Verifies a @calo.app address against the Google Workspace directory (Admin SDK),
// so a new joiner's email can be confirmed as a real, active account rather than
// any made-up word@calo.app. Directory data is admin-only, so this uses the shared
// service account with domain-wide delegation impersonating a Workspace admin
// (WORKSPACE_ADMIN_EMAIL). Returns structured status; never probes mail.
import fetch from 'node-fetch';
import { isConfigured as saConfigured, mintAccessToken } from './googleAuth.js';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';

function adminSub() { return process.env.WORKSPACE_ADMIN_EMAIL || ''; }

export function directoryConfigured() {
  return saConfigured() && !!adminSub();
}

export function isCaloEmail(email) {
  return /^[^@\s]+@calo\.app$/i.test(String(email || '').trim());
}

// { found:false } when no such account; otherwise active/suspended/archived + profile.
export async function lookupWorkspaceUser(email) {
  const e = String(email || '').trim().toLowerCase();
  const token = await mintAccessToken({ scope: SCOPE, sub: adminSub() });
  const res = await fetch(
    `https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(e)}?projection=basic&viewType=admin_view`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return { found: false, email: e };
  if (!res.ok) {
    const txt = (await res.text().catch(() => '')).slice(0, 200);
    const hint = res.status === 403
      ? ' (grant the service account domain-wide delegation for admin.directory.user.readonly, enable the Admin SDK API, and set WORKSPACE_ADMIN_EMAIL to a Workspace admin)'
      : '';
    const err = new Error(`Directory ${res.status}${hint}: ${txt}`);
    err.status = res.status;
    throw err;
  }
  const u = await res.json();
  return {
    found: true,
    email: u.primaryEmail || e,
    suspended: !!u.suspended,
    archived: !!u.archived,
    active: !u.suspended && !u.archived,
    name: u.name?.fullName || null,
    orgUnitPath: u.orgUnitPath || null,
    lastLoginTime: u.lastLoginTime || null,
    creationTime: u.creationTime || null,
  };
}
