'use client';
import { colorOf } from '../lib/categories.js';

export function Tag({ name, color, children }) {
  return <span className="tag" style={{ '--c': color || colorOf(name) }}>{children || name}</span>;
}

// Pastille cliquable : un <select> transparent recouvre le tag (menu natif, pratique sur mobile).
export function TagSelect({ value, onChange, options, placeholder = 'À catégoriser' }) {
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <span className="tagsel">
      {value ? <Tag name={value} /> : <span className="tag todo">{placeholder}</span>}
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label="Catégorie">
        <option value="">{placeholder}</option>
        {list.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </span>
  );
}
