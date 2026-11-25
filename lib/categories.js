export const CATEGORIES = [
  'Salaire', 'Autre revenu', 'Vir. compte commun', 'Transfert interne',
  'Forfait Tél', 'Banque', 'Assurance', 'Médical', 'Transport', 'Courses',
  'Déjeuner', 'Loisir', 'Restau/Soirée', 'Shopping', 'Retrait', 'Autre',
];
export const INCOME = ['Salaire', 'Autre revenu'];
export const TRANSFER_COMMUN = 'Vir. compte commun';
export const TRANSFER_INTERNE = 'Transfert interne';
export const UNCATEGORIZED = 'Non catégorisé';

const COLORS = {
  'Salaire': '#2E7D5B', 'Autre revenu': '#6BAF8D', 'Vir. compte commun': '#7A8FA6',
  'Transfert interne': '#A9B4BF', 'Forfait Tél': '#5B6FD6', 'Banque': '#8A6FB5',
  'Assurance': '#B0609A', 'Médical': '#D4574E', 'Transport': '#E08A3C',
  'Courses': '#C9A227', 'Déjeuner': '#9BAA3A', 'Loisir': '#3FA7A0',
  'Restau/Soirée': '#D9648A', 'Shopping': '#4F86C6', 'Retrait': '#8C7B6B',
  'Autre': '#9AA0A6', 'Non catégorisé': '#C4C9CE',
  'Voyage': '#3FA7A0', 'Investissement': '#4F86C6', 'Plaisir': '#D9648A', 'Don/valeur': '#9BAA3A',
  'Impots': '#8C7B6B', 'Imprévu': '#E08A3C', 'Reste': '#7A8FA6', 'Non réparti': '#C4C9CE',
  'Liquidité': '#3FA7A0', 'Actions': '#4F86C6', 'Obligations': '#8A6FB5', 'Immobilier': '#C9A227', 'Alternatif': '#D9648A',
  'Revenus': '#1F5C4D', 'Excédent': '#2E7D5B', 'Déficit': '#B3392F',
};
export const PALETTE = ['#4F86C6', '#3FA7A0', '#C9A227', '#D9648A', '#8A6FB5', '#E08A3C', '#9BAA3A', '#5B6FD6', '#D4574E', '#8C7B6B', '#2E7D5B', '#7A8FA6'];
export const paletteColor = (i) => PALETTE[i % PALETTE.length];
export const colorOf = (name) => COLORS[name] || '#9AA0A6';
