const path = require('node:path');

const DATA = path.join(__dirname, '..', 'data');
const minutos = (valor, porDefecto) => (Number(valor) || porDefecto) * 60_000;

module.exports = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA, 'database.sqlite'),

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
    activo: process.env.WHATSAPP_ACTIVO === 'true',
    negocio: process.env.WHATSAPP_NEGOCIO || 'Materiales El Güero',
    grupoAgentes: process.env.WHATSAPP_GRUPO_AGENTES || 'AGENTES IA CHAT', // grupo del equipo donde contestan los agentes
    sesion: path.join(DATA, 'whatsapp-sesion'), // vinculación (equivale a WhatsApp Web)
    cache: path.join(DATA, 'whatsapp-cache'),
  },

  // Apps Script publicado como aplicación web en la hoja de Google (ver scripts/google-sheets/).
  sheets: {
    url: process.env.SHEETS_URL || '',
    token: process.env.SHEETS_TOKEN || '',
  },

  sicar: {
    activo: process.env.SICAR_ACTIVO === 'true',
    intervaloMs: minutos(process.env.SICAR_INTERVALO_MIN, 2),
    host: process.env.SICAR_DB_HOST || '192.168.1.67', // PC "MOSTRADOR"
    port: Number(process.env.SICAR_DB_PORT) || 3306,
    user: process.env.SICAR_DB_USER || '',
    password: process.env.SICAR_DB_PASSWORD || process.env.SICAR_DB_PASS || '', // SICAR_DB_PASS también vale
    database: process.env.SICAR_DB_NAME || 'sicar',
  },
};
