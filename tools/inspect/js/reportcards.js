() => {
  const out = [];
  for (const h of document.querySelectorAll('main h3')) {
    out.push('## ' + h.innerText.trim());
    const section = h.parentElement;
    const cards = section.querySelectorAll('a, button');
    const seen = new Set();
    for (const el of section.querySelectorAll('div')) {
      const t = el.innerText.trim();
      if (el.children.length >= 2 && /Ver reporte|Plan Pro/.test(t) && t.length < 220 && !seen.has(t)) {
        if ([...seen].some(s => t.includes(s) || s.includes(t))) continue;
        seen.add(t); out.push('- ' + t.replace(/\n+/g, ' | '));
      }
    }
  }
  return out.join('\n');
}
