export const eur = (n, d = 0) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0);

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const monthLabel = (key) => { const [y, m] = key.split('-'); return `${MOIS[+m - 1]} ${y.slice(2)}`; };
export const dateFr = (iso) => iso.split('-').reverse().join('/');

export const PRESETS = [
  ['mois', 'Ce mois'], ['prev', 'Mois dernier'], ['3m', '3 derniers mois'],
  ['12m', '12 derniers mois'], ['ytd', 'Année en cours'], ['all', 'Tout'], ['custom', 'Personnalisée'],
];

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function resolvePeriod({ preset, from, to }) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  const U = Date.UTC;
  switch (preset) {
    case 'mois': return { from: iso(U(y, m, 1)), to: iso(U(y, m + 1, 0)) };
    case 'prev': return { from: iso(U(y, m - 1, 1)), to: iso(U(y, m, 0)) };
    case '3m': return { from: iso(U(y, m - 2, 1)), to: iso(U(y, m + 1, 0)) };
    case '12m': return { from: iso(U(y, m - 11, 1)), to: iso(U(y, m + 1, 0)) };
    case 'ytd': return { from: iso(U(y, 0, 1)), to: iso(U(y, m + 1, 0)) };
    case 'custom': return { from: from || null, to: to || null };
    default: return { from: null, to: null };
  }
}
