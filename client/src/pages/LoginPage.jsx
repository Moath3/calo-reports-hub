import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Loader2, Clock } from 'lucide-react';
import CaloLogo from '../components/CaloLogo';
import { Btn } from '../components/ui';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', department: '', companyCode: '' });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
        toast.success('Welcome back!');
      } else {
        if (!form.name.trim()) { toast.error('Name is required'); setLoading(false); return; }
        if (form.password.length < 8) { toast.error('Password must be 8+ characters'); setLoading(false); return; }
        const result = await register(form);
        if (result.pending) {
          setPendingApproval(true);
          toast.success('Registration submitted!');
        } else {
          toast.success('Account created!');
        }
      }
    } catch (err) {
      if (err.message?.includes('pending')) setPendingApproval(true);
      else toast.error(err.message || 'Something went wrong');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--ink-50)' }}>
      {/* Left hero panel (desktop only) */}
      <div
        className="hero-panel"
        style={{
          width: '50%',
          background: 'linear-gradient(135deg, #01432D 0%, #016040 45%, #02B376 100%)',
          padding: 48,
          color: '#fff',
          flexDirection: 'column', justifyContent: 'space-between',
          position: 'relative', overflow: 'hidden',
          display: 'flex',
        }}
      >
        {/* Pattern */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: .08, pointerEvents: 'none' }} viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="leaf-p" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <circle cx="40" cy="40" r="1.5" fill="#fff" />
              <path d="M14 66 Q 40 42 66 66" stroke="#fff" strokeWidth="1.2" fill="none" opacity=".4" />
            </pattern>
          </defs>
          <rect width="800" height="1000" fill="url(#leaf-p)" />
        </svg>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CaloLogo size={32} color="#fff" />
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.2em', color: 'rgba(255,255,255,.85)' }}>REPORTS</span>
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '.2em', opacity: .75, marginBottom: 14 }}>ENTERPRISE REPORT PLATFORM</div>
          <h2 style={{ fontSize: 52, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.02, margin: 0 }}>
            Turn data into a<br/>
            <span style={{ color: '#CFF3E3' }}>beautiful Calo report.</span>
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,.85)', marginTop: 22, maxWidth: 480, lineHeight: 1.55 }}>
            Drop a file. Calo AI builds the sections. You review, refine, and publish in about 2 minutes.
          </p>
          <div style={{ display: 'flex', gap: 36, marginTop: 34, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,.2)' }}>
            {[
              { t: 'AI',     s: 'Powered' },
              { t: 'PDF',    s: 'Export' },
              { t: '1-Click', s: 'Publish' },
            ].map(m => (
              <div key={m.t}>
                <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em' }}>{m.t}</div>
                <div style={{ fontSize: 12, color: 'rgba(207,243,227,.85)', fontWeight: 700 }}>{m.s}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1, fontSize: 11, color: 'rgba(207,243,227,.7)', fontWeight: 700 }}>
          © 2026 Calo. All rights reserved.
        </div>
      </div>

      {/* Right form panel */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--ink-50)' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          {/* Mobile logo */}
          <div className="mobile-logo" style={{ display: 'none', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <CaloLogo size={30} color="var(--calo-500)" />
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.18em', color: 'var(--ink-500)' }}>REPORTS</span>
          </div>

          <div style={{ background: '#fff', borderRadius: 'var(--r-lg)', border: '1px solid var(--ink-200)', boxShadow: 'var(--shadow-sm)', padding: 32 }}>
            {pendingApproval ? (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ width: 56, height: 56, margin: '0 auto 16px', borderRadius: 28, background: '#FEF5E4', color: '#8A5A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Clock size={28} />
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>Pending approval</h2>
                <p style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 10, lineHeight: 1.55 }}>
                  Your account is awaiting admin approval.<br/>
                  You'll be able to sign in once it's activated.
                </p>
                <div style={{ marginTop: 22 }}>
                  <Btn variant="primary" onClick={() => { setPendingApproval(false); setMode('login'); }}>Back to sign in</Btn>
                </div>
              </div>
            ) : (
              <>
                <div className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</div>
                <h1 style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.03em', margin: 0, lineHeight: 1.1 }}>
                  {mode === 'login' ? 'Sign in' : 'Create account'}
                </h1>
                <p style={{ fontSize: 14, color: 'var(--ink-500)', marginTop: 8 }}>
                  {mode === 'login' ? 'Continue to your workspace.' : 'Register to get started with Calo Reports.'}
                </p>

                <form onSubmit={handleSubmit} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {mode === 'register' && (
                    <>
                      <div>
                        <label className="label">Full name</label>
                        <input className="input-field" placeholder="Your full name" value={form.name} onChange={e => set('name', e.target.value)} required />
                      </div>
                      <div>
                        <label className="label">Department</label>
                        <input className="input-field" placeholder="Operations (optional)" value={form.department} onChange={e => set('department', e.target.value)} />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="label">Email</label>
                    <input className="input-field" type="email" placeholder="you@calo.app" value={form.email} onChange={e => set('email', e.target.value)} required autoComplete="email" />
                  </div>

                  <div>
                    <label className="label">Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="input-field"
                        type={showPw ? 'text' : 'password'}
                        placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter password'}
                        value={form.password}
                        onChange={e => set('password', e.target.value)}
                        required
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        style={{ paddingRight: 36 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(v => !v)}
                        style={{
                          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                          background: 'none', border: 'none', color: 'var(--ink-400)', cursor: 'pointer', padding: 4,
                        }}
                      >
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {mode === 'register' && (
                    <div>
                      <label className="label">Company code</label>
                      <input className="input-field" placeholder="Enter registration code" value={form.companyCode} onChange={e => set('companyCode', e.target.value)} required />
                      <p style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 4 }}>Get this from your administrator</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary"
                    style={{ width: '100%', marginTop: 4, padding: '13px 18px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
                  >
                    {loading && <Loader2 size={16} className="animate-spin" style={{ animation: 'spinner 1s linear infinite' }} />}
                    {mode === 'login' ? 'Sign in' : 'Create account'}
                  </button>
                </form>

                <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: 'var(--ink-500)' }}>
                  {mode === 'login' ? (
                    <>Don't have an account?{' '}
                      <button onClick={() => setMode('register')} style={{ color: 'var(--calo-700)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
                        Register
                      </button>
                    </>
                  ) : (
                    <>Already have an account?{' '}
                      <button onClick={() => setMode('login')} style={{ color: 'var(--calo-700)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
                        Sign in
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1023px) {
          .hero-panel { display: none !important; }
          .mobile-logo { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
