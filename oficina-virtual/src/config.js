const path = require('node:path');

const DATA = path.join(__dirname, '..', 'data');
const minutos = (valor, porDefecto) => (Number(valor) || porDefecto) * 60_000;
const bandera = (valor) => (valor === 'true' ? true : valor === 'false' ? false : undefined);

// Dos servidores en la red (ver src/sync/): el Principal (Oficina completa + Chatito) y el de Mostrador, que trabaja
// aunque el Principal esté apagado y se sincroniza con él. En el de Mostrador, Chatito/WhatsApp, Google Sheets y el
// robot de Pulpos van apagados (no se duplican sesiones ni renglones), salvo que el .env diga lo contrario.
const rol = process.env.SERVER_ROLE === 'secondary' ? 'secondary' : 'primary';
const chatito = bandera(process.env.ENABLE_CHATITO) ?? (rol === 'primary' && process.env.WHATSAPP_ACTIVO === 'true');

module.exports = {
  rol,
  /** Chatito y todo lo que usa el WhatsApp del negocio (avisos, Inspector, grupo de agentes, seguimientos). */
  chatito,
  sync: {
    peer: (process.env.PEER_SERVER_URL || '').trim().replace(/\/+$/, ''),
    token: process.env.SYNC_TOKEN || '',
    intervaloMs: (Number(process.env.SYNC_INTERVALO_SEG) || 15) * 1000,
    // Mostrador: se actualiza solo con el programa del Principal (src/sync/programa.js).
    actualizar: bandera(process.env.AUTO_ACTUALIZAR) ?? rol === 'secondary',
    actualizarMs: (Number(process.env.AUTO_ACTUALIZAR_MIN) || 2) * 60_000,
  },
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA, 'database.sqlite'),

  // Punto de Venta (src/pos.js): carpeta de sus datos (pos.sqlite, usuarios) y sus respaldos diarios.
  pos: {
    datos: process.env.POS_DATOS ? path.resolve(process.env.POS_DATOS) : path.join(DATA, 'pos'),
    // Los tickets del Punto de Venta se imprimen en la impresora de la PC de Mostrador, por el enlace (src/impresora.js):
    // desde cualquier Chrome, sin cuadro de "Imprimir" y con el corte de cada copia.
    imprimirEnMostrador: bandera(process.env.POS_IMPRIMIR_EN_MOSTRADOR) ?? true,
    // Opcional (POS_VENTANA=true): el botón "Punto de Venta" abre una ventana aparte con impresión directa del navegador
    // (src/ventana-pos.js). Ya no hace falta con imprimirEnMostrador.
    ventana: bandera(process.env.POS_VENTANA) ?? false,
    impresora: process.env.POS_IMPRESORA ?? (rol === 'secondary' ? 'WL88S' : ''),
    // Conector del Punto de Venta (src/integraciones/pos): pasa al tablero las ventas con envío, la gasolina de la Caja
    // a Edgar y los rescates de Sulema, como el robot de Pulpos. Apagado hasta POS_CONECTOR_ACTIVO=true; sólo en el Principal
    // (Mostrador recibe las notas por la sincronización).
    conector: {
      activo: process.env.POS_CONECTOR_ACTIVO === 'true' && rol === 'primary',
      intervaloMs: minutos(process.env.POS_CONECTOR_INTERVALO_MIN, 1),
    },
  },

  respaldos: {
    hora: Number(process.env.RESPALDO_HORA) || 18, // hora del día, de 0 a 23
  },

  pulpos: {
    activo: process.env.PULPOS_ACTIVO === 'true',
    intervaloMs: minutos(process.env.PULPOS_INTERVALO_MIN, 1),
    // Sólo ventas con "Envío a Domicilio"; las de recoger en tienda no necesitan camión.
    soloEnvios: process.env.PULPOS_SOLO_ENVIOS !== 'false',
    perfil: path.join(DATA, 'pulpos-perfil'), // sesión del navegador del robot
  },

  whatsapp: {
    activo: chatito,
    negocio: process.env.WHATSAPP_NEGOCIO || 'Materiales El Güero',
    grupoAgentes: process.env.WHATSAPP_GRUPO_AGENTES || 'AGENTES IA CHAT', // grupo del equipo donde contestan los agentes
    sesion: path.join(DATA, 'whatsapp-sesion'), // vinculación (equivale a WhatsApp Web)
    cache: path.join(DATA, 'whatsapp-cache'),
  },

  // Apps Script publicado como aplicación web en la hoja de Google (ver scripts/google-sheets/).
  sheets: {
    url: rol === 'primary' || process.env.SHEETS_EN_MOSTRADOR === 'true' ? process.env.SHEETS_URL || '' : '',
    token: process.env.SHEETS_TOKEN || '',
  },

  sicar: {
    activo: process.env.SICAR_ACTIVO === 'true',
    intervaloMs: minutos(process.env.SICAR_INTERVALO_MIN, 1),
    host: process.env.SICAR_DB_HOST || '192.168.1.67', // PC "MOSTRADOR"
    port: Number(process.env.SICAR_DB_PORT) || 3306,
    user: process.env.SICAR_DB_USER || '',
    password: process.env.SICAR_DB_PASSWORD || process.env.SICAR_DB_PASS || '', // SICAR_DB_PASS también vale
    database: process.env.SICAR_DB_NAME || 'sicar',
  },
};
