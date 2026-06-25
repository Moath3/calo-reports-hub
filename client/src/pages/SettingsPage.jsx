import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  User, Lock, Shield, Loader2, Save, Users, ToggleLeft, ToggleRight, Clock, CheckCircle, XCircle, Plug
} from 'lucide-react';

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
  const [tab, setTab] = useState('profile');
  const [profileForm, setProfileForm] = useState({ name: user?.name || '', department: user?.department || '' });
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [conn, setConn] = useState(null);
  const [testingConn, setTestingConn] = useState(false);

  const runConnectionTest = async () => {
    setTestingConn(true);
    try {
      setConn(await api.testConnections());
    } catch (err) {
      toast.error(err.message || 'Test failed');
    } finally {
      setTestingConn(false);
    }
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.updateProfile(profileForm);
      updateUser(res.user);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (pwForm.newPw !== pwForm.confirm) { toast.error('Passwords do not match'); return; }
    if (pwForm.newPw.length < 8) { toast.error('Password must be 8+ characters'); return; }
    setSaving(true);
    try {
      await api.changePassword(pwForm.current, pwForm.newPw);
      toast.success('Password changed');
      setPwForm({ current: '', newPw: '', confirm: '' });
    } catch (err) {
      toast.error(err.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  const loadUsers = async () => {
    if (usersLoaded) return;
    setLoadingUsers(true);
    try {
      const res = await api.getUsers();
      setUsers(res.users || []);
      setUsersLoaded(true);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const toggleUserStatus = async (uid) => {
    try {
      const res = await api.toggleUser(uid);
      toast.success(res.message);
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, is_active: u.is_active ? 0 : 1 } : u));
    } catch (err) {
      toast.error(err.message || 'Failed');
    }
  };

  const toggleRole = async (uid, currentRole) => {
    const next = currentRole === 'admin' ? 'employee' : 'admin';
    if (!confirm(`Set this user's role to ${next}?`)) return;
    try {
      const res = await api.setUserRole(uid, next);
      toast.success(res.message);
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, role: next } : u));
    } catch (err) {
      toast.error(err.message || 'Failed');
    }
  };

  const tabs = [
    { key: 'profile', label: 'Profile', icon: User },
    { key: 'password', label: 'Password', icon: Lock },
    ...(user?.role === 'admin' ? [
      { key: 'users', label: 'Manage Users', icon: Shield },
      { key: 'integrations', label: 'Integrations', icon: Plug },
    ] : []),
  ];

  return (
    <div className="space-y-5 animate-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your account</p>
      </div>

      <div className="flex gap-6 flex-col lg:flex-row">
        {/* Sidebar */}
        <div className="lg:w-56 shrink-0">
          <nav className="space-y-1">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); if (t.key === 'users') loadUsers(); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.key ? 'bg-green-50 text-green-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Profile */}
          {tab === 'profile' && (
            <div className="card p-6 max-w-lg space-y-5">
              <h2 className="text-lg font-bold text-gray-900">Profile</h2>

              <div className="flex items-center gap-4 pb-4 border-b border-gray-100">
                <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <User className="h-8 w-8 text-green-700" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{user?.name}</div>
                  <div className="text-sm text-gray-500">{user?.email}</div>
                  <span className={`mt-1 inline-block ${user?.role === 'admin' ? 'badge-green' : 'badge-blue'}`}>
                    {user?.role}
                  </span>
                </div>
              </div>

              <form onSubmit={handleProfileSave} className="space-y-4">
                <div>
                  <label className="label">Full Name</label>
                  <input className="input-field" value={profileForm.name} onChange={e => setProfileForm(p => ({...p, name: e.target.value}))} required />
                </div>
                <div>
                  <label className="label">Department</label>
                  <input className="input-field" value={profileForm.department} onChange={e => setProfileForm(p => ({...p, department: e.target.value}))} placeholder="e.g. Operations" />
                </div>
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
                </button>
              </form>
            </div>
          )}

          {/* Password */}
          {tab === 'password' && (
            <div className="card p-6 max-w-lg space-y-5">
              <h2 className="text-lg font-bold text-gray-900">Change Password</h2>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div>
                  <label className="label">Current Password</label>
                  <input className="input-field" type="password" value={pwForm.current} onChange={e => setPwForm(p => ({...p, current: e.target.value}))} required />
                </div>
                <div>
                  <label className="label">New Password</label>
                  <input className="input-field" type="password" value={pwForm.newPw} onChange={e => setPwForm(p => ({...p, newPw: e.target.value}))} placeholder="At least 8 characters" required />
                </div>
                <div>
                  <label className="label">Confirm New Password</label>
                  <input className="input-field" type="password" value={pwForm.confirm} onChange={e => setPwForm(p => ({...p, confirm: e.target.value}))} required />
                </div>
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Update Password
                </button>
              </form>
            </div>
          )}

          {/* User management (admin only) */}
          {tab === 'users' && user?.role === 'admin' && (
            <div className="space-y-4">
              {/* Pending approvals */}
              {!loadingUsers && users.filter(u => !u.is_active).length > 0 && (
                <div className="card border-amber-200 bg-amber-50/50">
                  <div className="px-6 py-4 border-b border-amber-200 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-amber-600" />
                    <h2 className="text-lg font-bold text-amber-800">Pending Approval ({users.filter(u => !u.is_active).length})</h2>
                  </div>
                  <div className="divide-y divide-amber-100">
                    {users.filter(u => !u.is_active).map(u => (
                      <div key={u.id} className="px-6 py-4 flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                          <Clock className="h-5 w-5 text-amber-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">{u.name}</div>
                          <div className="text-xs text-gray-500">{u.email} &middot; {u.department || 'No department'}</div>
                          <div className="text-xs text-gray-400 mt-0.5">Registered {new Date(u.created_at).toLocaleDateString()}</div>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          <Clock className="h-3 w-3" /> Pending
                        </span>
                        <button
                          onClick={() => toggleUserStatus(u.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
                        >
                          <CheckCircle className="h-4 w-4" /> Approve
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All users */}
              <div className="card">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                  <Users className="h-5 w-5 text-gray-600" />
                  <h2 className="text-lg font-bold text-gray-900">All Users</h2>
                </div>

                {loadingUsers ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-green-600" />
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {users.filter(u => u.is_active).map(u => (
                      <div key={u.id} className="px-6 py-4 flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                          <User className="h-5 w-5 text-gray-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">{u.name}</div>
                          <div className="text-xs text-gray-500">{u.email} &middot; {u.department || 'No department'}</div>
                        </div>
                        {u.id !== user.id ? (
                          <button
                            onClick={() => toggleRole(u.id, u.role)}
                            className={u.role === 'admin' ? 'badge-green' : 'badge-blue'}
                            style={{ cursor: 'pointer', border: 'none' }}
                            title={`Click to ${u.role === 'admin' ? 'demote to employee' : 'promote to admin'}`}
                          >
                            {u.role}
                          </button>
                        ) : (
                          <span className={u.role === 'admin' ? 'badge-green' : 'badge-blue'}>{u.role}</span>
                        )}
                        <span className="badge-green">Active</span>
                        {u.id !== user.id && (
                          <button onClick={() => toggleUserStatus(u.id)} className="btn-ghost p-1.5" title="Deactivate">
                            <ToggleRight className="h-5 w-5 text-green-600" />
                          </button>
                        )}
                      </div>
                    ))}
                    {users.filter(u => u.is_active).length === 0 && (
                      <div className="px-6 py-12 text-center text-sm text-gray-400">No active users</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Integrations (admin only) */}
          {tab === 'integrations' && user?.role === 'admin' && (
            <div className="card p-6 max-w-lg space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Integrations</h2>
                <p className="text-sm text-gray-500 mt-0.5">Check that the API keys set in the server environment are valid. Keys are never shown here.</p>
              </div>

              <button onClick={runConnectionTest} disabled={testingConn} className="btn-primary flex items-center gap-2">
                {testingConn ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Test connections
              </button>

              {conn && (
                <div className="space-y-2">
                  {Object.values(conn.services).map((s) => (
                    <div key={s.label} className={`flex items-start gap-3 rounded-lg border p-3 ${s.ok ? 'border-green-200 bg-green-50/50' : s.configured ? 'border-red-200 bg-red-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
                      {s.ok
                        ? <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                        : <XCircle className={`h-5 w-5 shrink-0 mt-0.5 ${s.configured ? 'text-red-600' : 'text-amber-600'}`} />}
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900">{s.label}</div>
                        <div className="text-xs text-gray-600">{s.message}</div>
                      </div>
                    </div>
                  ))}
                  <div className="text-xs text-gray-400">Checked {new Date(conn.checkedAt).toLocaleTimeString()}</div>
                </div>
              )}

              <p className="text-xs text-gray-400">Set keys in Render → Environment (<code>CLAUDE_API_KEY</code>, <code>NETLIFY_ACCESS_TOKEN</code>), then click Test connections.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
