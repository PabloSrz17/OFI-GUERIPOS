// args: <tecla>  (p. ej. Escape) -> cierra modales sin confirmar
export default async ({ page, args }) => { await page.keyboard.press(args[0]); await page.waitForTimeout(800); return { pressed: args[0] }; };
