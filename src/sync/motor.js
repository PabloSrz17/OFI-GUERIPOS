// Sincronización entre dos Oficinas Virtuales (Principal y Mostrador) que pueden trabajar separadas.
//
// - Cada tabla de negocio anota sus cambios en sync_cambios con triggers de SQLite: así no hay que tocar cada
//   pantalla ni cada robot. Lo que llega del otro servidor se aplica con los triggers apagados (no hace eco).
// - Folios sin choques: cada lado anota qué filas creó él (sync_creadas). Si los dos crearon el mismo número
//   mientras estaban separados, el Mostrador le da un número nuevo a la suya (y a lo que apunta a ella) y el
//   Principal conserva la suya. (SQLite siempre numera arriba del id más alto, así que no sirven rangos separados.)
// - Si los dos cambiaron la misma fila, gana el cambio más reciente (en empate, el Principal).
// - Si los dos crearon "lo mismo" (la misma venta de SICAR, la misma colonia), se funden en una fila: se queda el
//   id menor y lo que apuntaba al otro se pasa a ese.
// Recibe la base como parámetro (no la abre): las pruebas usan dos bases en memoria.
const crypto = require('node:crypto');
const TABLAS = require('./tablas');

const AHORA_MS = "CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)";
const q = (nombre) => `"${String(nombre).replace(/"/g, '""')}"`;

