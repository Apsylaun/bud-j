'use client';
import { useId } from 'react';

// Tirelire simplifiée : le niveau de remplissage (0 à 1) monte dans le corps.
export default function PigBank({ fill = 0, color = '#7C9A82', negative = false, label = 'Tirelire' }) {
  const id = useId().replace(/:/g, '');
  const f = Math.max(0, Math.min(1, fill));
  const top = 90 - f * 60;
  const s = negative ? 'var(--err)' : 'var(--ink)';
  const line = { stroke: s, strokeWidth: 2.5, strokeLinejoin: 'round', strokeLinecap: 'round' };
  return (
    <svg className="pigsvg" viewBox="0 0 130 104" role="img" aria-label={label}>
      <defs><clipPath id={`b${id}`}><ellipse cx="58" cy="60" rx="42" ry="30" /></clipPath></defs>
      <path d="M17 54 q-13 -1 -9 -14 q4 -5 9 1" fill="none" {...line} />
      <rect x="31" y="82" width="12" height="16" rx="4" fill="var(--bg)" {...line} />
      <rect x="71" y="82" width="12" height="16" rx="4" fill="var(--bg)" {...line} />
      <ellipse cx="58" cy="60" rx="42" ry="30" fill="var(--bg)" />
      <rect x="10" y={top} width="100" height={100 - top} fill={color} opacity="0.5" clipPath={`url(#b${id})`} />
      <ellipse cx="58" cy="60" rx="42" ry="30" fill="none" {...line} />
      <path d="M77 34 L88 20 L94 39 Z" fill="var(--bg)" {...line} />
      <rect x="96" y="52" width="20" height="16" rx="7" fill="var(--bg)" {...line} />
      <circle cx="104" cy="60" r="1.6" fill={s} />
      <circle cx="110" cy="60" r="1.6" fill={s} />
      <circle cx="88" cy="49" r="2.4" fill={s} />
      <rect x="46" y="31" width="22" height="4" rx="2" fill={s} />
    </svg>
  );
}
