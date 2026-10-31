-- Esquema idempotente: se ejecuta en cada arranque.

CREATE TABLE IF NOT EXISTS clientes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT NOT NULL,
  telefono  TEXT,               -- formato internacional sin '+', ej. 5215512345678 (whatsapp-web.js)
  zona      TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS choferes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre   TEXT NOT NULL,
  telefono TEXT,
  unidad   TEXT,                -- histórico; el camión ahora se elige por nota (tabla camiones)
  activo   INTEGER NOT NULL DEFAULT 1
);

-- El chofer y el camión se eligen por separado en cada nota: no siempre van juntos.
CREATE TABLE IF NOT EXISTS camiones (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,         -- ej. "Ram 4000", "Estaquitas Roja"
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  origen         TEXT NOT NULL DEFAULT 'manual',   -- manual | pulpos | sicar | whatsapp
  folio          TEXT NOT NULL,                    -- folio tal cual en el sistema de origen
  id_externo     TEXT,                             -- id interno del sistema de origen (enlace "ver en Pulpos")
  cliente_id     INTEGER NOT NULL REFERENCES clientes(id),
  material       TEXT NOT NULL,                    -- producto principal
  cantidad       REAL NOT NULL CHECK (cantidad > 0),
  unidad         TEXT NOT NULL DEFAULT 'm³',       -- m³ | pz | viaje …
  detalle        TEXT,                             -- todas las partidas cuando hay más de una
  total          REAL,
  direccion      TEXT NOT NULL,
  zona           TEXT,
  chofer_id      INTEGER REFERENCES choferes(id),
  camion_id      INTEGER REFERENCES camiones(id),
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente', 'cargando', 'en_ruta', 'entregado')),
  creado_en      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (origen, folio)
);

CREATE INDEX IF NOT EXISTS idx_notas_estado ON notas(estado);

