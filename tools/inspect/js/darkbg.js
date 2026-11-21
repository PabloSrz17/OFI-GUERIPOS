() => {
  const seen = {};
  for (const el of document.querySelectorAll('aside *, main *')) {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 30) continue;
    const key = `${el.closest('aside') ? 'aside' : 'main'} bg:${s.backgroundColor} bd:${s.borderTopWidth} ${s.borderTopColor} r:${s.borderRadius} sh:${s.boxShadow.slice(0, 70)}`;
    if (s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.boxShadow === 'none' && !parseFloat(s.borderTopWidth)) continue;
    seen[key] = seen[key] || `${Math.round(r.width)}x${Math.round(r.height)} ${(el.innerText || '').trim().slice(0, 25).replace(/\n/g, ' ')}`;
  }
  return seen;
}
