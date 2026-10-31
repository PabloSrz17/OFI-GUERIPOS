// Cambios de esquema sobre bases ya existentes. Cada migración revisa si ya se aplicó.

// Agrega el estado "cargando" (Pendiente → Cargando → En Ruta → Entregado).
// SQLite no permite cambiar un CHECK, así que se reconstruye la tabla conservando los datos.
function estadoCargando(db) {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notas'").get();
  if (sql.includes("'cargando'")) return;

  const anterior = "CHECK (estado IN ('pendiente', 'en_ruta', 'entregado'))";
  if (!sql.includes(anterior)) throw new Error('Migración "cargando": la tabla notas tiene un formato inesperado');
  const nuevaTabla = sql
    .replace(anterior, "CHECK (estado IN ('pendiente', 'cargando', 'en_ruta', 'entregado'))")
    .replace(/CREATE TABLE (IF NOT EXISTS )?"?notas"?/, 'CREATE TABLE notas_nueva');

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(nuevaTabla);
      db.exec('INSERT INTO notas_nueva SELECT * FROM notas');
      db.exec('DROP TABLE notas');
      db.exec('ALTER TABLE notas_nueva RENAME TO notas');
      db.exec('CREATE INDEX IF NOT EXISTS idx_notas_estado ON notas(estado)');
      const rotas = db.prepare('PRAGMA foreign_key_check').all();
      if (rotas.length) throw new Error(`Migración "cargando": ${rotas.length} referencias rotas`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  console.log('[bd] Migración aplicada: estado "cargando"');
}

// Clientes sin teléfono: lo toma de la dirección de sus notas si ahí está escrito (costumbre en
// Pulpos). Sólo llena los vacíos, así que se puede correr en cada arranque.
function telefonosDesdeDirecciones(db) {
  const { buscarEnTexto } = require('../lib/telefono');
  const sinTelefono = db.prepare(`
    SELECT c.id, group_concat(n.direccion, ' | ') AS direcciones
    FROM clientes c JOIN notas n ON n.cliente_id = c.id
    WHERE c.telefono IS NULL OR c.telefono = ''
    GROUP BY c.id`).all();
  const guardar = db.prepare('UPDATE clientes SET telefono = ? WHERE id = ?');
  for (const { id, direcciones } of sinTelefono) {
    const telefono = buscarEnTexto(direcciones);
    if (telefono) guardar.run(telefono, id);
  }
}

// Camión elegido por nota (independiente del chofer).
function camionPorNota(db) {
  const columnas = db.prepare('PRAGMA table_info(notas)').all().map((c) => c.name);
  if (columnas.includes('camion_id')) return;
  db.exec('ALTER TABLE notas ADD COLUMN camion_id INTEGER REFERENCES camiones(id)');
  console.log('[bd] Migración aplicada: camión por nota');
}

// Lista de precios inicial (lo que más se vende). Sólo si la tabla está vacía.
function preciosIniciales(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM precios').get().n > 0) return;
  const insertar = db.prepare('INSERT INTO precios (nombre, unidad, precio, claves) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    insertar.run('Polvo', 'm³', 550, 'polvo');
    insertar.run('Grava', 'm³', 550, 'grava');
    insertar.run('Cemento Maya 25 kg', 'bulto', 150, 'cemento maya,maya');
    insertar.run('Cemento Apasco 25 kg', 'bulto', 130, 'cemento apasco,apasco');
    insertar.run('Cemento Holcim 25 kg', 'bulto', 130, 'cemento holcim,holcim');
    insertar.run('Cal', 'bulto', 110, 'cal');
    insertar.run('Armex de castillo', 'pz', 195, 'armex de castillo,armex castillo,castillo');
    insertar.run('Armex de cadena', 'pz', 195, 'armex de cadena,armex cadena,cadena');
  })();
  console.log('[bd] Lista de precios inicial cargada');
}

