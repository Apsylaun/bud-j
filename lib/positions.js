// Import de portefeuille au format Bourse Direct (colonnes : Nom, ISIN, Cours, Quantité, PRU (EUR), Valorisation (EUR)…).
import { readXlsx } from './xlsx.js';
import { decodeBuffer, parseCsv } from './parsers.js';

const nh = (s) => (s == null ? '' : String(s)).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const toNum = (v) => {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[\s\u00a0€%]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function parsePositions(rows) {
  const h = rows.findIndex((r) => r && r.some((c) => nh(c) === 'isin') && r.some((c) => nh(c).startsWith('quantit')));
  if (h < 0) throw new Error('Format non reconnu : colonnes « ISIN » et « Quantité » introuvables.');
  const head = rows[h].map(nh);
  const col = (re) => head.findIndex((x) => re.test(x));
  const iName = col(/^nom/), iIsin = col(/^isin/), iPrice = col(/^cours/), iQty = col(/^quantit/);
  const iPru = col(/^pru/), iVal = col(/^valorisation/), iGain = col(/^\+\/- value \(/);

  const out = [];
  for (const r of rows.slice(h + 1)) {
    if (!r) continue;
    const isin = String(r[iIsin] ?? '').trim();
    const qty = toNum(r[iQty]);
    if (!isin || qty === null) continue;
    const price = iPrice >= 0 ? toNum(r[iPrice]) : null;
    const pru = iPru >= 0 ? toNum(r[iPru]) : null;
    const gain = iGain >= 0 ? toNum(r[iGain]) : null;
    let value = iVal >= 0 ? toNum(r[iVal]) : null;
    if (value === null && price !== null) value = r2(price * qty);
    if (value === null) continue;
    const invested = pru !== null ? r2(pru * qty) : gain !== null ? r2(value - gain) : null;
    out.push({ name: String(r[iName] ?? isin).replace(/\s+/g, ' ').trim(), isin, quantity: qty, price, pru, value: r2(value), invested });
  }
  if (!out.length) throw new Error('Aucune position trouvée dans le fichier.');
  return out;
}

export async function readPositionsFile(file) {
  const buf = await file.arrayBuffer();
  const rows = /\.xlsx$/i.test(file.name) ? await readXlsx(buf) : parseCsv(decodeBuffer(buf).replace(/^\uFEFF/, ''));
  return parsePositions(rows);
}
