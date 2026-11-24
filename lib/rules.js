export const norm = (s) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Appliquées sur le libellé normalisé (minuscules, sans accents). Les règles utilisateur passent avant.
export const DEFAULT_RULES = [
  [/compte commun/, 'Vir. compte commun'],
  [/\bsalaire\b|\bpaie\b/, 'Salaire'],
  [/ret dab|retrait|\bdab\b/, 'Retrait'],
  [/navigo|sncf|ratp|uber(?!\s?eats)|blablacar|totalenergies|total energies|peage|parking|\btrain/, 'Transport'],
  [/carrefour|leclerc|auchan|monoprix|franprix|lidl|intermarche|picard|biocoop|casino|u express|naturalia|grand frais/, 'Courses'],
  [/free mobile|sosh|bouygues|red by sfr|b&you|forfait/, 'Forfait Tél'],
  [/assurance|maif|macif|matmut|groupama|\baxa\b|\balan\b|april/, 'Assurance'],
  [/pharmacie|doctolib|medecin|docteur|dentiste|opticien|laboratoire|\bcpam\b|ameli/, 'Médical'],
  [/cotisation|tenue de compte|agios|commission d.interv/, 'Banque'],
  [/restaurant|brasserie|uber ?eats|deliveroo|\bbar\b|cafe|pizz|sushi|kebab|burger|mcdo|mc donald|bistrot/, 'Restau/Soirée'],
  [/netflix|spotify|cinema|\bugc\b|pathe|steam|fnac|ticketmaster|billetterie/, 'Loisir'],
  [/amazon|zalando|vinted|shein|ikea|zara|cdiscount/, 'Shopping'],
];

export function makeCategorizer(userRules = []) {
  const mine = userRules
    .map((r) => ({ p: norm(r.pattern).trim(), c: r.category }))
    .filter((r) => r.p)
    .sort((a, b) => b.p.length - a.p.length); // le motif le plus précis gagne
  return (label) => {
    const n = norm(label);
    for (const r of mine) if (n.includes(r.p)) return r.c;
    for (const [re, c] of DEFAULT_RULES) if (re.test(n)) return c;
    return null;
  };
}

const NOISE = new Set(['carte', 'vir', 'inst', 'prelevement', 'paiement', 'par', 'virement', 'emis', 'recu']);
export function suggestPattern(label) {
  const words = norm(label)
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !NOISE.has(w));
  return words.slice(0, 2).join(' ');
}
