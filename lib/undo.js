// Pile d'annulation en mémoire (30 actions max, vidée au rechargement de la page).
const stack = [];
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export function pushUndo(label, fn) {
  stack.push({ label, fn });
  if (stack.length > 30) stack.shift();
  emit();
}
export const peekUndo = () => (stack.length ? stack[stack.length - 1] : null);
export function clearUndo() { stack.length = 0; emit(); }
export function subscribeUndo(f) { subs.add(f); return () => subs.delete(f); }

// Annule la dernière action puis prévient les pages de se rafraîchir.
export async function runUndo() {
  const item = stack.pop();
  emit();
  if (!item) return null;
  await item.fn();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('budj:data'));
  return item.label;
}
export function onDataChange(f) {
  window.addEventListener('budj:data', f);
  return () => window.removeEventListener('budj:data', f);
}

// Valeurs actuelles des champs touchés par un patch (pour pouvoir le défaire).
export const snapshotOf = (obj, patch) => Object.fromEntries(Object.keys(patch).map((k) => [k, obj[k] === undefined ? null : obj[k]]));