// Método de pago, hora de envío, venta y recordatorio de 24 horas en cada cotización.
function seguimientoCotizaciones(db) {
  const columnas = db.prepare('PRAGMA table_info(cotizaciones)').all().map((c) => c.name);
  if (columnas.includes('metodo_pago')) return;
  for (const c of ['metodo_pago', 'enviada_en', 'seguimiento_para', 'seguimiento_estado', 'pagada_en']) {
    db.exec(`ALTER TABLE cotizaciones ADD COLUMN ${c} TEXT`);
  }
  console.log('[bd] Migración aplicada: seguimiento de cotizaciones');
}

// Plantilla inicial para la pizarra de asistencias. Sólo si la tabla está vacía.
function trabajadoresIniciales(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM trabajadores').get().n > 0) return;
  const insertar = db.prepare('INSERT INTO trabajadores (nombre) VALUES (?)');
  db.transaction(() => {
    for (const nombre of ['Darío', 'Francisco', 'José', 'Moisés Arias', 'Moisés Sosa', 'Marcos', 'Gandhi', 'Zuriel', 'Plácido', 'Antonio']) {
      insertar.run(nombre);
    }
  })();
}

// Notas viejas: quita el sufijo "(+1)" del material. Las demás partidas siguen en "detalle".
function materialSinSufijo(db) {
  const guardar = db.prepare('UPDATE notas SET material = ? WHERE id = ?');
  for (const { id, material } of db.prepare(`SELECT id, material FROM notas WHERE material LIKE '%(+%)'`).all()) {
    guardar.run(material.replace(/\s*\(\+\d+\)$/, ''), id);
  }
}

// Darío se suma a los choferes. Si ya existe (aunque esté inactivo) no se vuelve a agregar.
function choferDario(db) {
  if (db.prepare(`SELECT 1 FROM choferes WHERE nombre LIKE 'Dar_o'`).get()) return;
  db.prepare('INSERT INTO choferes (nombre) VALUES (?)').run('Darío');
}

// Foto original del cliente, para revisar la transcripción contra ella.
function fotoDelCliente(db) {
  for (const tabla of ['notas', 'solicitudes_whatsapp']) {
    const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
    if (!columnas.includes('foto')) db.exec(`ALTER TABLE ${tabla} ADD COLUMN foto TEXT`);
  }
}

// Cierre de Jornada: cuándo salió la nota entregada del tablero al historial.
function notasArchivadas(db) {
  const columnas = db.prepare('PRAGMA table_info(notas)').all().map((c) => c.name);
  if (!columnas.includes('archivada_en')) db.exec('ALTER TABLE notas ADD COLUMN archivada_en TEXT');
}

// ALMACÉN se elige como chofer: el cliente recoge en bodega y no hace falta camión.
function choferAlmacen(db) {
  const columnas = db.prepare('PRAGMA table_info(choferes)').all().map((c) => c.name);
  if (!columnas.includes('almacen')) db.exec('ALTER TABLE choferes ADD COLUMN almacen INTEGER NOT NULL DEFAULT 0');
  if (db.prepare('SELECT 1 FROM choferes WHERE almacen = 1').get()) return;
  db.prepare(`INSERT INTO choferes (nombre, almacen) VALUES ('ALMACÉN', 1)`).run();
}

// El robot ahora lee todas las ventas: arranca desde hoy para no meter al tablero lo de días pasados,
// que ya se repartió. Se hace una sola vez.
function pulposDesdeHoy(db) {
  if (db.prepare(`SELECT 1 FROM ajustes WHERE clave = 'pulpos_lee_todas'`).get()) return;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  db.prepare(`UPDATE ajustes SET valor = ? WHERE clave = 'pulpos_importar_desde'`).run(hoy.toISOString());
  db.prepare(`INSERT INTO ajustes (clave, valor) VALUES ('pulpos_lee_todas', '1')`).run();
}

// La N938 entró con el texto de Pulpos para ventas sin cliente, en vez de un nombre.
function clienteSinAsignar(db) {
  db.prepare(`UPDATE clientes SET nombre = 'SIN NOMBRE N938' WHERE nombre = 'Asignar Cliente'`).run();
}

