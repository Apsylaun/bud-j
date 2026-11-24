// Formats gérés : Fortuneo (montants signés) et Crédit Agricole (débits non signés, en-tête de relevé).
// Ajouter une banque = détecter son en-tête dans parseBankCsv.

export function decodeBuffer(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

export function parseCsv(text, delim = ';') {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"' && cur === '') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const nh = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const num = (s) => {
  const t = (s ?? '').toString().replace(/[\s\u00a0€]/g, '').replace(',', '.');
  if (t === '') return 0;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
};
const dateIso = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const cleanLabel = (s) => (s || '').replace(/\s+/g, ' ').replace(/[\s-]+$/, '').trim();

export function parseBankCsv(text) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const h = rows.findIndex((r) => r.length >= 4 && nh(r[0]).startsWith('date') && nh(r.join(';')).includes('libelle'));
  if (h < 0) throw new Error('Format non reconnu : en-tête « Date ; Libellé ; Débit ; Crédit » introuvable.');

  const head = rows[h].map(nh);
  const find = (re) => head.findIndex((x) => re.test(x));
  const iDate = Math.max(find(/^date (d')?op/), 0);
  const iLabel = find(/^libelle/), iDeb = find(/^debit/), iCred = find(/^credit/);
  if (iLabel < 0 || iDeb < 0 || iCred < 0) throw new Error('Colonnes Libellé / Débit / Crédit introuvables.');
  const format = head.some((x) => x.startsWith('date valeur')) ? 'Fortuneo' : 'Crédit Agricole';

  // Métadonnées du relevé (CA) : solde et compte
  const meta = { balance: null, balanceDate: null, accountLine: null };
  for (const r of rows.slice(0, h)) {
    const line = r.join(' ').trim();
    const b = /solde au (\d{2}\/\d{2}\/\d{4})\s*:?\s*(-?[\d\s.,]+?)\s*€/i.exec(line);
    if (b) { meta.balanceDate = dateIso(b[1]); meta.balance = num(b[2]); }
    if (/^compte/i.test(line)) meta.accountLine = line;
  }

  const out = [], errors = [];
  for (const r of rows.slice(h + 1)) {
    const date = dateIso(r[iDate]);
    if (!date) continue; // lignes vides / pied de page
    const deb = num(r[iDeb]), cred = num(r[iCred]);
    if (Number.isNaN(deb) || Number.isNaN(cred)) { errors.push(r.join(';')); continue; }
    const amount = Math.round((cred - Math.abs(deb)) * 100) / 100;
    if (amount === 0) continue;
    out.push({ date, label: cleanLabel(r[iLabel]), amount });
  }

  // Empreinte : date|libellé|montant + rang d'occurrence (2 achats identiques le même jour restent distincts)
  const seen = new Map();
  for (const t of out) {
    const k = `${t.date}|${t.label}|${t.amount.toFixed(2)}`;
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    t.hash = `${k}#${n}`;
  }
  return { format, rows: out, meta, errors };
}
