// args: [url|-] [selector]  -> árbol de accesibilidad de <main> y diálogos abiertos, con filas de tabla recortadas.
export default async ({ page, args }) => {
  const [url, sel] = args;
  if (url && url !== '-') {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  const trim = (txt) => {
    const lines = txt.split('\n'); const out = []; let rows = 0, rowIndent = -1, skipping = false;
    for (const l of lines) {
      const ind = l.search(/\S/);
      if (skipping && ind > rowIndent) continue;
      skipping = false;
      if (/^\s*- (row|listitem|option)\b/.test(l)) {
        if (ind !== rowIndent) { rowIndent = ind; rows = 0; }
        rows++;
        if (rows > 3) { skipping = true; if (rows === 4) out.push(' '.repeat(ind) + '- … (más filas omitidas)'); continue; }
      }
      out.push(l);
    }
    return out.join('\n');
  };
  const parts = [`URL: ${page.url()}\nTITLE: ${await page.title()}`];
  const targets = sel ? [sel] : ['main', '[role=dialog], [role=menu], [role=listbox], .modal'];
  for (const t of targets) {
    const loc = page.locator(t);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      if (!(await loc.nth(i).isVisible())) continue;
      parts.push(`### ${t} [${i}]\n` + trim(await loc.nth(i).ariaSnapshot()));
    }
  }
  return parts.join('\n\n');
};
