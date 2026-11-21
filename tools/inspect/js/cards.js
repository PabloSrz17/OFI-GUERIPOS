() => {
  const out = {};
  for (const el of document.querySelectorAll('main *')) {
    const s = getComputedStyle(el);
    if (s.boxShadow !== 'none' && !s.boxShadow.startsWith('rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px')) {
      const r = el.getBoundingClientRect();
      out[s.boxShadow + ' | r:' + s.borderRadius + ' | bg:' + s.backgroundColor] = `${Math.round(r.width)}x${Math.round(r.height)}`;
    }
    if (el.tagName === 'THEAD' || (el.tagName === 'TR' && el.parentElement.tagName === 'THEAD')) out['thead-bg:' + s.backgroundColor + ' bd-b:' + s.borderBottomColor] = el.tagName;
  }
  const tb = document.querySelector('main tbody tr');
  if (tb) out['tbody-tr border-bottom'] = getComputedStyle(tb).borderBottom + ' / td: ' + getComputedStyle(tb.querySelector('td')).borderBottom;
  const tw = document.querySelector('main table')?.parentElement;
  if (tw) { const s = getComputedStyle(tw); out['table-wrapper'] = `bd:${s.border} r:${s.borderRadius} bg:${s.backgroundColor}`; }
  return out;
}
