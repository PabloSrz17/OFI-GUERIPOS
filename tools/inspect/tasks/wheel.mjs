// args: <x> <y> <dy>  -> rueda del mouse (solo para desplazarse)
export default async ({ page, args }) => { const [x, y, dy] = args.map(Number); await page.mouse.move(x, y); await page.mouse.wheel(0, dy); await page.waitForTimeout(800); return { wheel: dy }; };