-- Bitácora de cambios de estado (auditoría y base para el registro en Google Sheets).
CREATE TABLE IF NOT EXISTS historial_estados (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id         INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  estado_anterior TEXT,
  estado_nuevo    TEXT NOT NULL,
  fecha           TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Ventas ya revisadas por los conectores (importadas u omitidas), para no reprocesarlas.
CREATE TABLE IF NOT EXISTS integracion_vistos (
  origen    TEXT NOT NULL,
  folio     TEXT NOT NULL,
  resultado TEXT NOT NULL,       -- importada | omitida: <motivo>
  fecha     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (origen, folio)
);

-- Avisos de WhatsApp por nota. UNIQUE evita mandar dos veces el mismo aviso
-- (ej. si una nota regresa de En Ruta y vuelve a salir).
CREATE TABLE IF NOT EXISTS whatsapp_envios (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id  INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  tipo     TEXT NOT NULL,          -- en_ruta
  telefono TEXT,
  estado   TEXT NOT NULL,          -- enviado | pendiente | sin_telefono | no_whatsapp | error
  detalle  TEXT,
  fecha    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (nota_id, tipo)
);

-- Registro de entregas en Google Sheets: una fila por nota (aunque se regrese y se vuelva a entregar).
CREATE TABLE IF NOT EXISTS sheets_registros (
  nota_id INTEGER PRIMARY KEY REFERENCES notas(id) ON DELETE CASCADE,
  estado  TEXT NOT NULL,          -- registrado | pendiente | error
  detalle TEXT,
  fecha   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Cambios por aplicar a renglones ya escritos en la hoja (borrar o actualizar), en orden. Sobreviven
-- a un reinicio o a una caída de internet.
CREATE TABLE IF NOT EXISTS sheets_cambios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  accion    TEXT NOT NULL,        -- borrar | actualizar
  fecha     TEXT NOT NULL,        -- día del renglón: dice en qué pestaña está
  folio     TEXT NOT NULL,        -- folio con el que está escrito
  nuevo     TEXT,                 -- JSON con los datos nuevos (actualizar)
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Pizarrón de la Oficina: pendientes del equipo humano.
CREATE TABLE IF NOT EXISTS chalkboard (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  texto         TEXT NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completado')),
  creado_por    TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  completado_en TEXT
);

-- Memoria de los agentes: lo que el usuario les pide recordar ("recuerda que…").
CREATE TABLE IF NOT EXISTS agentes_chat (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  agente TEXT NOT NULL,            -- rutas | chasis | inspector
  de     TEXT NOT NULL,            -- tu | agente
  texto  TEXT NOT NULL,
  fecha  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS agentes_memoria (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  agente TEXT NOT NULL,            -- rutas | chasis | inspector
  texto  TEXT NOT NULL,
  fecha  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ===== El Inspector: cotizaciones =====

-- Lista de precios. "claves" son las palabras con que se reconoce el producto en una solicitud
-- (separadas por coma, en minúsculas y sin acentos). Crece sola al aprobar cotizaciones.
CREATE TABLE IF NOT EXISTS precios (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre         TEXT NOT NULL,
  unidad         TEXT NOT NULL,          -- m³ | bulto | pz | …
  precio         REAL NOT NULL CHECK (precio >= 0),
  claves         TEXT NOT NULL,
  activo         INTEGER NOT NULL DEFAULT 1,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Flete por colonia (colonia_clave = minúsculas y sin acentos). También se aprende al aprobar.
CREATE TABLE IF NOT EXISTS fletes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  colonia        TEXT NOT NULL,
  colonia_clave  TEXT NOT NULL UNIQUE,
  precio         REAL NOT NULL CHECK (precio >= 0),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id   INTEGER NOT NULL REFERENCES clientes(id),
  colonia      TEXT,
  solicitud    TEXT,                     -- texto tal como se capturó
  total        REAL NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'aprobada',  -- aprobada | pagada | cerrada (sin venta)
  whatsapp     TEXT,                     -- enviado | sin_telefono | no_whatsapp | error | desconectado
  creado_en    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  metodo_pago  TEXT,
  enviada_en   TEXT,                     -- hora exacta en que salió por WhatsApp
  seguimiento_para   TEXT,               -- enviada_en + 24 horas
  seguimiento_estado TEXT,               -- pendiente | enviado | cancelado | no_whatsapp | error
  pagada_en    TEXT
);

CREATE TABLE IF NOT EXISTS cotizacion_partidas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id  INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'producto',   -- producto | flete
  descripcion    TEXT NOT NULL,
  cantidad       REAL NOT NULL CHECK (cantidad > 0),
  unidad         TEXT NOT NULL,
  precio         REAL NOT NULL CHECK (precio >= 0),
  importe        REAL NOT NULL
);

-- Solicitudes de cotización que llegan por WhatsApp. El Inspector las deja como borrador
-- (con precios de la lista); un humano las revisa y aprueba antes de enviar nada al cliente.
CREATE TABLE IF NOT EXISTS solicitudes_whatsapp (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  telefono       TEXT,
  nombre         TEXT,
  mensaje        TEXT NOT NULL,
  borrador       TEXT NOT NULL,                       -- JSON del borrador (mismo formato que /borrador)
  estado         TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | cotizada | en_nota | descartada
  cotizacion_id  INTEGER REFERENCES cotizaciones(id),
  recibido_en    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Plática de cada número con El Inspector: lo que ha escrito (se junta porque los datos suelen
-- llegar en varios mensajes) y cuándo se le mandó la bienvenida (máximo una cada 24 horas).
CREATE TABLE IF NOT EXISTS conversaciones_whatsapp (
  clave          TEXT PRIMARY KEY,                    -- teléfono, o id del chat si oculta su número
  textos         TEXT NOT NULL DEFAULT '',
  esperando      INTEGER NOT NULL DEFAULT 0,          -- 1: se le pidieron datos y falta que conteste
  solicitud_id   INTEGER REFERENCES solicitudes_whatsapp(id),
  bienvenida_en  TEXT,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Pizarra de asistencias: una marca por trabajador y día (sin marca = todavía no se pasa lista).
CREATE TABLE IF NOT EXISTS trabajadores (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS asistencias (
  trabajador_id  INTEGER NOT NULL REFERENCES trabajadores(id),
  fecha          TEXT NOT NULL,                       -- AAAA-MM-DD
  estado         TEXT NOT NULL CHECK (estado IN ('asistio', 'falta')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (trabajador_id, fecha)
);

-- Valores de configuración que deben sobrevivir reinicios (ej. desde cuándo importar).
CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- ===== Octavio: órdenes de compra y entradas de almacén =====

-- original: la lista como llegó; renglones: la vigente. Si difieren al aprobar, se contesta con las cantidades.
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clave          TEXT NOT NULL,           -- teléfono o chat de quien la manda
  telefono       TEXT,
  solicitante    TEXT NOT NULL,
  sucursal       TEXT NOT NULL DEFAULT 'Concordia',
  mensaje        TEXT NOT NULL DEFAULT '',
  foto           TEXT,
  original       TEXT NOT NULL DEFAULT '[]',
  renglones      TEXT NOT NULL DEFAULT '[]',
  estado         TEXT NOT NULL DEFAULT 'por_aprobar'
                 CHECK (estado IN ('por_aprobar', 'aprobada', 'surtida', 'cancelada', 'descartada')),
  whatsapp       TEXT,
  nota           TEXT,
  aprobada_en    TEXT,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ordenes_estado ON ordenes_compra(estado);

CREATE TABLE IF NOT EXISTS entradas_almacen (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sucursal  TEXT NOT NULL DEFAULT 'Concordia',
  proveedor TEXT,
  folio     TEXT, -- obligatorio al capturar; las entradas de antes de este campo no lo traen
  nota      TEXT,
  renglones TEXT NOT NULL, -- JSON: [{ cantidad, unidad, material }]
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);