import { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import CaloLogo from './CaloLogo';
import { Icon } from './ui';
import { Menu, X, LogOut, Settings as SettingsIcon } from 'lucide-react';

const mainNav = [
  { to: '/',              icon: 'Home',            label: 'Home' },
  { to: '/new',           icon: 'Plus',            label: 'New Report', accent: true },
  { to: '/reports',       icon: 'FolderOpen',      label: 'My Reports' },
  { to: '/templates',     icon: 'LayoutTemplate',  label: 'Templates' },
  { to: '/leave-balances', icon: 'CalendarCheck',  label: 'Leave Balances' },
];

const footerNav = [
  { to: '/guide',    icon: 'BookOpen', label: 'Guide' },
  { to: '/settings', icon: 'Settings', label: 'Settings' },
];

function NavItem({ to, icon, label, active, accent, collapsed, onClick }) {
  const [h, setH] = useState(false);
  let bg = 'transparent', fg = 'var(--ink-700)';
  if (accent && !active) { bg = 'var(--calo-500)'; fg = '#fff'; }
  if (active) { bg = 'var(--ink-900)'; fg = '#fff'; }
  else if (h && !accent) { bg = 'var(--ink-100)'; fg = 'var(--ink-900)'; }
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 'var(--r-md)',
        background: bg, color: fg, fontSize: 14, fontWeight: 700,
        textDecoration: 'none', letterSpacing: '-0.01em',
        justifyContent: collapsed ? 'center' : 'flex-start',
        transition: 'all .16s ease',
      }}
    >
      <Icon name={icon} size={18} />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sideOpen, setSideOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  const handleLogout = () => {
    setUserMenu(false);
    logout();
    navigate('/login');
  };

  const w = collapsed ? 76 : 240;
  const isActive = (to) => to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--ink-50)' }}>
      {/* Mobile-only CSS — inline styles were winning over Tailwind's lg:hidden,
          so we use an explicit media query instead. */}
      <style>{`
        .calo-mobile-only { display: flex; }
        .calo-mobile-overlay { display: block; }
        @media (min-width: 1024px) {
          .calo-mobile-only { display: none !important; }
          .calo-mobile-overlay { display: none !important; }
        }
      `}</style>

      {/* Mobile overlay */}
      {sideOpen && (
        <div
          className="calo-mobile-overlay"
          style={{ position: 'fixed', inset: 0, background: 'rgba(10,31,23,.35)', zIndex: 30 }}
          onClick={() => setSideOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={sideOpen ? 'sidebar-open' : ''}
        style={{
          width: w,
          flexShrink: 0,
          background: '#fff',
          borderRight: '1px solid var(--ink-200)',
          display: 'flex', flexDirection: 'column',
          transition: 'width .25s ease, transform .25s ease',
          position: 'sticky', top: 0, height: '100vh',
          zIndex: 40,
        }}
      >
        <style>{`
          @media (max-width: 1023px) {
            aside {
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              bottom: 0 !important;
              transform: translateX(-100%);
              width: 240px !important;
              z-index: 40 !important;
            }
            aside.sidebar-open { transform: translateX(0); }
          }
        `}</style>

        {/* Logo + collapse toggle */}
        <div style={{ padding: '22px 20px 14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <CaloLogo size={22} color="var(--calo-500)" />
          {!collapsed && (
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.16em', color: 'var(--ink-500)' }}>REPORTS</span>
          )}
          <div style={{ flex: 1 }} />
          {!collapsed && (
            <button
              className="lg:hidden"
              onClick={() => setSideOpen(false)}
              style={{ padding: 4, color: 'var(--ink-500)', border: 'none', background: 'none', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Main nav */}
        <nav style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {mainNav.map(n => (
            <NavItem
              key={n.to}
              {...n}
              active={isActive(n.to)}
              collapsed={collapsed}
              onClick={() => setSideOpen(false)}
            />
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        {/* Footer nav + user */}
        <div style={{ padding: '8px 12px 16px 12px', borderTop: '1px solid var(--ink-100)' }}>
          {footerNav.map(n => (
            <NavItem
              key={n.to}
              {...n}
              active={isActive(n.to)}
              collapsed={collapsed}
              onClick={() => setSideOpen(false)}
            />
          ))}

          {/* User profile */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setUserMenu(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 10px', marginTop: 8, width: '100%',
                background: userMenu ? 'var(--ink-100)' : 'transparent',
                borderRadius: 'var(--r-md)', border: 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--calo-400), var(--calo-700))',
                color: '#fff', fontWeight: 900, fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>{getInitials(user?.name)}</div>
              {!collapsed && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--ink-900)' }}>
                    {user?.name || 'User'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user?.role === 'admin' ? 'Admin' : 'Employee'}{user?.department ? ` · ${user.department}` : ''}
                  </div>
                </div>
              )}
            </button>

            {userMenu && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4,
                background: '#fff', borderRadius: 'var(--r-md)',
                border: '1px solid var(--ink-200)', boxShadow: 'var(--shadow-lg)',
                padding: 4, zIndex: 50,
              }}>
                <button
                  onClick={() => { setUserMenu(false); navigate('/settings'); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent',
                    fontSize: 13, fontWeight: 700, color: 'var(--ink-700)',
                    borderRadius: 'var(--r-sm)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--ink-50)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <SettingsIcon size={14} /> Settings
                </button>
                <button
                  onClick={handleLogout}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent',
                    fontSize: 13, fontWeight: 700, color: 'var(--danger)',
                    borderRadius: 'var(--r-sm)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#FDECEC'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Mobile top bar — hamburger opens drawer, logo goes home.
            Uses .calo-mobile-only so inline styles don't fight the media query. */}
        <header
          className="calo-mobile-only"
          style={{
            height: 56, borderBottom: '1px solid var(--ink-200)',
            background: '#fff', alignItems: 'center',
            padding: '0 8px', flexShrink: 0,
            position: 'sticky', top: 0, zIndex: 20,
          }}
        >
          <button
            onClick={() => setSideOpen(true)}
            aria-label="Open menu"
            title="Open menu"
            style={{
              width: 44, height: 44, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
              border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--ink-700)', borderRadius: 10,
              transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--ink-100)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <Menu size={22} />
          </button>
          <button
            onClick={() => navigate('/')}
            aria-label="Go to home"
            title="Go to home"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              marginLeft: 4, padding: '8px 12px',
              border: 'none', background: 'none', cursor: 'pointer', borderRadius: 10,
              transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--ink-100)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <CaloLogo size={18} color="var(--calo-500)" />
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.16em', color: 'var(--ink-500)' }}>REPORTS</span>
          </button>
        </header>

        <main style={{ flex: 1, padding: '28px 40px', minWidth: 0, overflowX: 'hidden' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
