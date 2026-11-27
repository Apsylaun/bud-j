'use client';
import { useEffect, useRef } from 'react';

// Bouton de filtre avec menu déroulant (se ferme au clic à l'extérieur).
export function FilterMenu({ label, summary, active, children, className = '', align }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && ref.current.open && !ref.current.contains(e.target)) ref.current.open = false; };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <details className={'fmenu ' + className} ref={ref}>
      <summary className={active ? 'on' : ''}>{label}{summary ? ` : ${summary}` : ''}</summary>
      <div className={'fpop' + (align === 'right' ? ' right' : '')}>{children}</div>
    </details>
  );
}

// options : [{ value, label, node? }]
export function Checklist({ options, value, onChange }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="chk">
      {options.map((o) => (
        <label key={o.value} className="check">
          <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
          {o.node || o.label}
        </label>
      ))}
      {value.length > 0 && <button type="button" className="btn ghost sm" onClick={() => onChange([])}>Effacer</button>}
    </div>
  );
}
