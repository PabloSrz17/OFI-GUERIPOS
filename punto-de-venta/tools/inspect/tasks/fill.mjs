// args: <placeholder o nombre accesible> <valor>  -> escribe en un campo SIN presionar Enter (nunca envía)
export default async ({ page, args }) => {
  const [name, value] = args;
  let loc = page.getByPlaceholder(name, { exact: true });
  if (!(await loc.count())) loc = page.getByRole('textbox', { name, exact: true });
  if (!(await loc.count())) loc = page.getByRole('combobox', { name, exact: true });
  await loc.first().fill(value);
  await page.waitForTimeout(1200);
  return { filled: name, value };
};
