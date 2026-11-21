// args: "selector" o "selector|texto exacto" ...  -> estilos compactos de cada elemento (solo lectura)
export default async ({ page, args }) => page.evaluate((items) => {
  const fmt = (el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const o = [`${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)}`,
      `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily.split(',')[0]}`, `c:${s.color}`];
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') o.push(`bg:${s.backgroundColor}`);
    if (s.backgroundImage !== 'none') o.push(`bgi:${s.backgroundImage.slice(0, 80)}`);
    if (parseFloat(s.borderTopWidth) || parseFloat(s.borderBottomWidth) || parseFloat(s.borderLeftWidth))
      o.push(`bd:${s.borderTopWidth} ${s.borderRightWidth} ${s.borderBottomWidth} ${s.borderLeftWidth} ${s.borderTopColor}`);
    if (s.borderRadius !== '0px') o.push(`r:${s.borderRadius}`);
    if (s.padding !== '0px') o.push(`p:${s.padding}`);
    if (s.boxShadow !== 'none') o.push(`sh:${s.boxShadow}`);
    if (s.gap !== 'normal') o.push(`gap:${s.gap}`);
    return o.join(' | ');
  };
  const out = {};
  for (const it of items) {
    const [sel, txt] = it.split('|');
    let els = [...document.querySelectorAll(sel)];
    if (txt) els = els.filter(e => (e.innerText || e.value || e.placeholder || '').trim() === txt);
    out[it] = els.length ? fmt(els[0]) : 'NOT FOUND';
  }
  return out;
}, args);
