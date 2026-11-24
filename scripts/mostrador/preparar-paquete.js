// npm run mostrador:paquete [-- --mostrador=192.168.1.67] [-- --principal=192.168.1.141]
//
// Se corre en el servidor PRINCIPAL. Hace dos cosas:
// 1) Deja este .env listo para el enlace: SERVER_ROLE=primary, PEER_SERVER_URL (la PC de Mostrador) y un
//    SYNC_TOKEN nuevo si no había (no cambia lo demás).
// 2) Arma dist/oficina-mostrador.zip para copiarlo a la PC de Mostrador: el programa (sin datos, sin sesiones de
//    WhatsApp ni de Pulpos) con su propio .env de servidor secundario (Chatito apagado) y su instalador.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const archiver = require('archiver');

const RAIZ = path.join(__dirname, '..', '..');
const ENV = path.join(RAIZ, '.env');
const SALIDA = path.join(RAIZ, 'dist');
const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1];

const ipsLocales = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address);

const leerEnv = (texto) => Object.fromEntries([...texto.matchAll(/^\s*([A-Z0-9_]+)\s*=(.*)$/gm)].map((m) => [m[1], m[2].trim()]));

/** Pone (o cambia) una variable del .env sin tocar las demás ni sus comentarios. */
function ponerVariable(texto, clave, valor) {
  const re = new RegExp(`^\\s*${clave}\\s*=.*$`, 'm');
  return re.test(texto) ? texto.replace(re, `${clave}=${valor}`) : `${texto.replace(/\s*$/, '')}\r\n${clave}=${valor}\r\n`;
}

function principal() {
  if (!fs.existsSync(ENV)) throw new Error('No hay .env en esta PC (copia .env.example como .env primero)');
  let texto = fs.readFileSync(ENV, 'utf8');
  const env = leerEnv(texto);
  if (env.SERVER_ROLE === 'secondary') throw new Error('Esta PC está configurada como Mostrador (SERVER_ROLE=secondary): corre esto en el Principal');

  const mostrador = arg('mostrador') || env.SICAR_DB_HOST || '192.168.1.67';
  const ip = arg('principal') || ipsLocales()[0];
  if (!ip) throw new Error('No encontré la IP de esta PC en la red; pásala con --principal=192.168.1.X');
  const puerto = env.PORT || '3000';
  const token = env.SYNC_TOKEN || crypto.randomBytes(24).toString('base64url');

  if (!/^\s*#\s*--- Dos servidores/m.test(texto)) texto = `${texto.replace(/\s*$/, '')}\r\n\r\n# --- Dos servidores: Principal (esta PC) y Mostrador (ver scripts/mostrador/LEEME.txt) ---\r\n`;
  texto = ponerVariable(texto, 'SERVER_ROLE', 'primary');
  texto = ponerVariable(texto, 'PEER_SERVER_URL', `http://${mostrador}:${puerto}`);
  texto = ponerVariable(texto, 'SYNC_TOKEN', token);
  if (!env.SYNC_INTERVALO_SEG) texto = ponerVariable(texto, 'SYNC_INTERVALO_SEG', '15');
  fs.writeFileSync(ENV, texto);

  // .env del Mostrador: servidor secundario, Chatito/WhatsApp, Pulpos y Sheets apagados; SICAR en su propia PC.
  const envMostrador = [
    '# Oficina Virtual - servidor de MOSTRADOR (secundario). Lo generó "npm run mostrador:paquete" en el Principal.',
    `PORT=${puerto}`,
    'HOST=0.0.0.0',
    'DB_PATH=./data/database.sqlite',
    `RESPALDO_HORA=${env.RESPALDO_HORA || '18'}`,
    '',
    '# --- Dos servidores ---',
    'SERVER_ROLE=secondary',
    '# Chatito apagado: no se duplica la sesión de WhatsApp ni se mete con el WhatsApp de mostrador.',
    'ENABLE_CHATITO=false',
    `PEER_SERVER_URL=http://${ip}:${puerto}`,
    `SYNC_TOKEN=${token}`,
    'SYNC_INTERVALO_SEG=15',
    '',
    '# SICAR está en esta misma PC. Sólo se importa mientras el Principal está apagado.',
    `SICAR_ACTIVO=${env.SICAR_ACTIVO || 'false'}`,
    `SICAR_INTERVALO_MIN=${env.SICAR_INTERVALO_MIN || '1'}`,
    'SICAR_DB_HOST=127.0.0.1',
    `SICAR_DB_PORT=${env.SICAR_DB_PORT || '3306'}`,
    `SICAR_DB_NAME=${env.SICAR_DB_NAME || 'sicar'}`,
    `SICAR_DB_USER=${env.SICAR_DB_USER || ''}`,
    `SICAR_DB_PASSWORD=${env.SICAR_DB_PASSWORD || env.SICAR_DB_PASS || ''}`,
    '',
    '# Lo hace sólo el Principal.',
    'PULPOS_ACTIVO=false',
    'WHATSAPP_ACTIVO=false',
    `WHATSAPP_NEGOCIO=${env.WHATSAPP_NEGOCIO || 'Materiales El Güero'}`,
    'SHEETS_URL=',
    'SHEETS_TOKEN=',
    '',
    '# Opcional: clave de Claude para que los agentes contesten también aquí.',
    'ANTHROPIC_API_KEY=',
    '',
  ].join('\r\n');

  fs.mkdirSync(SALIDA, { recursive: true });
  const zipRuta = path.join(SALIDA, 'oficina-mostrador.zip');
  const salida = fs.createWriteStream(zipRuta);
  const zip = archiver('zip', { zlib: { level: 6 } });
  const listo = new Promise((ok, mal) => {
    salida.on('close', ok);
    zip.on('error', mal);
  });
  zip.pipe(salida);
  const base = 'OficinaVirtual';
  for (const carpeta of ['src', 'public', 'scripts']) zip.directory(path.join(RAIZ, carpeta), `${base}/${carpeta}`, (e) => (/google-sheets[\\/]+.*token/i.test(e.name) ? false : e));
  for (const archivo of ['package.json', 'package-lock.json', '.env.example', 'README.md']) if (fs.existsSync(path.join(RAIZ, archivo))) zip.file(path.join(RAIZ, archivo), { name: `${base}/${archivo}` });
  zip.append(envMostrador, { name: `${base}/.env` });
  zip.file(path.join(__dirname, 'instalar.cmd'), { name: `${base}/INSTALAR.cmd` });
  zip.file(path.join(__dirname, 'LEEME.txt'), { name: `${base}/LEEME.txt` });
  zip.finalize();
  return listo.then(() => ({ zipRuta, ip, mostrador, puerto }));
}

principal()
  .then(({ zipRuta, ip, mostrador, puerto }) => {
    console.log('Listo.');
    console.log(`  Este servidor (Principal): http://${ip}:${puerto}  → se enlaza con el Mostrador en http://${mostrador}:${puerto}`);
    console.log(`  Paquete para la PC de Mostrador: ${zipRuta}`);
    console.log('  1) Copia el .zip a la PC de Mostrador y descomprímelo (por ejemplo en Documentos).');
    console.log('  2) Abre la carpeta OficinaVirtual y da doble clic en INSTALAR.cmd.');
    console.log('  3) Reinicia la Oficina de esta PC para que tome el enlace.');
    console.log('  Ojo: el .zip lleva la contraseña del enlace y la de SICAR; bórralo después de instalar.');
  })
  .catch((e) => {
    console.error(`No se pudo armar el paquete: ${e.message}`);
    process.exit(1);
  });
