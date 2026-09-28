import React, { useEffect } from 'react';

/** صورة رمزية: صورة إن وجدت وإلا الحرف الأول */
export function Avatar({ name, src, size = '' }) {
  return (
    <div className={`avatar ${size}`}>
      {src ? <img src={src} alt={name} /> : <span>{(name || '؟').trim().charAt(0)}</span>}
    </div>
  );
}

/** شارة حالة هادئة — لا أحمر أبدًا */
export function StatusChip({ status, t }) {
  const map = {
    ok: { cls: 'chip-ok', label: t.statusOk },
    awaiting: { cls: 'chip-wait', label: t.statusAwaiting },
    notconfirmed: { cls: 'chip-muted', label: t.statusNotConfirmed },
    unshared: { cls: 'chip-muted', label: t.statusUnshared },
  };
  const m = map[status] || map.unshared;
  return (
    <span className={`chip ${m.cls}`}>
      <span className="st-dot" />
      {m.label}
    </span>
  );
}

/** نافذة سفلية (Bottom Sheet) */
export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grab" />
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      className={`toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
    />
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, text, sub }) {
  return (
    <div className="empty">
      {icon}
      <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>{text}</div>
      {sub && <div style={{ fontSize: 14, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
