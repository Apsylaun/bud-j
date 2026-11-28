// Catégories (tags) : modifiables dans Réglages, stockées en base (table categories).
// Ce module garde un registre en mémoire ; les valeurs ci-dessous servent de secours et de graine.

export const SWATCHES = [
  '#7FCBA5', '#9ED8C9', '#8FCBE0', '#8DB4EA', '#A9A3EA', '#C3A4E6', '#EDA3C8', '#F2A0A0',
  '#F4B183', '#F2CF7B', '#C9D98B', '#D2B8A3', '#B7BEC7', '#9AB3C9', '#7DB59A',
];

export const DEFAULT_CATEGORIES = [
  { name: 'Salaire', kind: 'income', color: '#7FCBA5' },
  { name: 'Autre revenu', kind: 'income', color: '#9ED8C9' },
  { name: 'Vir. compte commun', kind: 'transfer_commun', color: '#9AB3C9' },
  { name: 'Transfert interne', kind: 'transfer_interne', color: '#B7BEC7' },
  { name: 'Forfait Tél', kind: 'expense', color: '#A9A3EA' },
  { name: 'Banque', kind: 'expense', color: '#C3A4E6' },
  { name: 'Assurance', kind: 'expense', color: '#EDA3C8' },
  { name: 'Médical', kind: 'expense', color: '#F2A0A0' },
  { name: 'Transport', kind: 'expense', color: '#F4B183' },
  { name: 'Courses', kind: 'expense', color: '#F2CF7B' },
  { name: 'Déjeuner', kind: 'expense', color: '#C9D98B' },
  { name: 'Loisir', kind: 'expense', color: '#8FD0C8' },
  { name: 'Restau/Soirée', kind: 'expense', color: '#D2B8A3' },
  { name: 'Shopping', kind: 'expense', color: '#8DB4EA' },
  { name: 'Retrait', kind: 'expense', color: '#C7B1A6' },
  { name: 'Placement', kind: 'expense', color: '#7DB59A' },
  { name: 'Autre', kind: 'expense', color: '#B7BEC7' },
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
  { name: 'Revenus', color: '#7FCBA5', cats: ['Salaire', 'Autre revenu'] },
  { name: 'Autre', color: '#B7BEC7', cats: ['Transport', 'Médical', 'Retrait'] },
  { name: 'Loyer', color: '#F4B183', cats: ['Loyer'] },
  { name: 'Vie quotidienne', color: '#8DB4EA', cats: ['Vir. compte commun'] },
  { name: 'Pots', color: '#EDA3C8', cats: ['Placement'] },
];
registerCategories(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sort: i })));

export const categoryList = () => REG.list;
export const categoryNames = () => REG.list.map((c) => c.name);
export const expenseNames = () => REG.list.filter((c) => c.kind === 'expense').map((c) => c.name);
export const kindOf = (name) => (REG.byName[name] ? REG.byName[name].kind : undefined);

// Couleurs hors catégories (classes d'actifs, pots, nœuds du Sankey).
const COLORS = {
  'Non catégorisé': '#C4C9CE',
  'Revenus': '#7DB59A', 'Excédent': '#7C9A82', 'Déficit': '#E58A80', 'Non réparti': '#C4C9CE',
  'Voyage': '#8FD0C8', 'Investissement': '#8DB4EA', 'Plaisir': '#EDA3C8', 'Don/valeur': '#C9D98B',
  'Impots': '#C7B1A6', 'Imprévu': '#F4B183', 'Reste': '#9AB3C9',
  'Liquidité': '#8FD0C8', 'Actions': '#8DB4EA', 'Obligations': '#C3A4E6', 'Immobilier': '#F2CF7B', 'Alternatif': '#EDA3C8',
};
export const PALETTE = ['#8DB4EA', '#8FD0C8', '#F2CF7B', '#EDA3C8', '#C3A4E6', '#F4B183', '#C9D98B', '#A9A3EA', '#F2A0A0', '#C7B1A6', '#7C9A82', '#9AB3C9'];
export const paletteColor = (i) => PALETTE[i % PALETTE.length];
let EXTRA = {};
export function registerExtraColors(map) { EXTRA = { ...EXTRA, ...map }; }
export const staticColor = (name) => COLORS[name];
export const colorOf = (name) => (REG.byName[name] && REG.byName[name].color) || EXTRA[name] || COLORS[name] || '#B7BEC7';