// Con qué folio y en qué día quedó escrito cada renglón, para poder encontrarlo después.
function renglonEnHoja(db) {
  const columnas = db.prepare('PRAGMA table_info(sheets_registros)').all().map((c) => c.name);
  if (columnas.includes('folio_hoja')) return;
  db.exec('ALTER TABLE sheets_registros ADD COLUMN folio_hoja TEXT');
  db.exec('ALTER TABLE sheets_registros ADD COLUMN fecha_hoja TEXT');
  db.exec(`UPDATE sheets_registros SET
    folio_hoja = (SELECT folio FROM notas n WHERE n.id = nota_id),
    fecha_hoja = (SELECT date(actualizado_en) FROM notas n WHERE n.id = nota_id)
    WHERE estado = 'registrado'`);
}

// Teléfono capturado en la nota: es el que recibe los avisos, aunque el cliente tenga otro guardado.
function telefonoDeNota(db) {
  const columnas = db.prepare('PRAGMA table_info(notas)').all().map((c) => c.name);
  if (!columnas.includes('telefono')) db.exec('ALTER TABLE notas ADD COLUMN telefono TEXT');
  // SC o SALIDA elegida a mano; vacío = la que toca por su folio.
  if (!columnas.includes('etiqueta')) db.exec('ALTER TABLE notas ADD COLUMN etiqueta TEXT');
}

// Saldos Pendientes: lo que falta por entregar de una nota enviada en parcial. Sigue como "pendiente",
// pero fuera de esa columna hasta que se re-programe.
function saldosPendientes(db) {
  const columnas = db.prepare('PRAGMA table_info(notas)').all().map((c) => c.name);
  if (!columnas.includes('saldo')) db.exec('ALTER TABLE notas ADD COLUMN saldo INTEGER NOT NULL DEFAULT 0');
}

// Entradas de almacén con folio y varios artículos: cada entrada vieja queda con su único renglón.
function entradasConRenglones(db) {
  const columnas = db.prepare('PRAGMA table_info(entradas_almacen)').all().map((c) => c.name);
  if (columnas.includes('renglones')) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE entradas_nueva (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      sucursal  TEXT NOT NULL DEFAULT 'Concordia',
      proveedor TEXT,
      folio     TEXT,
      nota      TEXT,
      renglones TEXT NOT NULL,
      creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )`);
    db.exec(`INSERT INTO entradas_nueva (id, sucursal, proveedor, nota, renglones, creado_en)
      SELECT id, sucursal, proveedor, nota, json_array(json_object('cantidad', cantidad, 'unidad', COALESCE(unidad, ''), 'material', material)), creado_en
      FROM entradas_almacen`);
    db.exec('DROP TABLE entradas_almacen');
    db.exec('ALTER TABLE entradas_nueva RENAME TO entradas_almacen');
  })();
  console.log('[bd] Migración aplicada: entradas con varios artículos');
}

// Nota interna de una orden de compra, editable en el pizarrón.
function notaDeOrden(db) {
  const columnas = db.prepare('PRAGMA table_info(ordenes_compra)').all().map((c) => c.name);
  if (!columnas.includes('nota')) db.exec('ALTER TABLE ordenes_compra ADD COLUMN nota TEXT');
}

module.exports = function migrar(db) {
  notaDeOrden(db);
  entradasConRenglones(db);
  saldosPendientes(db);
  telefonoDeNota(db);
  renglonEnHoja(db);
  clienteSinAsignar(db);
  pulposDesdeHoy(db);
  choferAlmacen(db);
  notasArchivadas(db);
  choferDario(db);
  fotoDelCliente(db);
  materialSinSufijo(db);
  preciosIniciales(db);
  trabajadoresIniciales(db);
  estadoCargando(db);
  camionPorNota(db);
  seguimientoCotizaciones(db);
  telefonosDesdeDirecciones(db);
};
