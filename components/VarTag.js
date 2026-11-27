import { fmtPct } from '../lib/wealth.js';

// Variation en pastille : ▲ vert / ▼ rouge avec le pourcentage.
export default function VarTag({ pct }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  return <span className={'vtag' + (pct < 0 ? ' neg' : '')}>{pct < 0 ? '▼' : '▲'} {fmtPct(Math.abs(pct)).replace('+', '')}</span>;
}
