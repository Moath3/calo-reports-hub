import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Loader2, Clock } from 'lucide-react';
import CaloLogo from '../components/CaloLogo';

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
      if (err.message?.includes('pending')) {
        setPendingApproval(true);
      } else {
        toast.error(err.message || 'Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel - branding */}
      <div className="hidden lg:flex lg:w-1/2 gradient-header flex-col justify-between p-12 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'radial-gradient(circle at 25% 25%, white 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }} />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <svg viewBox="0 0 120 36" className="h-10 w-auto" xmlns="http://www.w3.org/2000/svg">
              <text x="2" y="30" fontFamily="Inter, system-ui, sans-serif" fontWeight="900" fontSize="34" fill="white" letterSpacing="-1">CALO</text>
            </svg>
            <span className="text-2xl font-bold">Reports</span>
          </div>
          <p className="text-green-100 mt-1 text-sm">Enterprise Report Generation Platform</p>
        </div>
        <div className="relative z-10 space-y-6">
          <div>
            <h2 className="text-3xl font-bold leading-tight">Create beautiful reports<br/>powered by AI</h2>
            <p className="text-green-100 mt-4 max-w-md leading-relaxed">
              Upload your data, let AI structure it, customize with drag-and-drop sections,
              and publish in one click.
            </p>
          </div>
          <div className="flex gap-8 text-sm">
            <div><div className="text-2xl font-bold">AI</div><div className="text-green-200">Powered</div></div>
            <div><div className="text-2xl font-bold">PDF</div><div className="text-green-200">Export</div></div>
            <div><div className="text-2xl font-bold">1-Click</div><div className="text-green-200">Publish</div></div>
          </div>
        </div>
        <p className="relative z-10 text-green-200 text-xs">&copy; 2026 CALO. All rights reserved.</p>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-50">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <svg viewBox="0 0 120 36" className="h-9 w-auto" xmlns="http://www.w3.org/2000/svg">
              <text x="2" y="30" fontFamily="Inter, system-ui, sans-serif" fontWeight="900" fontSize="34" fill="#3DAC6A" letterSpacing="-1">CALO</text>
            </svg>
            <span className="text-xl font-bold text-gray-900">Reports</span>
          </div>

          <div className="card p-8">
            {pendingApproval ? (
              <div className="text-center py-4">
                <div className="mx-auto h-14 w-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                  <Clock className="h-7 w-7 text-amber-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Pending Approval</h2>
                <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                  Your account is awaiting admin approval.<br/>
                  You&apos;ll be able to sign in once your account is activated.
                </p>
                <button
                  onClick={() => { setPendingApproval(false); setMode('login'); }}
                  className="btn-primary mt-6"
                >
                  Back to Sign In
                </button>
              </div>
            ) : (
            <>
            <h1 className="text-2xl font-bold text-gray-900">
              {mode === 'login' ? 'Welcome back' : 'Create account'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {mode === 'login' ? 'Sign in to your account' : 'Register to get started'}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="label">Full Name</label>
                    <input className="input-field" placeholder="John Doe" value={form.name} onChange={e => set('name', e.target.value)} required />
                  </div>
                  <div>
                    <label className="label">Department</label>
                    <input className="input-field" placeholder="Operations (optional)" value={form.department} onChange={e => set('department', e.target.value)} />
                  </div>
                </>
              )}

              <div>
                <label className="label">Email</label>
                <input className="input-field" type="email" placeholder="you@calo.app" value={form.email} onChange={e => set('email', e.target.value)} required />
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    className="input-field pr-10"
                    type={showPw ? 'text' : 'password'}
                    placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter password'}
                    value={form.password}
                    onChange={e => set('password', e.target.value)}
                    required
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setShowPw(!showPw)}>
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {mode === 'register' && (
                <div>
                  <label className="label">Company Code</label>
                  <input className="input-field" placeholder="Enter registration code" value={form.companyCode} onChange={e => set('companyCode', e.target.value)} required />
                  <p className="text-xs text-gray-400 mt-1">Get this from your administrator</p>
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-gray-500">
              {mode === 'login' ? (
                <>Don&apos;t have an account?{' '}
                  <button onClick={() => setMode('register')} className="text-green-600 hover:text-green-700 font-medium">Register</button>
                </>
              ) : (
                <>Already have an account?{' '}
                  <button onClick={() => setMode('login')} className="text-green-600 hover:text-green-700 font-medium">Sign In</button>
                </>
              )}
            </div>
            </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
