// args: <role> <nombre exacto> [n]  -> hace clic en un control de UI (solo para abrir/cerrar vistas, nunca confirmar)
const FORBIDDEN = /^(guardar|confirmar|cobrar|pagar|eliminar|borrar|cancelar venta|enviar|crear|abrir caja|cerrar caja|hacer corte|aceptar|finalizar|registrar)/i;
export default async ({ page, args }) => {
  const [role, name, n = '0'] = args;
  if (FORBIDDEN.test(name)) throw new Error(`Bloqueado por seguridad: "${name}"`);
  const loc = role === 'text' ? page.getByText(name, { exact: true }) : page.getByRole(role, { name, exact: true });
  await loc.nth(Number(n)).click({ timeout: 8000 });
  await page.waitForTimeout(1200);
  return { clicked: name, url: page.url() };
};
