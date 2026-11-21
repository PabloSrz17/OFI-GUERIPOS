// args: <x> <y>  -> clic en coordenada (para botones de icono sin nombre). Solo abrir menús.
export default async ({ page, args }) => {
  const [x, y] = args.map(Number);
  const label = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const b = e && e.closest('button,a,[role=button],[role=option],[role=menuitem]'); return b ? (b.innerText || b.getAttribute('aria-label') || b.tagName).trim().slice(0, 60) : (e ? e.tagName : 'none'); }, [x, y]);
  if (/^(guardar|confirmar|cobrar|pagar|eliminar|borrar|enviar|crear|aceptar|finalizar|registrar)/i.test(label)) throw new Error('Bloqueado: ' + label);
  await page.mouse.click(x, y);
  await page.waitForTimeout(1200);
  return { clicked: label };
};
