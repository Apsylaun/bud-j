'use client';
import { useState } from 'react';
import { eur } from '../lib/format.js';
import { rpc, r2 } from '../lib/pots.js';
import { pushUndo } from '../lib/undo.js';

const num = (s) => Number(String(s).replace(',', '.')) || 0;

// Imputer (tout ou partie d') une dépense à un ou plusieurs pots.
export default function PotSplit({ tx, nodes, existing, onDone, onCancel }) {
  const max = Math.abs(tx.amount);
  const [lines, setLines] = useState(
    existing.length
      ? existing.map((l) => ({ pot_id: l.pot_id, amount: String(l.amount) }))
      : [{ pot_id: nodes[0]?.id || '', amount: String(max) }]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const total = r2(lines.reduce((s, l) => s + num(l.amount), 0));
  const before = Object.fromEntries(existing.map((l) => [l.pot_id, l.amount]));
  const used = {};
  for (const l of lines) used[l.pot_id] = (used[l.pot_id] || 0) + num(l.amount);
  const alerts = nodes
    .filter((n) => used[n.id] !== undefined)
    .map((n) => ({ label: n.label, after: r2(n.balance + (before[n.id] || 0) - used[n.id]) }))
    .filter((a) => a.after < 0);

  const patch = (i, p) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  async function save(clear) {
    if (!clear && total > max + 0.005) return setErr('Le total dépasse le montant de la dépense.');
    setBusy(true); setErr('');
    try {
      const p_lines = clear ? [] : lines.filter((l) => num(l.amount) > 0).map((l) => ({ pot_id: l.pot_id, amount: num(l.amount) }));
      await rpc('save_pot_spend', { p_tx: tx.id, p_lines });
      const prevLines = existing.map((l) => ({ pot_id: l.pot_id, amount: l.amount }));
      pushUndo('Imputation à un pot', () => rpc('save_pot_spend', { p_tx: tx.id, p_lines: prevLines }));
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="split">
      <p className="hint">Payer {eur(max, 2)} avec :</p>
      {lines.map((l, i) => (
        <div className="form" key={i}>
          <select value={l.pot_id} onChange={(e) => patch(i, { pot_id: e.target.value })} aria-label="Pot">
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
          <input type="text" inputMode="decimal" className="num" value={l.amount} onChange={(e) => patch(i, { amount: e.target.value })} aria-label="Montant" />
          {lines.length > 1 && <button className="btn ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Retirer</button>}
        </div>
      ))}
      <p className="hint">
        Imputé : {eur(total, 2)} · Reste sur le budget courant : {eur(Math.max(0, r2(max - total)), 2)}
      </p>
      {alerts.map((a) => <p key={a.label} className="warn">« {a.label} » passera à {eur(a.after, 2)}. Tu pourras réajuster l’allocation d’un mois passé dans Pots.</p>)}
      {err && <p className="err">{err}</p>}
      <div className="form">
        <button className="btn ghost" onClick={() => setLines((ls) => [...ls, { pot_id: nodes[0]?.id || '', amount: '0' }])}>Ajouter un pot</button>
        <button className="btn" disabled={busy} onClick={() => save(false)}>Enregistrer</button>
        {existing.length > 0 && <button className="btn danger" disabled={busy} onClick={() => save(true)}>Retirer l’imputation</button>}
        <button className="btn ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}
