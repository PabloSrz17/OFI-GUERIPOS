() => {
  const pick = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
      tag: el.tagName, text: (el.innerText || '').trim().slice(0, 40),
      w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
      font: `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily}`,
      color: s.color, bg: s.backgroundColor, border: `${s.borderWidth} ${s.borderStyle} ${s.borderColor}`,
      radius: s.borderRadius, padding: s.padding, margin: s.margin, shadow: s.boxShadow, gap: s.gap,
    };
  };
  const q = (sel) => document.querySelector(sel);
  const byText = (sel, txt) => [...document.querySelectorAll(sel)].find(e => e.innerText && e.innerText.trim() === txt);
  const out = {
    viewport: [innerWidth, innerHeight],
    body: pick(document.body),
    aside: pick(q('aside')),
    header: pick(q('header')),
    main: pick(q('main')),
    h1: pick(q('main h1')), h2: pick(q('main h2')), h3: pick(q('main h3')), h4: pick(q('main h4')),
    p: pick(q('main p')),
  };
  const extra = (window.__probe || []);
  for (const [k, sel, txt] of extra) out[k] = pick(txt ? byText(sel, txt) : q(sel));
  // colores más frecuentes
  const freq = {};
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    for (const c of [s.color, s.backgroundColor, s.borderTopColor]) if (c && c !== 'rgba(0, 0, 0, 0)') freq[c] = (freq[c] || 0) + 1;
  }
  out.topColors = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 25);
  const fonts = {};
  for (const el of document.querySelectorAll('body *')) { const s = getComputedStyle(el); const k = `${s.fontSize} ${s.fontWeight}`; fonts[k] = (fonts[k] || 0) + 1; }
  out.fontSizes = Object.entries(fonts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  out.fontFamily = getComputedStyle(document.body).fontFamily;
  out.cssVars = [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules]; } catch { return []; } })
    .filter(r => r.selectorText === ':root').flatMap(r => [...r.style].filter(p => p.startsWith('--')).map(p => [p, r.style.getPropertyValue(p).trim()])).slice(0, 120);
  return out;
}
