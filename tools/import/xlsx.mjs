// Lector mínimo de .xlsx (zip + XML) sin dependencias: devuelve las hojas como arreglos de filas.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('No es un archivo .xlsx');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lName = buf.readUInt16LE(local + 26);
    const lExtra = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lName + lExtra, local + 30 + lName + lExtra + size);
    files[name] = method === 8 ? inflateRawSync(data) : data;
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const text = (xml) => unescape([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export function readXlsx(path) {
  const files = unzip(readFileSync(path));
  const str = (f) => (files[f] ? files[f].toString('utf8') : '');
  const shared = [...str('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => text(m[1]));
  const wb = str('xl/workbook.xml');
  const rels = Object.fromEntries([...str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = {};
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = rels[m[2]].replace(/^\/?(xl\/)?/, 'xl/');
    const rows = [];
    for (const r of str(target).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1];
        const t = /t="([^"]+)"/.exec(c[1])?.[1];
        const body = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = null;
        if (t === 's') val = shared[+v];
        else if (t === 'inlineStr') val = text(body);
        else if (t === 'str' || t === 'e') val = v != null ? unescape(v) : null;
        else if (t === 'b') val = v === '1';
        else if (v != null) val = Number(v);
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows.push(row);
    }
    sheets[unescape(m[1])] = rows;
  }
  return sheets;
}

/** Filas como objetos usando la primera fila como encabezado. */
export function asObjects(rows, headerRow = 0) {
  const head = rows[headerRow].map((h) => String(h ?? '').trim());
  return rows.slice(headerRow + 1).filter((r) => r.some((v) => v != null && v !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? null])));
}
