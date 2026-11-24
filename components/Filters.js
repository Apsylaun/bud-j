'use client';
import { PRESETS } from '../lib/format.js';

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg" role="group">
      {options.map(([k, l]) => (
        <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function PeriodPicker({ value, onChange }) {
  return (
    <div className="period">
      <select value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value })} aria-label="Période">
        {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {value.preset === 'custom' && (
        <>
          <input type="date" aria-label="Du" value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <input type="date" aria-label="Au" value={value.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </div>
  );
}
