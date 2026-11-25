// Lecteur .xlsx minimal et sans dépendance : renvoie les lignes de la feuille « Positions » (ou de la première feuille).
const dec = new TextDecoder('utf-8');

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function zipIndex(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Fichier xlsx invalide.');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    files[dec.decode(buf.subarray(p + 46, p + 46 + nlen))] = {
      method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true),
    };
    p += 46 + nlen + xlen + clen;
  }
  return { files, dv };
}

async function readEntry(buf, dv, f) {
  const nlen = dv.getUint16(f.off + 26, true), xlen = dv.getUint16(f.off + 28, true);
  const start = f.off + 30 + nlen + xlen;
  const data = buf.subarray(start, start + f.csize);
  return dec.decode(f.method === 0 ? data : await inflateRaw(data));
}

const unesc = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, m) => {
  if (m[0] === '#') return String.fromCodePoint(m[1] === 'x' || m[1] === 'X' ? parseInt(m.slice(2), 16) : parseInt(m.slice(1), 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[m.toLowerCase()];
});

const colIndex = (letters) => letters.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export async function readXlsx(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const { files, dv } = zipIndex(buf);
  const get = async (name) => (files[name] ? readEntry(buf, dv, files[name]) : null);

  // Feuille à lire
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const targets = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]*)"/.exec(m[0]), t = /\bTarget="([^"]*)"/.exec(m[0]);
      if (id && t) targets[id[1]] = t[1].startsWith('/') ? t[1].slice(1) : `xl/${t[1]}`;
    }
    const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
      name: (/\bname="([^"]*)"/.exec(m[0]) || [])[1] || '', rid: (/\br:id="([^"]*)"/.exec(m[0]) || [])[1],
    }));
    const pick = sheets.find((s) => /^positions$/i.test(unesc(s.name))) || sheets[0];
    if (pick && targets[pick.rid]) sheetPath = targets[pick.rid];
  }
  const xml = await get(sheetPath);
  if (!xml) throw new Error('Feuille introuvable dans le fichier xlsx.');

  const sst = [];
  const sstXml = await get('xl/sharedStrings.xml');
  if (sstXml) {
    for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      let t = '';
      for (const tm of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) t += unesc(tm[1]);
      sst.push(t);
    }
  }

  const rows = [];
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /\br="([A-Z]+)(\d+)"/.exec(m[1]);
    if (!ref || m[2] === undefined) continue;
    const type = (/\bt="(\w+)"/.exec(m[1]) || [])[1];
    const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(m[2]);
    let val = null;
    if (type === 'inlineStr') val = [...m[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unesc(x[1])).join('');
    else if (v) {
      if (type === 's') val = sst[Number(v[1])] ?? null;
      else if (type === 'str') val = unesc(v[1]);
      else if (type === 'b') val = v[1] === '1';
      else if (type === 'e') val = null;
      else { const n = Number(v[1]); val = Number.isFinite(n) ? n : unesc(v[1]); }
    }
    const r = Number(ref[2]) - 1, c = colIndex(ref[1]);
    if (!rows[r]) rows[r] = [];
    rows[r][c] = val;
  }
  return Array.from(rows, (r) => Array.from(r || [], (x) => (x === undefined ? null : x)));
}
