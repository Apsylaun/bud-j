// Catégories (tags) : modifiables dans Réglages, stockées en base (table categories).
// Ce module garde un registre en mémoire ; les valeurs ci-dessous servent de secours et de graine.

export const SWATCHES = [
  '#4CAF7D', '#4F7F63', '#A3B07A', '#5FA8A0', '#5B8DB8', '#7A86C9', '#9575B5', '#D9759B',
  '#D4574E', '#E08A3C', '#D4A72C', '#B88A6B', '#A1887F', '#7A8FA6', '#9AA0A6',
];

export const DEFAULT_CATEGORIES = [
  { name: 'Salaire', kind: 'income', color: '#4CAF7D' },
  { name: 'Autre revenu', kind: 'income', color: '#6F9F8A' },
  { name: 'Vir. compte commun', kind: 'transfer_commun', color: '#7A8FA6' },
  { name: 'Transfert interne', kind: 'transfer_interne', color: '#9AA0A6' },
  { name: 'Forfait Tél', kind: 'expense', color: '#7A86C9' },
  { name: 'Banque', kind: 'expense', color: '#9575B5' },
  { name: 'Assurance', kind: 'expense', color: '#D9759B' },
  { name: 'Médical', kind: 'expense', color: '#D4574E' },
  { name: 'Transport', kind: 'expense', color: '#E08A3C' },
  { name: 'Courses', kind: 'expense', color: '#D4A72C' },
  { name: 'Déjeuner', kind: 'expense', color: '#A3B07A' },
  { name: 'Loisir', kind: 'expense', color: '#5FA8A0' },
  { name: 'Restau/Soirée', kind: 'expense', color: '#B88A6B' },
  { name: 'Shopping', kind: 'expense', color: '#5B8DB8' },
  { name: 'Retrait', kind: 'expense', color: '#A1887F' },
  { name: 'Placement', kind: 'expense', color: '#4F7F63' },
  { name: 'Autre', kind: 'expense', color: '#9AA0A6' },
];

export const KIND_LABEL = {
  expense: 'Dépense', income: 'Revenu', transfer_commun: 'Virement compte commun', transfer_interne: 'Virement interne',
};
export const PROTECTED_KINDS = ['transfer_commun', 'transfer_interne'];

export const INCOME = ['Salaire', 'Autre revenu'];
export const TRANSFER_COMMUN = 'Vir. compte commun';
export const TRANSFER_INTERNE = 'Transfert interne';
export const UNCATEGORIZED = 'Non catégorisé';

let REG = { list: [], byName: {}, groups: [] };
export function registerCategories(list, groups = []) {
  REG = { list: [...list], byName: Object.fromEntries(list.map((c) => [c.name, c])), groups: [...groups] };
}
export const groupList = () => REG.groups;
export const groupOf = (name) => (REG.byName[name] && REG.byName[name].group) || null;

// Groupes proposés à l'installation (alimentent le schéma de flux).
export const DEFAULT_GROUPS = [
  { name: 'Revenus', color: '#4CAF7D', cats: ['Salaire', 'Autre revenu'] },
  { name: 'Autre', color: '#9AA0A6', cats: ['Transport', 'Médical', 'Retrait'] },
  { name: 'Loyer', color: '#E08A3C', cats: ['Loyer'] },
  { name: 'Vie quotidienne', color: '#5B8DB8', cats: ['Vir. compte commun'] },
  { name: 'Pots', color: '#D9759B', cats: ['Placement'] },
];
registerCategories(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sort: i })));

export const categoryList = () => REG.list;
export const categoryNames = () => REG.list.map((c) => c.name);
export const expenseNames = () => REG.list.filter((c) => c.kind === 'expense').map((c) => c.name);
export const kindOf = (name) => (REG.byName[name] ? REG.byName[name].kind : undefined);

// Couleurs hors catégories (classes d'actifs, pots, nœuds du Sankey).
const COLORS = {
  'Non catégorisé': '#C4C9CE',
  'Revenus': '#4F7F63', 'Excédent': '#7C9A82', 'Déficit': '#C2574B', 'Non réparti': '#C4C9CE',
  'Voyage': '#5FA8A0', 'Investissement': '#5B8DB8', 'Plaisir': '#D9759B', 'Don/valeur': '#A3B07A',
  'Impots': '#A1887F', 'Imprévu': '#E08A3C', 'Reste': '#7A8FA6',
  'Liquidité': '#5FA8A0', 'Actions': '#5B8DB8', 'Obligations': '#9575B5', 'Immobilier': '#D4A72C', 'Alternatif': '#D9759B',
};
export const PALETTE = ['#5B8DB8', '#5FA8A0', '#D4A72C', '#D9759B', '#9575B5', '#E08A3C', '#A3B07A', '#7A86C9', '#D4574E', '#A1887F', '#7C9A82', '#7A8FA6'];
export const paletteColor = (i) => PALETTE[i % PALETTE.length];
let EXTRA = {};
export function registerExtraColors(map) { EXTRA = { ...EXTRA, ...map }; }
export const staticColor = (name) => COLORS[name];
export const colorOf = (name) => (REG.byName[name] && REG.byName[name].color) || EXTRA[name] || COLORS[name] || '#9AA0A6';
