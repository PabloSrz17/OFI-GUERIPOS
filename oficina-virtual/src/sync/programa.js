// Actualización automática del programa del Mostrador.
// El Principal publica (por el enlace, con SYNC_TOKEN) la lista de archivos del programa con su huella; el Mostrador
// la revisa cada pocos minutos y, si cambió y ya no se está moviendo, baja lo distinto, guarda respaldo de lo que
// tenía y se reinicia. Nunca toca el .env, data/ ni node_modules. Si con lo nuevo no logra arrancar,
// scripts/iniciar-oficina.ps1 regresa los archivos del respaldo (data/actualizacion/pendiente.json).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CARPETAS = ['src', 'public', 'scripts'];
const SUELTOS = ['package.json', 'package-lock.json'];
const FUERA = /(^scripts\/google-sheets\/|\.(bak|log|tmp|temp)$|(^|\/)(Thumbs\.db|Desktop\.ini|\.DS_Store)$)/i;
const RUTA_VALIDA = /^(?:(?:src|public|scripts)\/[\w\-. /]+|package(?:-lock)?\.json)$/;

const huella = (contenido) => crypto.createHash('sha256').update(contenido).digest('hex');

function rutaSegura(raiz, ruta) {
  if (!RUTA_VALIDA.test(ruta) || ruta.split('/').some((p) => p === '..' || p === '')) return null;
  return path.join(raiz, ...ruta.split('/'));
}

/** Archivos del programa de esta copia, con su huella. `version` cambia si cambia cualquiera. */
function manifiesto(raiz) {
  const archivos = [];
  const agregar = (ruta) => {
    if (FUERA.test(ruta)) return;
    archivos.push({ ruta, hash: huella(fs.readFileSync(path.join(raiz, ...ruta.split('/')))) });
  };
  const recorrer = (rel) => {
    for (const e of fs.readdirSync(path.join(raiz, ...rel.split('/')), { withFileTypes: true })) {
      const ruta = `${rel}/${e.name}`;
      if (e.isDirectory()) recorrer(ruta);
      else if (e.isFile()) agregar(ruta);
    }
  };
  for (const c of CARPETAS) if (fs.existsSync(path.join(raiz, c))) recorrer(c);
  for (const s of SUELTOS) if (fs.existsSync(path.join(raiz, s))) agregar(s);
  archivos.sort((a, b) => (a.ruta < b.ruta ? -1 : 1));
  return { version: huella(archivos.map((a) => `${a.ruta}:${a.hash}`).join('\n')), archivos };
}

const leerJson = (archivo) => {
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
};

/**
 * Lo que hace el Mostrador. `pedir(ruta)` trae JSON del Principal; `bajar(ruta)` trae un archivo (Buffer);
 * `reiniciar()` apaga en orden (el supervisor lo vuelve a arrancar).
 */
