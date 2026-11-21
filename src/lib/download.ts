/** Descarga un CSV generado en memoria. Incluye BOM para que Excel abra los acentos correctamente. */
export function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
