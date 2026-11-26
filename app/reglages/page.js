'use client';
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadRules, loadBalances, reapplyRules, loadCategories, updateRow } from '../../lib/data.js';
import { categoryNames, SWATCHES, KIND_LABEL, PROTECTED_KINDS } from '../../lib/categories.js';
import { pushUndo, onDataChange } from '../../lib/undo.js';
import { friendly } from '../../lib/errors.js';
import { Tag } from '../../components/Tag.js';
import Colors from '../../components/Colors.js';
import Modal from '../../components/Modal.js';
import { eur, dateFr } from '../../lib/format.js';

const BANKS = ['Crédit Agricole', 'Fortuneo', 'Crédit Mutuel', 'Bourse Direct', 'Autre'];
const check = ({ error }) => { if (error) throw error; };

// Fenêtre « Modifier » d'une catégorie : nom, couleur et nature réunis.
function CategoryModal({ cat, onClose, onSaved }) {
  const locked = PROTECTED_KINDS.includes(cat.kind);
  const [f, setF] = useState({ name: cat.name, color: cat.color, kind: cat.kind });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const sb = getSupabase();
      const name = f.name.trim();
      if (!name) throw new Error('Le nom ne peut pas être vide.');
      const renamed = !locked && name !== cat.name;
      if (renamed) check(await sb.rpc('rename_category', { p_old: cat.name, p_new: name }));
      const patch = {};
      if (f.color !== cat.color) patch.color = f.color;
      if (!locked && f.kind !== cat.kind) patch.kind = f.kind;
      if (Object.keys(patch).length) check(await sb.from('categories').update(patch).eq('id', cat.id));
      pushUndo(`Modification de « ${cat.name} »`, async () => {
        const c = getSupabase();
        if (renamed) check(await c.rpc('rename_category', { p_old: name, p_new: cat.name }));
        if (Object.keys(patch).length) check(await c.from('categories').update({ color: cat.color, kind: cat.kind }).eq('id', cat.id));
      });
      onSaved();
    } catch (e2) { setErr(friendly(e2)); setBusy(false); }
  }

  return (
    <Modal title="Modifier la catégorie" onClose={onClose}>
      <form className="formgrid flat" onSubmit={save}>
        <div className="form">
          <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={locked} required aria-label="Nom" />
          <Tag name={f.name || 'Aperçu'} color={f.color} />
        </div>
        {locked
          ? <span className="hint" style={{ margin: 0 }}>{KIND_LABEL[cat.kind]} : le nom et la nature sont fixes, seule la couleur se modifie.</span>
          : (
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Nature">
              <option value="expense">Dépense</option>
              <option value="income">Revenu</option>
            </select>
          )}
        <Colors value={f.color} onPick={(color) => setF({ ...f, color })} />
        {err && <p className="err">{err}</p>}
        <div className="form">
          <button className="btn" disabled={busy}>Enregistrer</button>
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Reglages() {
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [catsOk, setCatsOk] = useState(true);
  const [editCat, setEditCat] = useState(null);
  const [msg, setMsg] = useState('');
  const [acc, setAcc] = useState({ name: '', bank: BANKS[0], shared: false });
  const [cat, setCat] = useState({ name: '', kind: 'expense', color: SWATCHES[0] });
  const [rule, setRule] = useState({ pattern: '', category: 'Courses' });
  const sb = getSupabase();

  const refresh = useCallback(async () => {
    try {
      const [a, r, b, c] = await Promise.all([loadAccounts(), loadRules(), loadBalances(), loadCategories()]);
      setAccounts(a); setRules(r); setBalances(b); setCatsOk(c !== null);
      setCats(c || []);
    } catch (e) { setMsg(friendly(e)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => onDataChange(refresh), [refresh]);

  const attempt = async (fn) => {
    setMsg('');
    try { await fn(); await refresh(); } catch (e) { setMsg(friendly(e)); }
  };

  const addAccount = (e) => {
    e.preventDefault();
    attempt(async () => {
      const { data, error } = await sb.from('accounts').insert({ name: acc.name.trim(), bank: acc.bank, shared: acc.shared }).select('id').single();
      if (error) throw error;
      pushUndo('Ajout de compte', () => updateAfterDelete('accounts', data.id));
      setAcc({ name: '', bank: BANKS[0], shared: false });
    });
  };
  const updateAfterDelete = async (table, id) => check(await getSupabase().from(table).delete().eq('id', id));
  const delAccount = (a) => {
    if (window.confirm(`Supprimer « ${a.name} » et toutes ses opérations ? Cette action est définitive.`)) attempt(async () => check(await sb.from('accounts').delete().eq('id', a.id)));
  };

  const addCat = (e) => {
    e.preventDefault();
    attempt(async () => {
      const sort = cats.reduce((m, c) => Math.max(m, c.sort || 0), 0) + 1;
      const name = cat.name.trim();
      check(await sb.from('categories').insert({ name, kind: cat.kind, color: cat.color, sort }));
      pushUndo(`Création de « ${name} »`, async () => check(await getSupabase().rpc('delete_category', { p_name: name })));
      setCat({ ...cat, name: '' });
    });
  };
  const delCat = (c) => {
    if (window.confirm(`Supprimer « ${c.name} » ? Les opérations concernées repasseront en « à catégoriser ». Cette action est définitive.`)) {
      attempt(async () => check(await sb.rpc('delete_category', { p_name: c.name })));
    }
  };

  const syncRules = async () => {
    const n = await reapplyRules(await loadRules());
    setMsg(`${n} opération(s) recatégorisée(s).`);
  };
  const addRule = (e) => {
    e.preventDefault();
    attempt(async () => {
      const row = { pattern: rule.pattern.trim().toLowerCase(), category: rule.category };
      const { data, error } = await sb.from('rules').insert(row).select('id').single();
      if (error) throw error;
      pushUndo('Ajout de règle', async () => {
        check(await getSupabase().from('rules').delete().eq('id', data.id));
        await reapplyRules(await loadRules());
      });
      setRule({ ...rule, pattern: '' });
      await syncRules();
    });
  };
  const delRule = (r) => attempt(async () => {
    check(await sb.from('rules').delete().eq('id', r.id));
    pushUndo('Suppression de règle', async () => {
      check(await getSupabase().from('rules').insert({ pattern: r.pattern, category: r.category }));
      await reapplyRules(await loadRules());
    });
    await syncRules();
  });

  return (
    <>
      <h1>Réglages</h1>
      {msg && <div className="warn">{msg}</div>}

      <h2>Comptes</h2>
      {accounts.map((a) => (
        <div className="item" key={a.id}>
          <div>
            {a.name}<span className="badge">{a.bank}</span>{a.shared && <span className="badge">Commun</span>}
            {balances[a.id] && <div className="muted">Dernier solde connu : {eur(balances[a.id].balance, 2)} au {dateFr(balances[a.id].date)}</div>}
          </div>
          <button className="btn danger sm" onClick={() => delAccount(a)}>Suppr.</button>
        </div>
      ))}
      <form className="form" onSubmit={addAccount} style={{ marginTop: 12 }}>
        <input type="text" placeholder="Nom du compte" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} required />
        <select value={acc.bank} onChange={(e) => setAcc({ ...acc, bank: e.target.value })}>
          {BANKS.map((b) => <option key={b}>{b}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={acc.shared} onChange={(e) => setAcc({ ...acc, shared: e.target.checked })} /> Compte commun</label>
        <button className="btn">Ajouter</button>
      </form>
      <p className="hint">Un compte commun est visible et modifiable par les deux utilisateurs. Un compte personnel n’est visible que par toi.</p>

      <details className="toggle">
        <summary>Catégories</summary>
        <div className="body">
          {!catsOk && <div className="warn">Catégories modifiables indisponibles : exécute <code>supabase/007_update.sql</code> dans Supabase.</div>}
          {catsOk && (
            <>
              <p className="hint">Les catégories sont communes aux deux utilisateurs. Renommer ou supprimer une catégorie met à jour toutes les opérations.</p>
              {cats.map((c) => (
                <div className="item" key={c.id}>
                  <span><Tag name={c.name} color={c.color} /><span className="badge">{KIND_LABEL[c.kind]}</span></span>
                  <span className="form">
                    <button className="btn ghost sm" onClick={() => setEditCat(c)}>Modifier</button>
                    {!PROTECTED_KINDS.includes(c.kind) && <button className="btn danger sm" onClick={() => delCat(c)}>Suppr.</button>}
                  </span>
                </div>
              ))}
              <form onSubmit={addCat} style={{ marginTop: 14 }}>
                <div className="form">
                  <input type="text" placeholder="Nouveau tag (ex : Cadeaux)" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} required />
                  <select value={cat.kind} onChange={(e) => setCat({ ...cat, kind: e.target.value })} aria-label="Nature">
                    <option value="expense">Dépense</option>
                    <option value="income">Revenu</option>
                  </select>
                  <Tag name={cat.name || 'Aperçu'} color={cat.color} />
                  <button className="btn">Créer</button>
                </div>
                <Colors value={cat.color} onPick={(color) => setCat({ ...cat, color })} />
              </form>
            </>
          )}
        </div>
      </details>

      <h2>Règles de catégorisation</h2>
      <p className="hint">Si le libellé contient le mot-clé, la catégorie est appliquée à l’import. Tes choix manuels ne sont jamais écrasés. Des règles par défaut existent (courses, transport, placement, retraits…). On peut aussi créer une règle depuis la fenêtre « Modifier » d’une opération.</p>
      {rules.map((r) => (
        <div className="item" key={r.id}>
          <span>« {r.pattern} » <Tag name={r.category} /></span>
          <button className="btn danger sm" onClick={() => delRule(r)}>Suppr.</button>
        </div>
      ))}
      <form className="form" onSubmit={addRule} style={{ marginTop: 12 }}>
        <input type="text" placeholder="Mot-clé (ex : martin yann)" value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} required />
        <select value={rule.category} onChange={(e) => setRule({ ...rule, category: e.target.value })}>
          {categoryNames().map((c) => <option key={c}>{c}</option>)}
        </select>
        <button className="btn">Ajouter</button>
      </form>

      <h2>Session</h2>
      <button className="btn ghost" onClick={() => sb.auth.signOut()}>Se déconnecter</button>

      {editCat && <CategoryModal cat={editCat} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); refresh(); }} />}
    </>
  );
}