function crearActualizador({ raiz, datos, pedir, bajar, reiniciar, log = console.log, confirmarEnMs = 90_000 }) {
  const dir = path.join(datos, 'actualizacion');
  const PENDIENTE = path.join(dir, 'pendiente.json');
  const RECHAZADA = path.join(dir, 'rechazada.txt');
  let visto = null; // versión nueva vista en la revisión anterior: se aplica cuando ya no cambia
  let ocupado = false;
  let estado = 'Sin revisar';
  let temporizador = null;

  /** Tras arrancar bien con una actualización, la da por buena (el supervisor ya no la regresa). */
  function confirmarAlArrancar() {
    const p = leerJson(PENDIENTE);
    if (!p) return;
    temporizador = setTimeout(() => {
      try {
        fs.renameSync(PENDIENTE, path.join(dir, 'ultima.json'));
        log(`[actualizacion] programa nuevo funcionando (${p.archivos.length + p.nuevos.length} archivos)`);
      } catch {}
    }, confirmarEnMs);
    temporizador.unref?.();
  }

  async function revisar() {
    if (ocupado || fs.existsSync(PENDIENTE)) return estado;
    ocupado = true;
    try {
      const remoto = await pedir('/programa');
      const local = manifiesto(raiz);
      if (remoto.version === local.version) {
        visto = null;
        return (estado = 'Al día');
      }
      let rechazada = '';
      try {
        rechazada = fs.readFileSync(RECHAZADA, 'utf8').trim();
      } catch {}
      if (rechazada === remoto.version) return (estado = 'La última versión no arrancó aquí; se espera la siguiente');
      if (visto !== remoto.version) {
        visto = remoto.version; // el Principal puede estar a media edición: se espera a la siguiente revisión
        return (estado = 'Hay programa nuevo; se aplica en la siguiente revisión');
      }
      const mios = new Map(local.archivos.map((a) => [a.ruta, a.hash]));
      const cambiados = remoto.archivos.filter((a) => mios.get(a.ruta) !== a.hash);
      if (cambiados.some((a) => a.ruta === 'package-lock.json')) {
        return (estado = 'El programa nuevo necesita instalar dependencias: corre INSTALAR.cmd en esta PC');
      }
      // 1) Bajar todo a una carpeta aparte y revisar las huellas antes de tocar nada.
      const nuevo = path.join(dir, 'nuevo');
      fs.rmSync(nuevo, { recursive: true, force: true });
      for (const a of cambiados) {
        const destino = rutaSegura(nuevo, a.ruta);
        if (!destino) throw new Error(`ruta no permitida: ${a.ruta}`);
        const contenido = await bajar(a.ruta);
        if (huella(contenido) !== a.hash) throw new Error(`llegó incompleto: ${a.ruta}`);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, contenido);
      }
      // 2) Respaldo de lo que se va a reemplazar.
      const anterior = path.join(dir, 'anterior');
      fs.rmSync(anterior, { recursive: true, force: true });
      const archivos = [];
      const nuevos = [];
      for (const a of cambiados) {
        const actual = rutaSegura(raiz, a.ruta);
        if (fs.existsSync(actual)) {
          const copia = rutaSegura(anterior, a.ruta);
          fs.mkdirSync(path.dirname(copia), { recursive: true });
          fs.copyFileSync(actual, copia);
          archivos.push(a.ruta);
        } else nuevos.push(a.ruta);
      }
      // 3) Anotar (para poder regresar) y poner lo nuevo en su lugar.
      fs.writeFileSync(PENDIENTE, JSON.stringify({ version: remoto.version, archivos, nuevos, intentos: 0, cuando: new Date().toISOString() }, null, 2));
      try {
        for (const a of cambiados) {
          const destino = rutaSegura(raiz, a.ruta);
          fs.mkdirSync(path.dirname(destino), { recursive: true });
          fs.copyFileSync(rutaSegura(nuevo, a.ruta), destino);
        }
      } catch (e) {
        // A medio copiar: se deja todo como estaba.
        for (const r of archivos) fs.copyFileSync(rutaSegura(anterior, r), rutaSegura(raiz, r));
        for (const r of nuevos) fs.rmSync(rutaSegura(raiz, r), { force: true });
        fs.rmSync(PENDIENTE, { force: true });
        throw e;
      }
      fs.rmSync(nuevo, { recursive: true, force: true });
      log(`[actualizacion] programa nuevo del Principal: ${cambiados.length} archivos (${cambiados.map((a) => a.ruta).slice(0, 8).join(', ')}${cambiados.length > 8 ? '…' : ''}); reiniciando`);
      estado = 'Reiniciando con el programa nuevo';
      setTimeout(reiniciar, 500);
      return estado;
    } catch (e) {
      return (estado = `No se pudo revisar: ${e.message}`);
    } finally {
      ocupado = false;
    }
  }

  return { revisar, confirmarAlArrancar, estado: () => estado, detener: () => clearTimeout(temporizador) };
}

module.exports = { manifiesto, rutaSegura, crearActualizador };
