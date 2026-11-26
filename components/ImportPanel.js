'use client';
import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../lib/supabase.js';
import { loadRules, loadCategories, fetchAll } from '../lib/data.js';
import { decodeBuffer, parseImport } from '../lib/parsers.js';
import { makeCategorizer, norm } from '../lib/rules.js';
import { categoryList, paletteColor } from '../lib/categories.js';
import { pushUndo } from '../lib/undo.js';
import { friendly } from '../lib/errors.js';
import { eur, dateFr } from '../lib/format.js';
import { Tag } from './Tag.js';
import Modal from './Modal.js';

// Import d'un CSV bancaire (Fortuneo, Crédit Agricole) ou du modèle GSheet (catégorie = colonne Motif, commentaire = colonne Note).
export default function ImportPanel({ accounts, onDone, onClose }) {
  const [accountId, setAccountId] = useState(accounts[0] ? accounts[0].id : '');
  const [rules, setRules] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [known, setKnown] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadRules().then(setRules).catch(() => {}); }, []);

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setError(''); setParsed(null); setKnown(null); setFileName(f.name);
    try { setParsed(parseImport(decodeBuffer(await f.arrayBuffer()))); }
    catch (err) { setError(err.message); }
  }

  // Doublons : empreintes déjà présentes sur ce compte, sur la plage de dates du fichier.
  useEffect(() => {
    if (!parsed || !accountId || !parsed.rows.length) { setKnown(null); return; }
    let off = false;
    const dates = parsed.rows.map((r) => r.date).sort();
    fetchAll((a, b) => getSupabase().from('transactions').select('hash').eq('account_id', accountId)
      .gte('date', dates[0]).lte('date', dates[dates.length - 1]).order('id').range(a, b))
      .then((r) => { if (!off) setKnown(new Set(r.map((x) => x.hash))); })
      .catch((e) => { if (!off) setError(friendly(e)); });
    return () => { off = true; };
  }, [parsed, accountId]);

  const categorize = useMemo(() => makeCategorizer(rules), [rules]);
  const byNorm = useMemo(() => Object.fromEntries(categoryList().map((c) => [norm(c.name), c.name])), []);
  const fresh = useMemo(() => (parsed && known
    ? parsed.rows.filter((r) => !known.has(r.hash)).map((r) => {
      const given = r.category ? (byNorm[norm(r.category)] || r.category) : null;
      return { ...r, category: given || categorize(r.label), source: given ? 'manual' : 'rule' };
    })
    : []), [parsed, known, categorize, byNorm]);
  const existing = new Set(categoryList().map((c) => c.name));
  const newCats = [...new Set(fresh.map((r) => r.category).filter((c) => c && !existing.has(c)))];

  async function doImport() {
    setBusy(true); setError('');
    try {
      const sb = getSupabase();
      if (newCats.length) {
        const base = categoryList().length;
        const max = categoryList().reduce((m, c) => Math.max(m, c.sort || 0), 0);
        const r = await sb.from('categories').insert(newCats.map((name, i) => ({ name, kind: 'expense', color: paletteColor(base + i), sort: max + 1 + i })));
        if (r.error) throw r.error;
        await loadCategories();
      }
      const payload = fresh.map((r) => ({
        account_id: accountId, date: r.date, label: r.label, amount: r.amount, hash: r.hash,
        category: r.category, cat_source: r.category ? r.source : null, comment: r.comment || null,
      }));
      const ids = [];
      for (let i = 0; i < payload.length; i += 500) {
        const { data, error: err } = await sb.from('transactions')
          .upsert(payload.slice(i, i + 500), { onConflict: 'account_id,hash', ignoreDuplicates: true }).select('id');
        if (err) throw err;
        ids.push(...data.map((x) => x.id));
      }
      const { balance, balanceDate } = parsed.meta;
      if (balance != null && balanceDate) {
        await sb.from('account_balances').upsert({ account_id: accountId, date: balanceDate, balance }, { onConflict: 'account_id,date' });
      }
      pushUndo(`Import de ${ids.length} opération(s)`, async () => {
        for (let i = 0; i < ids.length; i += 100) {
          const { error: e2 } = await getSupabase().from('transactions').delete().in('id', ids.slice(i, i + 100));
          if (e2) throw e2;
        }
      });
      const todo = payload.filter((p) => !p.category).length;
      onDone(`${ids.length} opération(s) importée(s)${newCats.length ? `, ${newCats.length} catégorie(s) créée(s)` : ''}${todo ? `, ${todo} à catégoriser` : ''}.`);
    } catch (e) { setError(friendly(e)); setBusy(false); }
  }

  const dates = parsed ? parsed.rows.map((r) => r.date).sort() : [];
  const inSum = fresh.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const outSum = fresh.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);

  return (
    <Modal title="Importer des opérations" onClose={onClose}>
      <div className="formgrid">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Compte">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.bank}{a.shared ? ' (commun)' : ''}</option>)}
        </select>
        <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={!accountId} />
        <p className="hint" style={{ margin: 0 }}>Fortuneo, Crédit Agricole ou modèle GSheet (colonnes Date, Libellé, Montant, Crédit, Motif, Note). Les opérations déjà importées sont ignorées.</p>
        {error && <p className="err">{error}</p>}
        {parsed && (
          <>
            <p className="muted" style={{ margin: 0 }}>
              <b>{fileName}</b> : format {parsed.format}, {parsed.rows.length} lignes du {dates.length ? dateFr(dates[0]) : '–'} au {dates.length ? dateFr(dates[dates.length - 1]) : '–'}.
              {known && <> {fresh.length} nouvelle{fresh.length > 1 ? 's' : ''}, {parsed.rows.length - fresh.length} déjà présente{parsed.rows.length - fresh.length > 1 ? 's' : ''}.</>}
              {parsed.meta.balance != null && <> Solde indiqué par la banque : {eur(parsed.meta.balance, 2)} au {dateFr(parsed.meta.balanceDate)}.</>}
            </p>
            {parsed.errors.length > 0 && <p className="err">{parsed.errors.length} ligne(s) illisible(s) ignorée(s).</p>}
            {newCats.length > 0 && <p className="hint" style={{ margin: 0 }}>Catégories à créer : {newCats.join(', ')}.</p>}
            {fresh.length > 0 && (
              <>
                <p style={{ margin: 0 }}>Entrées {eur(inSum, 2)} · Sorties {eur(outSum, 2)}</p>
                <div className="scroll-x">
                  <table className="prev"><tbody>
                    {fresh.slice(0, 10).map((r) => (
                      <tr key={r.hash}>
                        <td>{dateFr(r.date)}</td>
                        <td>{r.label}<br />{r.category ? <Tag name={r.category} /> : <span className="muted">À catégoriser</span>}{r.comment ? <span className="muted"> · note</span> : null}</td>
                        <td>{eur(r.amount, 2)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
                {fresh.length > 10 && <p className="muted" style={{ margin: 0 }}>… et {fresh.length - 10} autres.</p>}
              </>
            )}
          </>
        )}
        <div className="form">
          <button className="btn" onClick={doImport} disabled={busy || fresh.length === 0}>
            {busy ? 'Import…' : `Importer ${fresh.length} opération${fresh.length > 1 ? 's' : ''}`}
          </button>
          <button className="btn ghost" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </Modal>
  );
}
