/** Descarga un CSV generado en memoria. Incluye BOM para que Excel abra los acentos correctamente. */
export function download(name: string, content: string) {
  downloadBlob(name, new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' }));
}

/** Descarga un archivo binario (por ejemplo, un .xlsx). */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