function crearMotor(db, { rol = 'primary' } = {}) {
  const secundario = rol === 'secondary';
  const existe = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const tablas = TABLAS.filter(existe);
  const info = {};

  function leerInfo() {
    for (const t of tablas) {
      const columnas = db.prepare(`PRAGMA table_info(${q(t)})`).all();
      const pk = columnas.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name);
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).sql;
      const unicos = db
        .prepare(`PRAGMA index_list(${q(t)})`)
        .all()
        .filter((i) => i.unique && i.origin !== 'pk')
        .map((i) => db.prepare(`PRAGMA index_info(${q(i.name)})`).all().map((c) => c.name));
      info[t] = { columnas: columnas.map((c) => c.name), pk, autoinc: /AUTOINCREMENT/i.test(sql) && pk.length === 1, unicos, hijos: [] };
    }
    // Quién apunta a quién (para fundir filas repetidas).
    for (const t of tablas)
      for (const fk of db.prepare(`PRAGMA foreign_key_list(${q(t)})`).all())
        if (info[fk.table]) info[fk.table].hijos.push({ tabla: t, columna: fk.from });
  }

  function instalar() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_cambios (
        version INTEGER PRIMARY KEY AUTOINCREMENT,
        tabla   TEXT NOT NULL,
        clave   TEXT NOT NULL,     -- JSON con la llave primaria, ej. [123] o [4,"2026-11-23"]
        momento INTEGER NOT NULL   -- milisegundos (hora de esta PC)
      );
      CREATE INDEX IF NOT EXISTS idx_sync_cambios_fila ON sync_cambios(tabla, clave);
      CREATE TABLE IF NOT EXISTS sync_control (
        id        INTEGER PRIMARY KEY CHECK (id = 1),
        nodo      TEXT NOT NULL,          -- identidad de esta base
        aplicando INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sync_pares (
        nodo           TEXT PRIMARY KEY,  -- el otro servidor
        version        INTEGER NOT NULL DEFAULT 0, -- hasta dónde le hemos traído cambios
        confirmado     INTEGER NOT NULL DEFAULT 0, -- hasta dónde nos ha traído él (para limpiar la bitácora)
        inicializado   INTEGER NOT NULL DEFAULT 0,
        actualizado_en TEXT
      );
      CREATE TABLE IF NOT EXISTS sync_creadas (
        tabla   TEXT NOT NULL,
        clave   TEXT NOT NULL,     -- fila creada en esta base (no traída del otro servidor)
        momento INTEGER NOT NULL,
        PRIMARY KEY (tabla, clave)
      );
      CREATE TABLE IF NOT EXISTS sync_conflictos (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        tabla  TEXT NOT NULL,
        clave  TEXT NOT NULL,
        motivo TEXT NOT NULL,
        fecha  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);
    db.prepare('INSERT OR IGNORE INTO sync_control (id, nodo) VALUES (1, ?)').run(crypto.randomUUID());
    db.prepare('UPDATE sync_control SET aplicando = 0').run();
    leerInfo();
    // Los triggers se rehacen en cada arranque: las migraciones reconstruyen tablas y se llevan los suyos.
    db.transaction(() => {
      for (const t of tablas) {
        const { pk } = info[t];
        const clave = (fila) => `json_array(${pk.map((c) => `${fila}.${q(c)}`).join(', ')})`;
        const anota = (fila) => `INSERT INTO sync_cambios (tabla, clave, momento) VALUES ('${t}', ${clave(fila)}, ${AHORA_MS});`;
        const cuando = 'WHEN (SELECT aplicando FROM sync_control) = 0';
        for (const op of ['i', 'u', 'd']) db.exec(`DROP TRIGGER IF EXISTS ${q(`sync_${t}_${op}`)}`);
        const creada = info[t].autoinc ? `INSERT OR IGNORE INTO sync_creadas (tabla, clave, momento) VALUES ('${t}', ${clave('NEW')}, ${AHORA_MS});` : '';
        db.exec(`CREATE TRIGGER ${q(`sync_${t}_i`)} AFTER INSERT ON ${q(t)} ${cuando} BEGIN ${anota('NEW')} ${creada} END`);
        db.exec(`CREATE TRIGGER ${q(`sync_${t}_u`)} AFTER UPDATE ON ${q(t)} ${cuando} BEGIN ${anota('NEW')}
          INSERT INTO sync_cambios (tabla, clave, momento) SELECT '${t}', ${clave('OLD')}, ${AHORA_MS} WHERE ${clave('OLD')} <> ${clave('NEW')}; END`);
        db.exec(`CREATE TRIGGER ${q(`sync_${t}_d`)} AFTER DELETE ON ${q(t)} ${cuando} BEGIN ${anota('OLD')} END`);
      }
    })();
    db.prepare(`DELETE FROM sync_creadas WHERE momento < ${AHORA_MS} - 60 * 86400000`).run();
  }

  // ---- Lectura ----
  const nodo = () => db.prepare('SELECT nodo FROM sync_control').get().nodo;
  const ultimaVersion = () => db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM sync_cambios').get().v;
  const dondeClave = (t) => info[t].pk.map((c) => `${q(c)} = ?`).join(' AND ');
  const leerFila = (t, clave) => db.prepare(`SELECT * FROM ${q(t)} WHERE ${dondeClave(t)}`).get(...clave) ?? null;
  const creadaAqui = (t, clave) => !!db.prepare('SELECT 1 FROM sync_creadas WHERE tabla = ? AND clave = ?').get(t, clave);
  const momentoLocal = (t, clave) => db.prepare('SELECT MAX(momento) AS m FROM sync_cambios WHERE tabla = ? AND clave = ?').get(t, clave).m;

  /** Cambios de esta base posteriores a `desde`, la última versión de cada fila con su contenido (null = se borró). */
  function cambiosDesde(desde = 0, { limite = 500, par = null } = {}) {
    if (par) confirmar(par, desde);
    const filas = db
      .prepare('SELECT tabla, clave, MAX(version) AS v, MAX(momento) AS m FROM sync_cambios WHERE version > ? GROUP BY tabla, clave ORDER BY v LIMIT ?')
      .all(desde, limite + 1);
    const lote = filas.slice(0, limite).filter((f) => info[f.tabla]);
    return {
      nodo: nodo(),
      ultima: ultimaVersion(),
      hasta: filas.length ? filas[Math.min(filas.length, limite) - 1].v : desde,
      mas: filas.length > limite,
      cambios: lote.map((f) => ({ tabla: f.tabla, clave: f.clave, momento: f.m, creada: creadaAqui(f.tabla, f.clave), fila: leerFila(f.tabla, JSON.parse(f.clave)) })),
    };
  }

  /** Copia completa de las tablas que se sincronizan (para el primer arranque del Mostrador). */
  function foto() {
    return db.transaction(() => ({
      nodo: nodo(),
      version: ultimaVersion(),
      tablas: Object.fromEntries(tablas.map((t) => [t, db.prepare(`SELECT * FROM ${q(t)}`).all()])),
      momentos: Object.fromEntries(db.prepare('SELECT tabla || char(31) || clave AS k, MAX(momento) AS m FROM sync_cambios GROUP BY tabla, clave').all().map((r) => [r.k, r.m])),
    }))();
  }

  // ---- Escritura ----
  const setAplicando = (v) => db.prepare('UPDATE sync_control SET aplicando = ?').run(v ? 1 : 0);

  function upsert(t, fila) {
    const { columnas, pk } = info[t];
    const cols = columnas.filter((c) => Object.hasOwn(fila, c));
    const resto = cols.filter((c) => !pk.includes(c));
    const sql =
      `INSERT INTO ${q(t)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ` +
      `ON CONFLICT (${pk.map(q).join(', ')}) DO ${resto.length ? `UPDATE SET ${resto.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}` : 'NOTHING'}`;
    db.prepare(sql).run(...cols.map((c) => fila[c]));
  }

  /** La fila de esta base que choca con `fila` por un dato que no se puede repetir (folio, colonia, nombre…). */
  function choqueLocal(t, fila) {
    const id = info[t].pk[0];
    for (const u of info[t].unicos) {
      if (u.some((c) => fila[c] == null)) continue;
      const otra = db.prepare(`SELECT * FROM ${q(t)} WHERE ${u.map((c) => `${q(c)} = ?`).join(' AND ')} AND ${q(id)} <> ?`).get(...u.map((c) => fila[c]), fila[id]);
      if (otra) return otra;
    }
    return null;
  }

  /** Olvida una fila propia que desaparece al fundirse o renumerarse: no se le manda al otro servidor. */
  function olvidar(t, clave) {
    db.prepare('DELETE FROM sync_cambios WHERE tabla = ? AND clave = ?').run(t, clave);
    db.prepare('DELETE FROM sync_creadas WHERE tabla = ? AND clave = ?').run(t, clave);
  }
  const liberarUnicos = (t, id) => {
    for (const u of info[t].unicos) db.prepare(`UPDATE ${q(t)} SET ${q(u[0])} = ? WHERE ${q(info[t].pk[0])} = ?`).run(`~libre:${id}`, id);
  };
  function moverHijos(t, de, a) {
    for (const h of info[t].hijos) {
      db.prepare(`UPDATE OR IGNORE ${q(h.tabla)} SET ${q(h.columna)} = ? WHERE ${q(h.columna)} = ?`).run(a, de);
      db.prepare(`DELETE FROM ${q(h.tabla)} WHERE ${q(h.columna)} = ?`).run(de); // las que ya existían del otro lado
    }
  }

  /**
   * Los dos crearon una fila con el mismo número mientras estaban separados: el Mostrador le pone a la suya un
   * número nuevo (arriba de lo que viene llegando) y le pasa lo que apuntaba a ella.
   */
  function renumerar(t, viejo, minimo, resultado) {
    const id = info[t].pk[0];
    const { [id]: _, ...datos } = leerFila(t, [viejo]);
    const nuevo = Math.max(minimo, db.prepare(`SELECT COALESCE(MAX(${q(id)}), 0) AS m FROM ${q(t)}`).get().m) + 1;
    const cuando = momentoLocal(t, JSON.stringify([viejo]));
    setAplicando(true);
    liberarUnicos(t, viejo);
    setAplicando(false);
    upsert(t, { ...datos, [id]: nuevo });
    // Conserva cuándo se cambió de verdad (para decidir quién gana si el otro también la tocó).
    if (cuando != null) db.prepare('UPDATE sync_cambios SET momento = ? WHERE tabla = ? AND clave = ?').run(cuando, t, JSON.stringify([nuevo]));
    moverHijos(t, viejo, nuevo);
    setAplicando(true);
    db.prepare(`DELETE FROM ${q(t)} WHERE ${q(id)} = ?`).run(viejo);
    olvidar(t, JSON.stringify([viejo]));
    resultado.renumerados.push({ tabla: t, de: viejo, a: nuevo });
  }

  /** Funde dos filas que son la misma cosa (misma venta, misma colonia…): se queda la del Principal. */
  function fundir(t, remota, momentoRemoto, resultado) {
    const local = choqueLocal(t, remota);
    if (!local || info[t].pk.length !== 1) return false;
    const id = info[t].pk[0];
    const claveLocal = JSON.stringify([local[id]]);
    const localMasNueva = (momentoLocal(t, claveLocal) ?? 0) > momentoRemoto;
    const datos = (base, de) => ({ ...de, [id]: base[id] });
    setAplicando(false); // lo que se mueve aquí sí se le avisa al otro servidor
    if (!secundario) {
      // Se queda la nuestra; si la otra es más nueva, toma sus datos.
      if (!localMasNueva) upsert(t, datos(local, remota));
    } else {
      // Se queda la del otro servidor. 1) Se libera el dato repetido de la nuestra (sin avisar: se va a borrar),
      // 2) entra la otra (con nuestros datos si eran más nuevos), 3) lo que apuntaba a la nuestra pasa a la otra.
      setAplicando(true);
      liberarUnicos(t, local[id]);
      if (localMasNueva) {
        setAplicando(false);
        upsert(t, datos(remota, local));
        // Es la fila del Principal con nuestros datos: no es "creada aquí".
        db.prepare('DELETE FROM sync_creadas WHERE tabla = ? AND clave = ?').run(t, JSON.stringify([remota[id]]));
      } else upsert(t, remota);
      setAplicando(false);
      moverHijos(t, local[id], remota[id]);
      setAplicando(true);
      db.prepare(`DELETE FROM ${q(t)} WHERE ${q(id)} = ?`).run(local[id]);
      olvidar(t, claveLocal);
    }
    setAplicando(true);
    resultado.fundidos.push({ tabla: t, queda: secundario ? remota[id] : local[id], sale: secundario ? local[id] : remota[id] });
    return true;
  }

  function anotarConflicto(t, clave, motivo, resultado) {
    db.prepare('INSERT INTO sync_conflictos (tabla, clave, motivo) VALUES (?, ?, ?)').run(t, clave, motivo);
    resultado.conflictos.push({ tabla: t, clave, motivo });
  }

  /**
   * Aplica cambios traídos del otro servidor. `par`: { nodo, version } para recordar hasta dónde se trajo.
   * Devuelve qué pasó, incluidas las notas que cambiaron de estado (para avisos y Google Sheets).
   */
  function aplicar(cambios, par = null) {
    const resultado = { aplicados: 0, saltados: 0, pendientes: 0, fundidos: [], renumerados: [], conflictos: [], estados: [], tablas: new Set() };
    const orden = (t) => tablas.indexOf(t);
    const validos = cambios.filter((c) => info[c.tabla]);
    // Primero los borrados (hijos antes que padres), luego altas y cambios (padres antes que hijos).
    const borrados = validos.filter((c) => !c.fila).sort((a, b) => orden(b.tabla) - orden(a.tabla));
    const altas = validos.filter((c) => c.fila).sort((a, b) => orden(a.tabla) - orden(b.tabla));
    // El id más alto que viene llegando por tabla: al renumerar, la nuestra se pone arriba.
    const maxEntrante = {};
    for (const c of altas) if (info[c.tabla].autoinc) maxEntrante[c.tabla] = Math.max(maxEntrante[c.tabla] ?? 0, JSON.parse(c.clave)[0]);
    db.transaction(() => {
      setAplicando(true);
      try {
        for (const c of [...borrados, ...altas]) {
          const clave = JSON.parse(c.clave);
          // Mismo número, filas distintas (las dos se crearon aquí y allá).
          if (c.fila && c.creada && info[c.tabla].autoinc && creadaAqui(c.tabla, c.clave) && leerFila(c.tabla, clave)) {
            if (!secundario) {
              resultado.saltados++; // el Mostrador renumera la suya y la vuelve a mandar
              continue;
            }
            db.transaction(() => renumerar(c.tabla, clave[0], maxEntrante[c.tabla], resultado))();
          }
          const local = momentoLocal(c.tabla, c.clave);
          if (local != null && (local > c.momento || (local === c.momento && !secundario))) {
            resultado.saltados++;
            continue;
          }
          const previa = c.tabla === 'notas' ? leerFila('notas', clave) : null;
          try {
            db.transaction(() => {
              if (!c.fila) db.prepare(`DELETE FROM ${q(c.tabla)} WHERE ${dondeClave(c.tabla)}`).run(...clave);
              else {
                try {
                  upsert(c.tabla, c.fila);
                } catch (e) {
                  if (!/UNIQUE constraint failed/.test(e.message) || !fundir(c.tabla, c.fila, c.momento, resultado)) throw e;
                }
              }
            })();
          } catch (e) {
            // Falta su nota o su cliente: llega cuando el otro lado termine de acomodar sus filas.
            if (/FOREIGN KEY constraint failed/.test(e.message)) resultado.pendientes++;
            else anotarConflicto(c.tabla, c.clave, e.message, resultado);
            continue;
          }
          resultado.aplicados++;
          resultado.tablas.add(c.tabla);
          if (c.tabla === 'notas' && c.fila && previa?.estado !== c.fila.estado)
            resultado.estados.push({ id: c.fila.id, anterior: previa?.estado ?? null, nuevo: c.fila.estado });
        }
      } finally {
        setAplicando(false);
      }
      if (par) guardarPar(par.nodo, { version: par.version });
    })();
    return resultado;
  }

  /**
   * Primer arranque del Mostrador: se trae todo del Principal. Si esta base nunca tuvo cambios propios, se
   * reemplaza tal cual; si ya trabajó por su cuenta, se mezcla (lo propio, que es más nuevo, se conserva).
   */
  function inicializar(f) {
    const propios = db.prepare('SELECT COUNT(*) AS n FROM sync_cambios').get().n > 0;
    if (propios) {
      const cambios = [];
      for (const [t, filas] of Object.entries(f.tablas))
        if (info[t])
          for (const fila of filas) {
            const clave = JSON.stringify(info[t].pk.map((c) => fila[c]));
            // Todo lo de la copia existe en el Principal: si aquí hay otra fila propia con ese número, es otra cosa.
            cambios.push({ tabla: t, clave, momento: f.momentos?.[`${t}${clave}`] ?? 0, creada: true, fila });
          }
      const r = aplicar(cambios, { nodo: f.nodo, version: f.version });
      guardarPar(f.nodo, { inicializado: 1 });
      return { modo: 'mezcla', ...r };
    }
    db.transaction(() => {
      setAplicando(true);
      db.pragma('defer_foreign_keys = ON');
      try {
        for (const t of [...tablas].reverse()) db.prepare(`DELETE FROM ${q(t)}`).run();
        for (const t of tablas) for (const fila of f.tablas[t] ?? []) upsert(t, fila);
      } finally {
        setAplicando(false);
      }
      guardarPar(f.nodo, { version: f.version, inicializado: 1 });
    })();
    return { modo: 'copia', filas: Object.values(f.tablas).reduce((n, filas) => n + filas.length, 0) };
  }

  // ---- El otro servidor ----
  function guardarPar(nodoPar, campos) {
    db.prepare("INSERT OR IGNORE INTO sync_pares (nodo, actualizado_en) VALUES (?, datetime('now', 'localtime'))").run(nodoPar);
    for (const [k, v] of Object.entries(campos))
      if (['version', 'confirmado', 'inicializado'].includes(k)) db.prepare(`UPDATE sync_pares SET ${k} = ?, actualizado_en = datetime('now', 'localtime') WHERE nodo = ?`).run(v, nodoPar);
  }
  const par = () => db.prepare('SELECT * FROM sync_pares ORDER BY actualizado_en DESC LIMIT 1').get() ?? null;
  /** El otro servidor ya trajo hasta `version`: lo viejo de la bitácora ya no hace falta (se guarda una semana). */
  function confirmar(nodoPar, version) {
    guardarPar(nodoPar, { confirmado: version });
    db.prepare(`DELETE FROM sync_cambios WHERE version <= ? AND momento < ${AHORA_MS} - 7 * 86400000`).run(version);
  }
  /** El otro servidor cambió de base (se reinstaló o se restauró un respaldo): hay que volver a traer todo. */
  function reiniciarPar(nodoPar) {
    db.prepare('DELETE FROM sync_pares WHERE nodo = ?').run(nodoPar);
  }

  const estado = () => ({
    rol,
    nodo: nodo(),
    par: par(),
    pendientesPropios: db.prepare('SELECT COUNT(*) AS n FROM sync_cambios WHERE version > COALESCE((SELECT MAX(confirmado) FROM sync_pares), 0)').get().n,
    conflictos: db.prepare('SELECT * FROM sync_conflictos ORDER BY id DESC LIMIT 20').all(),
  });

  return { tablas, instalar, cambiosDesde, foto, aplicar, inicializar, par, reiniciarPar, estado, nodo };
}

module.exports = { crearMotor };
