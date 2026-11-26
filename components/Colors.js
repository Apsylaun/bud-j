'use client';
import { SWATCHES } from '../lib/categories.js';

export default function Colors({ value, onPick }) {
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button key={c} type="button" className={value === c ? 'on' : ''} style={{ background: c }} onClick={() => onPick(c)} aria-label={`Couleur ${c}`} />
      ))}
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#9AA0A6'} onChange={(e) => onPick(e.target.value)} aria-label="Couleur personnalisée" />
    </div>
  );
}
