// Shared UI primitives — faithful implementation of claude.ai/design handoff
import React, { useState } from 'react';
import * as L from 'lucide-react';

// Icon — resolves lucide-react names safely
export function Icon({ name, size = 16, color = 'currentColor', stroke = 2, className = '', style = {} }) {
  const C = L[name] || L.Circle;
  return <C size={size} color={color} strokeWidth={stroke} className={className} style={style} />;
}

// Button — pill radius, 6 variants, 3 sizes
export function Btn({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  children,
  onClick,
  disabled,
  full,
  style = {},
  type = 'button',
  ...rest
}) {
  const paddings = { sm: '8px 14px', md: '11px 18px', lg: '14px 24px' };
  const fontSize = { sm: 13, md: 14, lg: 15 };
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: paddings[size] || paddings.md,
    fontSize: fontSize[size] || fontSize.md,
    fontWeight: 700,
    borderRadius: 'var(--r-pill)',
    transition: 'all .18s ease',
    width: full ? '100%' : 'auto',
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap',
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit',
  };
  const variants = {
    primary:   { background: 'var(--calo-500)', color: '#fff', boxShadow: '0 1px 0 rgba(255,255,255,.2) inset, 0 2px 6px rgba(2,179,118,.25)' },
    secondary: { background: '#fff',            color: 'var(--ink-900)', border: '1px solid var(--ink-200)' },
    ghost:     { background: 'transparent',     color: 'var(--ink-700)' },
    dark:      { background: 'var(--ink-900)',  color: '#fff' },
    leaf:      { background: 'var(--calo-50)',  color: 'var(--calo-800)', border: '1px solid var(--calo-100)' },
    danger:    { background: '#fff',            color: 'var(--danger)',   border: '1px solid #F5D5D5' },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...(variants[variant] || variants.primary), opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === 'primary') e.currentTarget.style.background = 'var(--calo-600)';
        if (variant === 'secondary') e.currentTarget.style.background = 'var(--ink-50)';
        if (variant === 'ghost') e.currentTarget.style.background = 'var(--ink-100)';
        if (variant === 'leaf') e.currentTarget.style.background = 'var(--calo-100)';
      }}
      onMouseLeave={(e) => {
        if (variant === 'primary') e.currentTarget.style.background = 'var(--calo-500)';
        if (variant === 'secondary') e.currentTarget.style.background = '#fff';
        if (variant === 'ghost') e.currentTarget.style.background = 'transparent';
        if (variant === 'leaf') e.currentTarget.style.background = 'var(--calo-50)';
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}
      {children && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={size === 'lg' ? 18 : 16} />}
    </button>
  );
}

// Card — paper + shadow, optional hover
export function Card({ children, padding = 20, style = {}, hover = false, onClick, className = '' }) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      className={className}
      style={{
        background: '#fff',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--ink-200)',
        padding,
        boxShadow: hover && h ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
        transition: 'all .2s ease',
        cursor: onClick ? 'pointer' : 'default',
        transform: hover && h ? 'translateY(-2px)' : 'none',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Pill badge
export function Pill({ tone = 'neutral', children, icon, size = 'md' }) {
  const tones = {
    green:   { bg: 'var(--calo-50)',  fg: 'var(--calo-800)', bd: 'var(--calo-100)' },
    solid:   { bg: 'var(--calo-500)', fg: '#fff',            bd: 'var(--calo-500)' },
    amber:   { bg: '#FEF5E4',         fg: '#8A5A1A',          bd: '#F6E0B6' },
    red:     { bg: '#FDECEC',         fg: '#8C2929',          bd: '#F5CFCF' },
    blue:    { bg: '#E9EEFA',         fg: '#2E4699',          bd: '#CEDAF2' },
    neutral: { bg: 'var(--ink-100)',  fg: 'var(--ink-700)',  bd: 'var(--ink-200)' },
    ink:     { bg: 'var(--ink-900)',  fg: '#fff',             bd: 'var(--ink-900)' },
  };
  const t = tones[tone] || tones.neutral;
  const s = size === 'sm' ? { padding: '3px 8px', fontSize: 11 } : { padding: '4px 10px', fontSize: 12 };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
      borderRadius: 'var(--r-pill)', fontWeight: 700,
      letterSpacing: '-0.01em', ...s,
    }}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

