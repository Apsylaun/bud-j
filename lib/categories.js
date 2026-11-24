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
  'Revenus': '#1F5C4D', 'Excédent': '#2E7D5B', 'Déficit': '#B3392F',
};
export const colorOf = (name) => COLORS[name] || '#9AA0A6';
