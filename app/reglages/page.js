'use client';
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadRules, loadBalances, reapplyRules, loadCategories, updateRow } from '../../lib/data.js';
import { categoryNames, categoryList, groupList, SWATCHES, KIND_LABEL, PROTECTED_KINDS } from '../../lib/categories.js';
import { ENVELOPES, BANKS, kindForEnvelope } from '../../lib/accounts.js';
import { KINDS } from '../../lib/wealth.js';
import { pushUndo, snapshotOf, onDataChange } from '../../lib/undo.js';
import { friendly } from '../../lib/errors.js';
import { Tag } from '../../components/Tag.js';
import Term from '../../components/Term.js';
import Colors from '../../components/Colors.js';
import Modal from '../../components/Modal.js';
import PotModal from '../../components/PotModal.js';
import { loadPots, loadEntries, buildTree, ownBalances } from '../../lib/pots.js';
import { eur, dateFr, monthLabel } from '../../lib/format.js';

const check = ({ error }) => { if (error) throw error; };

// Compte : nom, banque, type d'enveloppe (qui détermine le type de compte), compte commun.
function AccountModal({ account, banks, onClose, onSaved }) {
  const isNew = !account;
  const [f, setF] = useState({
    name: account ? account.name : '', bank: account ? account.bank : '',
    envelope: account ? account.envelope || 'Compte courant' : 'Compte courant',
    kind: account ? account.account_kind || 'Courant' : 'Courant', shared: account ? account.shared : false,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const sb = getSupabase();
      const row = { name: f.name.trim(), bank: f.bank.trim() || 'À préciser', envelope: f.envelope, account_kind: f.kind };
      if (isNew) {
        const { data, error } = await sb.from('accounts').insert({ ...row, shared: f.shared }).select('id').single();
        if (error) throw error;
        pushUndo('Ajout de compte', async () => check(await getSupabase().from('accounts').delete().eq('id', data.id)));
      } else {
        const before = snapshotOf(account, row);
        check(await sb.from('accounts').update(row).eq('id', account.id));
        pushUndo(`Modification de « ${account.name} »`, () => updateRow('accounts', account.id, before));
      }
      onSaved();
    } catch (e2) { setErr(friendly(e2)); setBusy(false); }
  }

  return (
    <Modal title={isNew ? 'Nouveau compte' : 'Modifier le compte'} onClose={onClose}>
      <form className="formgrid flat" onSubmit={save}>
        <label className="fld"><span>Nom du compte</span><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ex : PEA Bourse Direct" required /></label>
        <label className="fld"><span><Term k="banque">Banque</Term></span>
          <input type="text" list="banks" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} placeholder="ex : Crédit Agricole" />
          <datalist id="banks">{banks.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <label className="fld"><span>Type d’<Term k="enveloppe">enveloppe</Term></span>
          <select value={f.envelope} onChange={(e) => setF({ ...f, envelope: e.target.value, kind: kindForEnvelope(e.target.value) })}>
            {ENVELOPES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="fld"><span><Term k="typecompte">Type de compte</Term></span>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        {isNew && <label className="check"><input type="checkbox" checked={f.shared} onChange={(e) => setF({ ...f, shared: e.target.checked })} /> Compte commun (visible par les deux utilisateurs)</label>}
        <p className="hint" style={{ margin: 0 }}>Les actifs liés à ce compte héritent automatiquement de sa banque, de son enveloppe et de son type.</p>
        {err && <p className="err">{err}</p>}
        <div className="form">
          <button className="btn" disabled={busy}>{isNew ? 'Créer' : 'Enregistrer'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </Modal>
  );
}

// Catégorie : nom, couleur, nature, groupe.
function CategoryModal({ cat, onClose, onSaved }) {
  const locked = PROTECTED_KINDS.includes(cat.kind);
  const groups = groupList();
  const [f, setF] = useState({ name: cat.name, color: cat.color, kind: cat.kind, group: cat.group_id || '' });
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
      if ((f.group || null) !== (cat.group_id || null)) patch.group_id = f.group || null;
      if (Object.keys(patch).length) check(await sb.from('categories').update(patch).eq('id', cat.id));
      pushUndo(`Modification de « ${cat.name} »`, async () => {
        const c = getSupabase();
        if (renamed) check(await c.rpc('rename_category', { p_old: name, p_new: cat.name }));
        if (Object.keys(patch).length) check(await c.from('categories').update({ color: cat.color, kind: cat.kind, group_id: cat.group_id || null }).eq('id', cat.id));
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
          ? <span className="hint" style={{ margin: 0 }}>{KIND_LABEL[cat.kind]} : le nom et la nature sont fixes.</span>
          : (
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Nature">
              <option value="expense">Dépense</option>
              <option value="income">Revenu</option>
            </select>
          )}
        <label className="fld"><span><Term k="groupe">Groupe</Term> (schéma de flux)</span>
          <select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>
            <option value="">Aucun groupe</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
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

// Groupe de catégories : nom, couleur et catégories membres.
function GroupModal({ group, onClose, onSaved }) {
  const isNew = !group;
  const cats = categoryList();
  const [f, setF] = useState({ name: group ? group.name : '', color: group ? group.color : SWATCHES[4], members: cats.filter((c) => group && c.group_id === group.id).map((c) => c.name) });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (n) => setF((x) => ({ ...x, members: x.members.includes(n) ? x.members.filter((m) => m !== n) : [...x.members, n] }));

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const sb = getSupabase();
      const name = f.name.trim();
      if (!name) throw new Error('Le nom ne peut pas être vide.');
      const prevMembers = cats.filter((c) => group && c.group_id === group.id).map((c) => c.name);
      let gid;
      if (isNew) {
        const sort = groupList().reduce((m, g) => Math.max(m, g.sort || 0), 0) + 1;
        const { data, error } = await sb.from('category_groups').insert({ name, color: f.color, sort }).select('id').single();
        if (error) throw error;
        gid = data.id;
      } else {
        gid = group.id;
        check(await sb.from('category_groups').update({ name, color: f.color }).eq('id', gid));
      }
      const removed = prevMembers.filter((n) => !f.members.includes(n));
      if (removed.length) check(await sb.from('categories').update({ group_id: null }).in('name', removed));
      if (f.members.length) check(await sb.from('categories').update({ group_id: gid }).in('name', f.members));
      pushUndo(isNew ? `Création du groupe « ${name} »` : `Modification du groupe « ${group.name} »`, async () => {
        const c = getSupabase();
        if (isNew) { check(await c.from('category_groups').delete().eq('id', gid)); return; }
        check(await c.from('category_groups').update({ name: group.name, color: group.color }).eq('id', gid));
        if (f.members.length) check(await c.from('categories').update({ group_id: null }).in('name', f.members));
        if (prevMembers.length) check(await c.from('categories').update({ group_id: gid }).in('name', prevMembers));
      });
      onSaved();
    } catch (e2) { setErr(friendly(e2)); setBusy(false); }
  }

  return (
    <Modal title={isNew ? 'Nouveau groupe' : 'Modifier le groupe'} onClose={onClose}>
      <form className="formgrid flat" onSubmit={save}>
        <div className="form">
          <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ex : Vie quotidienne" required aria-label="Nom du groupe" />
          <span className="tag" style={{ '--c': f.color }}>{f.name || 'Aperçu'}</span>
        </div>
        <Colors value={f.color} onPick={(color) => setF({ ...f, color })} />
        <span className="hint" style={{ margin: 0 }}>Catégories du groupe (une catégorie n’appartient qu’à un groupe) :</span>
        <div className="chk">
          {cats.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={f.members.includes(c.name)} onChange={() => toggle(c.name)} />
              <Tag name={c.name} color={c.color} />
              {c.group && !f.members.includes(c.name) && (!group || c.group_id !== group.id) ? <span className="muted">dans « {c.group} »</span> : null}
            </label>
          ))}
        </div>
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
  const [groups, setGroups] = useState([]);
  const [catsOk, setCatsOk] = useState(true);
  const [potData, setPotData] = useState(null); // null = pots non installés
  const [modal, setModal] = useState(null); // { type, item }
  const [msg, setMsg] = useState('');
  const [cat, setCat] = useState({ name: '', kind: 'expense', color: SWATCHES[0] });
  const [rule, setRule] = useState({ pattern: '', category: 'Courses' });
  const sb = getSupabase();

  const refresh = useCallback(async () => {
    try {
      const [a, r, b, c, p] = await Promise.all([loadAccounts(), loadRules(), loadBalances(), loadCategories(), Promise.all([loadPots(), loadEntries()]).catch(() => null)]);
      setAccounts(a); setRules(r); setBalances(b); setCatsOk(c !== null); setPotData(p ? { pots: p[0], entries: p[1] } : null);
      setCats(c || []); setGroups(groupList());
    } catch (e) { setMsg(friendly(e)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => onDataChange(refresh), [refresh]);

  const attempt = async (fn) => {
    setMsg('');
    try { await fn(); await refresh(); } catch (e) { setMsg(friendly(e)); }
  };
  const saved = () => { setModal(null); refresh(); };
  const banks = [...new Set([...accounts.map((a) => a.bank).filter((b) => b && b !== 'À préciser'), ...BANKS])];

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
  const delGroup = (g) => {
    if (window.confirm(`Supprimer le groupe « ${g.name} » ? Ses catégories ne sont pas supprimées.`)) attempt(async () => check(await sb.from('category_groups').delete().eq('id', g.id)));
  };

  const potTree = potData ? buildTree(potData.pots, ownBalances(potData.entries)) : [];
  const delPot = (p) => {
    const warn = (potData && potData.entries.some((e) => e.pot_id === p.id)) || (p.kids && p.kids.length) ? ' Son historique (et celui de ses sous-objectifs) sera perdu.' : '';
    if (window.confirm(`Supprimer « ${p.name} » ?${warn} Cette action est définitive.`)) attempt(async () => check(await sb.from('pots').delete().eq('id', p.id)));
  };
  const potRow = (p, kid) => (
    <div className={'item' + (kid ? ' kid' : '')} key={p.id}>
      <span>
        {p.emoji ? `${p.emoji} ` : <i className="dot" style={{ background: p.color }} />} {p.name}
        {p.role === 'rest' && <span className="badge"><Term k="reste">absorbe l’écart</Term></span>}
        {p.role === 'deficit' && <span className="badge"><Term k="imprevu">absorbe les déficits</Term></span>}
        {p.target ? <span className="badge">objectif {eur(p.target)}{p.target_date ? ` · avant ${monthLabel(p.target_date.slice(0, 7))}` : ''}</span> : null}
      </span>
      <span className="form">
        <button className="btn ghost sm" onClick={() => setModal({ type: 'pot', item: p })}>Modifier</button>
        {!p.role && <button className="btn danger sm" onClick={() => delPot(p)}>Suppr.</button>}
      </span>
    </div>
  );

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

      <details className="toggle sec-pat">
        <summary>Comptes</summary>
        <div className="body">
      {accounts.map((a) => (
        <div className="item" key={a.id}>
          <div>
            {a.name}
            <span className="badge">{a.bank}</span>
            {a.envelope && <span className="badge">{a.envelope}</span>}
            {a.account_kind && <span className="badge">{a.account_kind}</span>}
            {a.shared && <span className="badge">Commun</span>}
            {balances[a.id] && <div className="muted">Dernier solde connu : {eur(balances[a.id].balance, 2)} au {dateFr(balances[a.id].date)}</div>}
          </div>
          <span className="form">
            <button className="btn ghost sm" onClick={() => setModal({ type: 'account', item: a })}>Modifier</button>
            <button className="btn danger sm" onClick={() => delAccount(a)}>Suppr.</button>
          </span>
        </div>
      ))}
      <p style={{ marginTop: 12 }}><button className="btn" onClick={() => setModal({ type: 'account', item: null })}>+ Ajouter un compte</button></p>
      <p className="hint">Un compte commun est visible et modifiable par les deux utilisateurs. Les actifs du patrimoine se rattachent à un compte et héritent de sa banque, de son enveloppe et de son type.</p>
        </div>
      </details>

      <details className="toggle sec-ops">
        <summary>Catégories</summary>
        <div className="body">
          {!catsOk && <div className="warn">Catégories modifiables indisponibles : exécute <code>supabase/008_update.sql</code> dans Supabase.</div>}
          {catsOk && (
            <>
              <p className="hint">Les catégories sont communes aux deux utilisateurs. Renommer ou supprimer une catégorie met à jour toutes les opérations.</p>
              {cats.map((c) => (
                <div className="item" key={c.id}>
                  <span><Tag name={c.name} color={c.color} /><span className="badge">{KIND_LABEL[c.kind]}</span>{c.group && <span className="badge">{c.group}</span>}</span>
                  <span className="form">
                    <button className="btn ghost sm" onClick={() => setModal({ type: 'cat', item: c })}>Modifier</button>
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

      <details className="toggle sec-ops">
        <summary><Term k="groupe">Groupes de catégories</Term></summary>
        <div className="body">
          {!catsOk && <div className="warn">Groupes indisponibles : exécute <code>supabase/008_update.sql</code> dans Supabase.</div>}
          {catsOk && (
            <>
              <p className="hint">Les groupes regroupent des catégories dans le schéma de flux du tableau de bord (revenus → groupes → catégories).</p>
              {groups.map((g) => (
                <div className="item" key={g.id}>
                  <span>
                    <span className="tag" style={{ '--c': g.color }}>{g.name}</span>{' '}
                    <span className="muted">{cats.filter((c) => c.group_id === g.id).map((c) => c.name).join(', ') || 'aucune catégorie'}</span>
                  </span>
                  <span className="form">
                    <button className="btn ghost sm" onClick={() => setModal({ type: 'group', item: g })}>Modifier</button>
                    <button className="btn danger sm" onClick={() => delGroup(g)}>Suppr.</button>
                  </span>
                </div>
              ))}
              <p style={{ marginTop: 12 }}><button className="btn" onClick={() => setModal({ type: 'group', item: null })}>+ Ajouter un groupe</button></p>
            </>
          )}
        </div>
      </details>

      <details className="toggle sec-ops">
        <summary>Règles de catégorisation</summary>
        <div className="body">
      <p className="hint">Si le libellé contient le mot-clé, la catégorie est appliquée à l’import. Tes choix manuels ne sont jamais écrasés. Des règles par défaut existent (courses, transport, <Term k="placement">placement</Term>, retraits…). On peut aussi créer une règle depuis la fenêtre « Modifier » d’une opération.</p>
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
        </div>
      </details>

      <details className="toggle sec-pots">
        <summary>Pots</summary>
        <div className="body">
          {potData === null ? <div className="warn">Pots indisponibles : exécute <code>supabase/002_pots.sql</code> dans Supabase.</div> : (
            <>
              <p className="hint">Un pot reçoit une part de l’excédent mensuel ; un <Term k="sousobjectif">sous-objectif</Term> est un projet daté rattaché à un pot. « Reste » et « Imprévu » sont obligatoires.</p>
              {potTree.map((m) => (
                <div key={m.id}>
                  {potRow(m, false)}
                  {m.kids.map((k) => potRow(k, true))}
                </div>
              ))}
              <div className="form" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => setModal({ type: 'pot', item: null, parent: '' })}>+ Ajouter un pot</button>
                <button className="btn ghost" disabled={!potTree.length} onClick={() => setModal({ type: 'pot', item: null, parent: potTree[0] ? potTree[0].id : '' })}>+ Sous-objectif</button>
              </div>
            </>
          )}
        </div>
      </details>

      <details className="toggle">
        <summary>Session</summary>
        <div className="body"><button className="btn ghost" onClick={() => sb.auth.signOut()}>Se déconnecter</button></div>
      </details>

      {modal && modal.type === 'account' && <AccountModal account={modal.item} banks={banks} onClose={() => setModal(null)} onSaved={saved} />}
      {modal && modal.type === 'cat' && <CategoryModal cat={modal.item} onClose={() => setModal(null)} onSaved={saved} />}
      {modal && modal.type === 'group' && <GroupModal group={modal.item} onClose={() => setModal(null)} onSaved={saved} />}
      {modal && modal.type === 'pot' && potData && (
        <PotModal pot={modal.item} orig={modal.item ? potData.pots.find((x) => x.id === modal.item.id) : null} parent={modal.parent}
          mains={potTree} sortBase={potData.pots.length} hasEntries={!!modal.item && potData.entries.some((e) => e.pot_id === modal.item.id)}
          onClose={() => setModal(null)} onSaved={saved} />
      )}
    </>
  );
}
