import { GLOSSARY } from '../lib/glossary.js';

// Terme technique avec définition courte au survol (ou au toucher sur mobile).
export default function Term({ k, children, right }) {
  const def = GLOSSARY[k];
  if (!def) return <>{children}</>;
  return <span className={'term' + (right ? ' r' : '')} tabIndex={0} data-def={def}>{children}</span>;
}
