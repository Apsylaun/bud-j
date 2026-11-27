export const ENVELOPES = [
  'Compte courant', 'Livret A', 'LDDS', 'LEP', 'PEL', 'Compte à terme', 'PEA', 'PEA-PME', 'Compte-titres (CTO)',
  'Assurance vie', 'PER', 'PERCOL / PEE', 'Crypto', 'Immobilier / SCPI', 'Autre',
];
const KIND = { 'Compte courant': 'Courant', 'Livret A': 'Épargne', 'LDDS': 'Épargne', 'LEP': 'Épargne', 'PEL': 'Épargne', 'Compte à terme': 'Épargne' };
export const kindForEnvelope = (e) => KIND[e] || 'Investissement';
export const KIND_PLURAL = { 'Courant': 'Comptes courants', 'Épargne': 'Comptes d’épargne', 'Investissement': 'Comptes d’investissement' };
export const BANKS = [
  'Crédit Agricole', 'Fortuneo', 'Crédit Mutuel', 'Bourse Direct', 'BoursoBank', 'BNP Paribas', 'Société Générale', 'LCL',
  'Caisse d’Épargne', 'Banque Populaire', 'La Banque Postale', 'Revolut', 'Trade Republic', 'Linxea', 'AXA', 'Epsor', 'Miimosa',
];

// Déduit l'enveloppe d'un ancien libellé libre (ex. « PEA Bourse Direct »).
export function guessEnvelope(text, kind) {
  const n = (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/pea.?pme/.test(n)) return 'PEA-PME';
  if (/\bpea\b/.test(n)) return 'PEA';
  if (/assurance|\bav\b|\bvie\b/.test(n)) return 'Assurance vie';
  if (/livret a\b/.test(n)) return 'Livret A';
  if (/ldd/.test(n)) return 'LDDS';
  if (/\blep\b/.test(n)) return 'LEP';
  if (/\bpel\b/.test(n)) return 'PEL';
  if (/percol|peeg|\bpee\b/.test(n)) return 'PERCOL / PEE';
  if (/\bper\b/.test(n)) return 'PER';
  if (/\bcto\b|compte.titres/.test(n)) return 'Compte-titres (CTO)';
  if (/crypto|bitcoin/.test(n)) return 'Crypto';
  if (/scpi|immo/.test(n)) return 'Immobilier / SCPI';
  if (/courant|depot/.test(n)) return 'Compte courant';
  return kind === 'Courant' ? 'Compte courant' : kind === 'Épargne' ? 'Livret A' : 'Autre';
}
