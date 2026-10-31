// Muestra la estructura (tablas, columnas y número de filas) de la base de SICAR para
// mapear las ventas. No imprime datos de clientes. Uso: npm run sicar:explorar
const mysql = require('mysql2/promise');
const { sicar } = require('../../config');

const INTERES = /venta|nota|ticket|detalle|cliente|articulo|producto|envio|entrega|domicilio/i;

(async () => {
  if (!sicar.user) throw new Error('Falta SICAR_DB_USER en .env');
  const { host, port, user, password, database } = sicar;
  const db = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10_000 });
  const [tablas] = await db.query(
    `SELECT table_name AS t, table_rows AS filas FROM information_schema.tables
     WHERE table_schema = ? ORDER BY table_name`, [sicar.database]);
  console.log(`Base "${sicar.database}": ${tablas.length} tablas\n`);
  for (const { t, filas } of tablas.filter(({ t }) => INTERES.test(t))) {
    const [cols] = await db.query(
      `SELECT column_name AS c, column_type AS tipo FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`, [sicar.database, t]);
    console.log(`${t} (~${filas} filas)`);
    console.log(`  ${cols.map(({ c, tipo }) => `${c}:${tipo}`).join(', ')}\n`);
  }
  console.log('Otras tablas:', tablas.filter(({ t }) => !INTERES.test(t)).map(({ t }) => t).join(', '));
  await db.end();
})().catch((err) => {
  console.error('Error:', err.code ?? '', err.message);
  process.exit(1);
});
