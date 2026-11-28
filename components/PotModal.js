'use client';
import { useState } from 'react';
import { getSupabase } from '../lib/supabase.js';
import { updateRow } from '../lib/data.js';
import { pushUndo, snapshotOf } from '../lib/undo.js';
import { friendly } from '../lib/errors.js';
import { paletteColor } from '../lib/categories.js';
import Modal from './Modal.js';
import Colors from './Colors.js';
import Term from './Term.js';

export const EMOJIS = ['✈️', '🏝️', '🏠', '🚗', '💍', '🎁', '🎓', '💻', '📱', '🎸', '⛷️', '👶', '🐶', '🛠️', '🪴', '🎮', '📚', '🍽️', '🎟️', '💰', '🛡️', '🏥', '🎄', '🚲'];
const num = (s) => Number(String(s).replace(',', '.')) || 0;

// Ajout / modification d'un pot ou d'un sous-objectif (nom, emoji, couleur, objectif et échéance).
// pot = nœud existant (modification) ou null ; orig = ligne brute en base ; parent = pot parent présélectionné ; mains = pots principaux.
export default function PotModal({ pot, orig, parent, mains = [], sortBase = 0, hasEntries = false, onClose, onSaved }) {
  const isNew = !pot;
  const [f, setF] = useState({
    name: pot ? pot.name : '', emoji: pot && pot.emoji ? pot.emoji : '',
    parent: pot ? (pot.parent_id || '') : (parent || ''),
    target: pot && pot.target != null ? String(pot.target) : '', date: pot && pot.target_date ? pot.target_date : '',
    color: pot && pot.color ? pot.color : paletteColor(sortBase),
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isKid = isNew ? !!f.parent : !!pot.parent_id;

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const sb = getSupabase();
      const row = { name: f.name.trim(), emoji: f.emoji.trim() || null, target: f.target ? num(f.target) : null, target_date: f.date || null };
      if (isNew) {
        const { data, error } = await sb.from('pots').insert({ ...row, parent_id: f.parent || null, color: f.color, sort: sortBase }).select('id').single();
        if (error) throw error;
        pushUndo(isKid ? 'Ajout de sous-objectif' : 'Ajout de pot', async () => { const r = await getSupabase().from('pots').delete().eq('id', data.id); if (r.error) throw r.error; });
      } else {
        if (f.color !== pot.color) row.color = f.color;
        const before = snapshotOf(orig || pot, row);
        const { error } = await sb.from('pots').update(row).eq('id', pot.id);
        if (error) throw error;
        pushUndo(`Modification de « ${pot.name} »`, () => updateRow('pots', pot.id, before));
      }
      onSaved();
    } catch (e2) { setErr(friendly(e2)); setBusy(false); }
  }

  async function remove() {
    const warn = hasEntries || (pot.kids && pot.kids.length) ? ' Son historique (et celui de ses sous-objectifs) sera perdu.' : '';
    if (!window.confirm(`Supprimer « ${pot.name} » ?${warn} Cette action est définitive.`)) return;
    const { error } = await getSupabase().from('pots').delete().eq('id', pot.id);
    if (error) return setErr(friendly(error));
    onSaved();
  }

  return (
    <Modal title={isNew ? (isKid ? 'Nouveau sous-objectif' : 'Nouveau pot') : (isKid ? 'Modifier le sous-objectif' : 'Modifier le pot')} onClose={onClose}>
      <form className="formgrid flat" onSubmit={save}>
        <div className="form">
          <input type="text" className="num" style={{ width: 64, textAlign: 'center', fontSize: 20 }} maxLength={8} placeholder="🙂" value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} aria-label="Emoji" />
          <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nom" required aria-label="Nom" style={{ flex: 1 }} />
        </div>
        <div className="emojis">
          {EMOJIS.map((em) => <button key={em} type="button" className={f.emoji === em ? 'on' : ''} onClick={() => setF({ ...f, emoji: f.emoji === em ? '' : em })}>{em}</button>)}
        </div>
        {isNew && (
          <label className="fld"><span>Rattaché à</span>
            <select value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })}>
              <option value="">Aucun : pot principal</option>
              {mains.map((m) => <option key={m.id} value={m.id}>Sous-objectif de « {m.name} »</option>)}
            </select>
          </label>
        )}
        <div className="form">
          <label className="fld"><span>Objectif (€)</span><input type="text" inputMode="decimal" className="num" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
          <label className="fld"><span><Term k="horizon">Horizon</Term></span><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        </div>
        <Colors value={f.color} onPick={(color) => setF({ ...f, color })} />
        {err && <p className="err">{err}</p>}
        <div className="form">
          <button className="btn" disabled={busy}>{isNew ? 'Créer' : 'Enregistrer'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          {!isNew && !pot.role && <button type="button" className="btn danger" onClick={remove}>Suppr.</button>}
        </div>
      </form>
    </Modal>
  );
}
