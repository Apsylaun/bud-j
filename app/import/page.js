'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '../../lib/supabase.js';
import { loadAccounts, loadRules, fetchAll } from '../../lib/data.js';
import { decodeBuffer, parseBankCsv } from '../../lib/parsers.js';
import { makeCategorizer } from '../../lib/rules.js';
import { eur, dateFr } from '../../lib/format.js';

export default function Import() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [rules, setRules] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [known, setKnown] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    loadAccounts().then((a) => { setAccounts(a); if (a[0]) setAccountId(a[0].id); }).catch((e) => setError(e.message));
    loadRules().then(setRules).catch(() => {});
  }, []);

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(''); setDone(null); setParsed(null); setKnown(null); setFileName(f.name);
    try { setParsed(parseBankCsv(decodeBuffer(await f.arrayBuffer()))); }
    catch (err) { setError(err.message); }
  }

  // Détection des doublons : empreintes déjà présentes sur ce compte, sur la plage de dates du fichier
  useEffect(() => {
    if (!parsed || !accountId || !parsed.rows.length) { setKnown(null); return; }
    let off = false;
    const dates = parsed.rows.map((r) => r.date).sort();
    fetchAll((a, b) => getSupabase().from('transactions').select('hash').eq('account_id', accountId)
      .gte('date', dates[0]).lte('date', dates[dates.length - 1]).order('id').range(a, b))
      .then((r) => { if (!off) setKnown(new Set(r.map((x) => x.hash))); })
      .catch((e) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [parsed, accountId]);

  const categorize = useMemo(() => makeCategorizer(rules), [rules]);
  const fresh = useMemo(
    () => (parsed && known ? parsed.rows.filter((r) => !known.has(r.hash)).map((r) => ({ ...r, category: categorize(r.label) })) : []),
    [parsed, known, categorize]
  );

  async function doImport() {
    setBusy(true); setError('');
    try {
      const sb = getSupabase();
      const payload = fresh.map((r) => ({
        account_id: accountId, date: r.date, label: r.label, amount: r.amount, hash: r.hash,
        category: r.category, cat_source: r.category ? 'rule' : null,
      }));
      for (let i = 0; i < payload.length; i += 500) {
        const { error: err } = await sb.from('transactions')
          .upsert(payload.slice(i, i + 500), { onConflict: 'account_id,hash', ignoreDuplicates: true });
        if (err) throw err;
      }
      const { balance, balanceDate } = parsed.meta;
      if (balance != null && balanceDate) {
        await sb.from('account_balances').upsert({ account_id: accountId, date: balanceDate, balance }, { onConflict: 'account_id,date' });
      }
      setDone({ n: payload.length, todo: payload.filter((p) => !p.category).length });
      setParsed(null); setKnown(null); setFileName('');
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const dates = parsed?.rows.map((r) => r.date).sort() || [];
  const inSum = fresh.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const outSum = fresh.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <h1>Import</h1>
      {accounts.length === 0 && <div className="warn">Aucun compte. <Link href="/reglages">Crée d’abord un compte</Link>.</div>}
      <div className="form">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Compte">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.bank}{a.shared ? ' (commun)' : ''}</option>)}
        </select>
        <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={!accountId} />
      </div>
      <p className="hint">Formats reconnus : Fortuneo, Crédit Agricole. Les opérations déjà importées sont ignorées.</p>

      {error && <p className="err">{error}</p>}
      {done && (
        <div className="warn">
          {done.n} opération{done.n > 1 ? 's' : ''} importée{done.n > 1 ? 's' : ''}.{' '}
          {done.todo > 0 ? <Link href="/transactions?todo=1">Catégoriser les {done.todo} restantes</Link> : 'Toutes sont catégorisées.'}
        </div>
      )}

      {parsed && (
        <div className="panel">
          <p><b>{fileName}</b> — format {parsed.format}</p>
          <p className="muted">
            {parsed.rows.length} lignes du {dates.length ? dateFr(dates[0]) : '–'} au {dates.length ? dateFr(dates[dates.length - 1]) : '–'}.
            {known && <> {fresh.length} nouvelle{fresh.length > 1 ? 's' : ''}, {parsed.rows.length - fresh.length} déjà présente{parsed.rows.length - fresh.length > 1 ? 's' : ''}.</>}
            {parsed.meta.balance != null && <> Solde indiqué par la banque : {eur(parsed.meta.balance, 2)} au {dateFr(parsed.meta.balanceDate)}.</>}
          </p>
          {parsed.errors.length > 0 && <p className="err">{parsed.errors.length} ligne(s) illisible(s) ignorée(s).</p>}
          {fresh.length > 0 && (
            <>
              <p>Entrées {eur(inSum, 2)} · Sorties {eur(outSum, 2)}</p>
              <div className="scroll-x">
                <table className="prev"><tbody>
                  {fresh.slice(0, 12).map((r) => (
                    <tr key={r.hash}>
                      <td>{dateFr(r.date)}</td>
                      <td>{r.label}<br /><span className="muted">{r.category || 'À catégoriser'}</span></td>
                      <td>{eur(r.amount, 2)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
              {fresh.length > 12 && <p className="muted">… et {fresh.length - 12} autres.</p>}
            </>
          )}
          <p><button className="btn" onClick={doImport} disabled={busy || fresh.length === 0}>
            {busy ? 'Import…' : `Importer ${fresh.length} opération${fresh.length > 1 ? 's' : ''}`}
          </button></p>
        </div>
      )}
    </>
  );
}