// Eyebrow — uppercase tracked label
export function Eyebrow({ children, color = 'var(--calo-700)', style = {} }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 900, letterSpacing: '0.14em',
      textTransform: 'uppercase', color, marginBottom: 6, ...style,
    }}>{children}</div>
  );
}

// KPI tile
export function KpiTile({ label, value, unit, change, trend = 'stable', accent = false }) {
  const trendColor = trend === 'up' ? 'var(--calo-600)' : trend === 'down' ? 'var(--danger)' : 'var(--ink-500)';
  const trendIcon = trend === 'up' ? 'TrendingUp' : trend === 'down' ? 'TrendingDown' : 'Minus';
  return (
    <div style={{
      background: accent ? 'var(--calo-900)' : '#fff',
      color: accent ? '#fff' : 'var(--ink-900)',
      borderRadius: 'var(--r-lg)',
      border: accent ? '1px solid var(--calo-900)' : '1px solid var(--ink-200)',
      padding: '20px 22px',
      boxShadow: accent ? 'none' : 'var(--shadow-sm)',
      position: 'relative', overflow: 'hidden',
    }}>
      {accent && (
        <div style={{
          position: 'absolute', right: -40, top: -40, width: 140, height: 140,
          borderRadius: '50%', background: 'var(--calo-500)', opacity: .18,
        }} />
      )}
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: accent ? 'var(--calo-200)' : 'var(--ink-500)' }}>{label}</div>
      <div className="num" style={{ fontSize: 34, fontWeight: 900, letterSpacing: '-0.03em', marginTop: 8, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 16, fontWeight: 700, color: accent ? 'var(--calo-200)' : 'var(--ink-500)', marginLeft: 4 }}>{unit}</span>}
      </div>
      {change && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: accent ? '#fff' : trendColor, marginTop: 10 }}>
          <Icon name={trendIcon} size={13} />
          {change}
        </div>
      )}
    </div>
  );
}

// Leaf — decorative brand mark
export function Leaf({ size = 28, color = 'var(--calo-500)', style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={style}>
      <path d="M4 28C4 28 6 14 16 8C24 3 28 4 28 4C28 4 29 8 26 16C20 26 14 28 4 28Z" fill={color} />
      <path d="M4 28L18 12" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// PageHeader — title + eyebrow + actions row
export function PageHeader({ eyebrow, title, subtitle, actions, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.05, color: 'var(--ink-900)' }}>
            {title}
          </h1>
          {subtitle && <p style={{ margin: '8px 0 0 0', fontSize: 15, color: 'var(--ink-500)', maxWidth: 640, lineHeight: 1.5 }}>{subtitle}</p>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      {children && <div style={{ marginTop: 18 }}>{children}</div>}
    </div>
  );
}

// Decorative hero background pattern
export function BrandPattern() {
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: .08, pointerEvents: 'none' }} viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="leaf-pattern" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
          <circle cx="30" cy="30" r="1.5" fill="#fff" />
          <path d="M10 50 Q 30 35 50 50" stroke="#fff" strokeWidth="1" fill="none" opacity=".4" />
        </pattern>
      </defs>
      <rect width="800" height="400" fill="url(#leaf-pattern)" />
    </svg>
  );
}

// Labeled input
export function LabeledInput({ label, value, onChange, type = 'text', placeholder, color, autoComplete }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {color && <div style={{ width: 36, height: 36, borderRadius: 8, background: value, border: '1px solid var(--ink-200)', flexShrink: 0 }} />}
        <input
          type={type}
          value={value || ''}
          onChange={e => onChange && onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="input-field"
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
}
