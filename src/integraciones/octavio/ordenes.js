// Max recibe por WhatsApp las órdenes de compra de la sucursal. Nada se guarda como aprobado ni se
// contesta solo: cada orden sale como alerta editable en la Oficina y un humano la aprueba o la descarta.
// Sin cambios contesta con la imagen de la orden; con cambios, con la lista de lo autorizado.
const db = require('../../db/connection');
const bus = require('../../events/bus');
const whatsapp = require('../whatsapp/cliente');
const imagen = require('../inspector/imagen');
const { aNumero } = require('../inspector/cotizador');
const { productoDeNota, unidadDe, datosConEmpaque, conBolsa } = require('../sicar/texto');

const VENTANA = `datetime('now', 'localtime', '-2 minutes')`; // lo que manda después de avisar se suma a su orden
const ESTADOS_PIZARRON = ['aprobada', 'surtida', 'cancelada'];

const stmts = {
  crear: db.prepare('INSERT INTO ordenes_compra (clave, telefono, solicitante, mensaje, foto, original, renglones) VALUES (@clave, @telefono, @solicitante, @mensaje, @foto, @renglones, @renglones)'),
  porId: db.prepare('SELECT * FROM ordenes_compra WHERE id = ?'),
  // Capturada a mano en la Oficina: la aprobó quien la escribe, no se le contesta a nadie.
  crearManual: db.prepare(`INSERT INTO ordenes_compra (clave, solicitante, sucursal, original, renglones, nota, estado, aprobada_en)
    VALUES ('oficina', @solicitante, @sucursal, @renglones, @renglones, @nota, 'aprobada', datetime('now', 'localtime'))`),
  abierta: db.prepare(`SELECT * FROM ordenes_compra WHERE clave = ? AND estado = 'por_aprobar' AND actualizado_en >= ${VENTANA} ORDER BY id DESC`),
  sumar: db.prepare(`UPDATE ordenes_compra SET mensaje = @mensaje, foto = @foto, original = @renglones, renglones = @renglones,
    actualizado_en = datetime('now', 'localtime') WHERE id = @id AND estado = 'por_aprobar'`),
  listar: db.prepare(`SELECT * FROM ordenes_compra WHERE estado <> 'descartada' ORDER BY estado = 'por_aprobar' DESC, id DESC LIMIT 200`),
  aprobar: db.prepare(`UPDATE ordenes_compra SET telefono = @telefono, solicitante = @solicitante, sucursal = @sucursal, renglones = @renglones,
    estado = 'aprobada', aprobada_en = datetime('now', 'localtime'), actualizado_en = datetime('now', 'localtime')
    WHERE id = @id AND estado = 'por_aprobar'`),
  descartar: db.prepare(`UPDATE ordenes_compra SET estado = 'descartada', actualizado_en = datetime('now', 'localtime') WHERE id = ? AND estado = 'por_aprobar'`),
  editar: db.prepare(`UPDATE ordenes_compra SET telefono = @telefono, solicitante = @solicitante, sucursal = @sucursal, renglones = @renglones,
    nota = @nota, estado = @estado, actualizado_en = datetime('now', 'localtime') WHERE id = @id AND estado IN ('aprobada', 'surtida', 'cancelada')`),
  mover: db.prepare(`UPDATE ordenes_compra SET estado = @estado, actualizado_en = datetime('now', 'localtime') WHERE id = @id AND estado IN ('aprobada', 'surtida', 'cancelada')`),
  whatsapp: db.prepare('UPDATE ordenes_compra SET whatsapp = ? WHERE id = ?'),
  // Eliminar desde Canceladas: queda como descartada (sale del pizarrón y del reporte; no se borra la fila).
  eliminar: db.prepare(`UPDATE ordenes_compra SET estado = 'descartada', actualizado_en = datetime('now', 'localtime') WHERE id = ? AND estado = 'cancelada'`),
  porAprobar: db.prepare(`SELECT COUNT(*) AS n FROM ordenes_compra WHERE estado = 'por_aprobar'`),
  porSurtir: db.prepare(`SELECT COUNT(*) AS n FROM ordenes_compra WHERE estado = 'aprobada'`),
  entrada: db.prepare('INSERT INTO entradas_almacen (proveedor, folio, nota, renglones) VALUES (@proveedor, @folio, @nota, @renglones)'),
  // Compras de SICAR: entran como órdenes aprobadas de Almacén (se capturan en SICAR al pedir).
  porExterno: db.prepare('SELECT id FROM ordenes_compra WHERE externo = ?'),
  crearDeSicar: db.prepare(`INSERT INTO ordenes_compra (clave, solicitante, sucursal, proveedor, externo, folio_externo, original, renglones, estado, aprobada_en, creado_en)
    VALUES ('sicar', 'SICAR', 'Almacén', @proveedor, @externo, @folio, @renglones, @renglones, 'aprobada', @fecha, @fecha)`),
  cancelarDeSicar: db.prepare(`UPDATE ordenes_compra SET estado = 'cancelada', actualizado_en = datetime('now', 'localtime') WHERE externo = ? AND estado = 'aprobada'`),
  externasAbiertas: db.prepare(`SELECT externo FROM ordenes_compra WHERE externo IS NOT NULL AND estado = 'aprobada'`),
  // Recepción de una orden: la entrada queda ligada a ella.
  entradaDeOrden: db.prepare(`INSERT INTO entradas_almacen (sucursal, proveedor, folio, nota, renglones, orden_id)
    VALUES (@sucursal, @proveedor, @folio, @nota, @renglones, @orden_id)`),
  surtir: db.prepare(`UPDATE ordenes_compra SET estado = 'surtida', actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  tocar: db.prepare(`UPDATE ordenes_compra SET actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  recibidas: db.prepare('SELECT orden_id, renglones FROM entradas_almacen WHERE orden_id IS NOT NULL'),
  recibidasDe: db.prepare('SELECT renglones FROM entradas_almacen WHERE orden_id = ?'),
  editarEntrada: db.prepare('UPDATE entradas_almacen SET proveedor = @proveedor, folio = @folio, nota = @nota, renglones = @renglones WHERE id = @id'),
  entradas: db.prepare('SELECT * FROM entradas_almacen ORDER BY id DESC LIMIT 50'),
  // Para la hoja impresa: de la más vieja a la más nueva, como se anotan en la libreta.
  entradasEntre: db.prepare('SELECT * FROM entradas_almacen WHERE date(creado_en) BETWEEN ? AND ? ORDER BY creado_en, id'),
};

// Lo que ya llegó de cada material (por material y unidad), sumando las entradas ligadas a la orden.
// Se calcula de las entradas, no se guarda en la orden: así editar la orden no lo borra.
const llave = (r) => `${String(r.material ?? '').trim().toUpperCase()}|${String(r.unidad ?? '').trim().toLowerCase()}`;
function sumarRecibido(filas) {
  const suma = new Map();
  for (const f of filas) for (const r of JSON.parse(f.renglones)) suma.set(llave(r), (suma.get(llave(r)) ?? 0) + (aNumero(r.cantidad) || 0));
  return suma;
}
// Por renglón: { recibido, pendiente } (números). Mismo material dos veces: lo recibido llena el primero.
function avanceDe(renglones, suma) {
  const queda = new Map(suma);
  return renglones.map((r) => {
    const pedido = aNumero(r.cantidad) || 0;
    const recibido = Math.min(pedido, queda.get(llave(r)) ?? 0);
    queda.set(llave(r), (queda.get(llave(r)) ?? 0) - recibido);
    return { recibido: Number(recibido.toFixed(3)), pendiente: Number((pedido - recibido).toFixed(3)) };
  });
}
function conDatos(o, suma) {
  if (!o) return o;
  const recibido = suma ?? sumarRecibido(stmts.recibidasDe.all(o.id));
  const renglones = JSON.parse(o.renglones);
  return { ...o, folio: o.folio_externo || `OC-${o.id}`, original: JSON.parse(o.original), renglones, avance: avanceDe(renglones, recibido) };
}
const avisar = () => bus.emit('orden:cambio');
const obtener = (id) => conDatos(stmts.porId.get(id));

const limpio = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dicePalabra = (texto) => /\b(?:orden(?:es)?|compras?|mando)\b/.test(limpio(texto));
const diceNombre = (texto) => /\bmax\b/i.test(String(texto ?? '')); // con acentos: "máx" (máximo) no es Max
const esOrden = (texto) => diceNombre(texto) && dicePalabra(texto);

// "Max" y la palabra pueden llegar en mensajes separados, hasta 2 minutos aparte. Sólo en memoria,
// como los recientes de Chatito. Con una orden abierta no se juntan: lo que siga manda se suma a ella.
const VENTANA_MS = 2 * 60_000;
const pistas = new Map(); // clave -> { nombre, ms }
function detectar(clave, texto, ms) {
  if (esOrden(texto)) {
    pistas.delete(clave);
    return true;
  }
  const nombre = diceNombre(texto);
  if ((!nombre && !dicePalabra(texto)) || stmts.abierta.get(clave)) return false;
  for (const [otra, p] of pistas) {
    if (p.ms < ms - VENTANA_MS) pistas.delete(otra);
  }
  const previa = pistas.get(clave);
  if (previa && previa.nombre !== nombre) {
    pistas.delete(clave);
    return true;
  }
  pistas.set(clave, { nombre, ms });
  return false;
}

// Lo que dice el aviso antes de la lista: "Max te mando esta orden de compra: 10 bultos cemento".
const INICIO_AVISO = /^\D*(?<![\p{L}\d])(?:max|[oó]rden(?:es)?|compras?|m[aá]nd[oó])(?![\p{L}\d])(?:\s+de(?!\p{L}))?[\s:.,-]*/iu;

// Sólo los renglones con cantidad: "gracias" o "para el lunes" se ven en el mensaje, no en la lista.
function renglonesDeTexto(texto) {
  return String(texto ?? '')
    .split(/\n|\+|,\s+(?=\d)/)
    .map((l) => l.replace(INICIO_AVISO, '').replace(/^[\s•*·-]+/, '').replace(/^\d+\s*[.)-]+\s+(?=\d)/, '').trim())
    .map((l) => {
      const alReves = l.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\S+)$/); // "cemento maya 10 bultos"
      return productoDeNota(alReves && unidadDe(alReves[3]) ? `${alReves[2]} ${alReves[3]} ${alReves[1]}` : l);
    })
    .filter(Boolean)
    .map((p) => ({ cantidad: String(p.cantidad), unidad: p.unidad, material: p.material }));
}

const deFoto = (leida) => (leida?.productos ?? []).filter((p) => p.producto)
  .map((p) => ({ cantidad: p.cantidad, unidad: p.unidad, material: p.producto.toUpperCase() }));

// Lo llama el lector de WhatsApp si el mensaje es para Max. leerFoto y guardarFoto son los de Chatito.
async function recibir(mensaje, { clave, telefono, contacto, texto, aviso, antes, leerFoto, guardarFoto }) {
  const previa = stmts.abierta.get(clave);
  const sinNada = previa && !previa.foto && previa.renglones === '[]';
  const orden = !aviso || sinNada ? previa : null; // un aviso nuevo con otra lista ya en curso es otra orden

  const textos = [...antes.filter((r) => !r.esFoto).map((r) => r.texto), texto].filter(Boolean);
  const fotos = [...antes.filter((r) => r.esFoto), ...(mensaje.type === 'image' ? [{ mensaje }] : [])];
  let renglones = textos.flatMap(renglonesDeTexto);
  let foto = orden?.foto ?? null;
  for (const f of fotos) {
    const { media, legible, leida } = await leerFoto(f.mensaje, clave, texto);
    if (legible) foto ??= guardarFoto(media);
    if (media && !legible) textos.push('[Foto que no se pudo leer]');
    renglones = [...renglones, ...deFoto(leida)];
    if (!media) textos.push('[Foto que no se pudo descargar: pídela de nuevo]');
    if (fotos.length && !leida && legible) textos.push('[Foto sin transcribir: revísala]');
  }

  const datos = { mensaje: [orden?.mensaje, ...textos].filter(Boolean).join('\n').slice(-2000), foto };
  if (orden) {
    stmts.sumar.run({ ...datos, id: orden.id, renglones: JSON.stringify([...JSON.parse(orden.renglones), ...renglones]) });
  } else {
    const solicitante = (contacto?.pushname || contacto?.name || clave).toUpperCase();
    const { lastInsertRowid } = stmts.crear.run({ ...datos, clave, telefono, solicitante, renglones: JSON.stringify(renglones) });
    console.log(`[octavio] orden OC-${lastInsertRowid} de ${solicitante}`);
  }
  avisar();
}

function validarRenglones(lista) {
  if (!Array.isArray(lista)) throw new Error('La orden no trae lista');
  const renglones = lista
    .map((r) => ({ cantidad: String(r.cantidad ?? '').trim(), unidad: String(r.unidad ?? '').trim(), material: String(r.material ?? '').trim().toUpperCase() }))
    .filter((r) => r.material);
  for (const r of renglones) {
    if (!(aNumero(r.cantidad) >= 0)) throw new Error(`Cantidad inválida en ${r.material}`);
  }
  if (!renglones.some((r) => aNumero(r.cantidad) > 0)) throw new Error('Pon al menos un material con cantidad');
  return renglones;
}

const claveDe = (r) => `${aNumero(r.cantidad)}|${String(r.unidad ?? '').toLowerCase()}|${String(r.material ?? '').toUpperCase()}`;
const sinCambios = (o) => JSON.stringify(o.original.map(claveDe)) === JSON.stringify(o.renglones.map(claveDe));
const linea = (r) => [r.cantidad, r.unidad, r.material].filter(Boolean).join(' ');
const mensajeAutorizado = (renglones) => `Me autorizaron estas cantidades:\n${renglones.map((r) => `- ${linea(r)}`).join('\n')}`;

// Deja anotado cómo salió. Si falla, la orden sigue aprobada y en el pizarrón se puede reenviar.
async function responder(orden) {
  let estado;
  if (!orden.telefono) estado = 'sin_telefono';
  else if (!whatsapp.estaListo()) estado = 'desconectado';
  else {
    try {
      const entregado = sinCambios(orden)
        ? await whatsapp.enviarImagen(orden.telefono, await imagen.generarOrdenPNG(orden), `${orden.folio}.png`, '¡Claro que sí! Aquí tienes tu orden:')
        : await whatsapp.enviar(orden.telefono, mensajeAutorizado(orden.renglones));
      estado = entregado ? 'enviado' : 'no_whatsapp';
    } catch (err) {
      console.error(`[octavio] ${orden.folio}:`, err.message);
      estado = 'error';
    }
  }
  stmts.whatsapp.run(estado, orden.id);
  avisar();
  return estado;
}

// Devuelve false si otra pantalla ya la atendió: así no sale dos veces el mensaje.
function aprobar(id, datos) {
  return stmts.aprobar.run({ ...datos, id, renglones: JSON.stringify(datos.renglones) }).changes > 0;
}

function editar(id, datos) {
  if (!ESTADOS_PIZARRON.includes(datos.estado)) throw new Error('Estatus inválido');
  const hecho = stmts.editar.run({ ...datos, id, nota: String(datos.nota ?? '').trim() || null, renglones: JSON.stringify(datos.renglones) }).changes > 0;
  if (hecho) avisar();
  return hecho;
}

// Mover entre columnas en cualquier sentido. No le avisa a nadie.
function mover(id, estado) {
  if (!ESTADOS_PIZARRON.includes(estado)) throw new Error('Estatus inválido');
  const hecho = stmts.mover.run({ id, estado }).changes > 0;
  if (hecho) avisar();
  return hecho;
}

function descartar(id) {
  const hecho = stmts.descartar.run(id).changes > 0;
  if (hecho) avisar();
  return hecho;
}

// Sólo las canceladas. No le avisa a nadie.
function eliminar(id) {
  const hecho = stmts.eliminar.run(id).changes > 0;
  if (hecho) avisar();
  return hecho;
}

// Orden de compra capturada en el panel de Max. Sin folio que escribir: el folio es OC-n.
function crearManual({ solicitante, sucursal = 'Almacén', nota, renglones }) {
  const quien = String(solicitante ?? '').trim().toUpperCase();
  if (!quien) throw new Error('Falta quién la solicita');
  const id = stmts.crearManual.run({
    solicitante: quien,
    sucursal: String(sucursal ?? '').trim() || 'Almacén',
    nota: String(nota ?? '').trim() || null,
    renglones: JSON.stringify(validarRenglones(renglones)),
  }).lastInsertRowid;
  avisar();
  return obtener(id);
}

// Un renglón a medias detiene todo: lo que entró a bodega no se pierde en silencio.
function renglonesDeEntrada(lista) {
  const renglones = (Array.isArray(lista) ? lista : [])
    .map((r) => ({ cantidad: String(r.cantidad ?? '').trim(), unidad: String(r.unidad ?? '').trim(), material: String(r.material ?? '').trim() }))
    .filter((r) => r.cantidad || r.unidad || r.material);
  if (!renglones.length) throw new Error('Agrega al menos un material');
  return renglones.map((r) => {
    if (!r.material) throw new Error(`Falta el material del renglón "${linea(r)}"`);
    if (!(aNumero(r.cantidad) > 0)) throw new Error(`Falta la cantidad de ${r.material.toUpperCase()}`);
    const { unidad, material } = datosConEmpaque(r); // B = BOLSAS, CB = CON BOLSA, igual que en las notas
    return { cantidad: r.cantidad, unidad: unidadDe(unidad) ?? conBolsa(unidad), material: material.toUpperCase() };
  });
}

function datosDeEntrada({ proveedor, folio, nota, renglones }) {
  const datos = {
    proveedor: String(proveedor ?? '').trim().toUpperCase() || null,
    folio: String(folio ?? '').trim().toUpperCase(),
    nota: String(nota ?? '').trim() || null,
    renglones: JSON.stringify(renglonesDeEntrada(renglones)),
  };
  if (!datos.folio) throw new Error('Falta el folio o factura');
  return datos;
}

function registrarEntrada(campos) {
  stmts.entrada.run(datosDeEntrada(campos));
  avisar();
}

// "Entregada" (cantidades = null: llega todo lo que falta) o "Entregada parcialmente" (lo que llegó
// de cada renglón, en el mismo orden). Pide el folio del proveedor y crea la entrada ligada a la orden.
// Si ya no falta nada, la orden pasa a Surtidas; si falta, se queda en Aprobadas con lo pendiente.
const recibirOrden = db.transaction((id, { folio, cantidades = null, nota } = {}) => {
  const orden = obtener(id);
  if (!orden) throw new Error('Orden no encontrada');
  if (orden.estado !== 'aprobada') throw new Error(`${orden.folio} no está en Aprobadas`);
  const folioEntrada = String(folio ?? '').trim().toUpperCase();
  if (!folioEntrada) throw new Error('Falta el folio de entrada (factura o nota del proveedor)');
  if (cantidades !== null && (!Array.isArray(cantidades) || cantidades.length !== orden.renglones.length)) throw new Error('Las cantidades no coinciden con la orden');
  const todos = orden.renglones.map((r, i) => {
    const { pendiente } = orden.avance[i];
    const cantidad = cantidades === null ? pendiente : aNumero(String(cantidades[i] ?? '').trim() || '0');
    if (!(cantidad >= 0)) throw new Error(`Cantidad inválida en ${r.material}`);
    if (cantidad > pendiente + 1e-9) throw new Error(`De ${r.material} sólo faltan ${pendiente}`);
    return { cantidad, unidad: r.unidad, material: r.material, falta: pendiente - cantidad > 1e-9 };
  });
  const llegan = todos.filter((r) => r.cantidad > 0);
  if (!llegan.length) throw new Error('Pon cuánto llegó de al menos un material');
  stmts.entradaDeOrden.run({
    sucursal: orden.sucursal,
    proveedor: orden.proveedor ?? null,
    folio: folioEntrada,
    nota: String(nota ?? '').trim() || `${orden.folio}${todos.some((r) => r.falta) ? ' · parcial' : ''}`,
    renglones: JSON.stringify(llegan.map((r) => ({ cantidad: String(Number(r.cantidad.toFixed(3))), unidad: r.unidad, material: r.material }))),
    orden_id: orden.id,
  });
  const despues = obtener(id);
  const completa = despues.avance.every((a) => a.pendiente <= 1e-9);
  if (completa) stmts.surtir.run(id);
  else stmts.tocar.run(id);
  avisar();
  return { orden: obtener(id), completa };
});

// Compras de SICAR -> órdenes aprobadas de Almacén. compras: [{ externo, folio, proveedor, fecha, renglones }].
function importarDeSicar(compras) {
  let nuevas = 0;
  for (const c of compras) {
    if (stmts.porExterno.get(String(c.externo))) continue;
    stmts.crearDeSicar.run({
      folio: String(c.folio),
      proveedor: c.proveedor || null,
      externo: String(c.externo),
      renglones: JSON.stringify(c.renglones),
      fecha: c.fecha,
    });
    nuevas++;
  }
  if (nuevas) avisar();
  return nuevas;
}

// Compra cancelada en SICAR: si su orden sigue en Aprobadas, pasa a Canceladas.
function cancelarDeSicar(externos) {
  let hechas = 0;
  for (const e of externos) hechas += stmts.cancelarDeSicar.run(String(e)).changes;
  if (hechas) avisar();
  return hechas;
}

function editarEntrada(id, campos) {
  const hecho = stmts.editarEntrada.run({ ...datosDeEntrada(campos), id }).changes > 0;
  if (hecho) avisar();
  return hecho;
}

module.exports = {
  esOrden,
  detectar,
  abierta: (clave) => Boolean(stmts.abierta.get(clave)),
  recibir,
  renglonesDeTexto,
  validarRenglones,
  sinCambios,
  mensajeAutorizado,
  responder,
  aprobar,
  editar,
  mover,
  descartar,
  eliminar,
  crearManual,
  obtener,
  registrarEntrada,
  editarEntrada,
  recibirOrden,
  importarDeSicar,
  cancelarDeSicar,
  externasAbiertas: () => stmts.externasAbiertas.all().map((r) => r.externo),
  listar: () => {
    const porOrden = new Map();
    for (const f of stmts.recibidas.all()) porOrden.set(f.orden_id, [...(porOrden.get(f.orden_id) ?? []), f]);
    return stmts.listar.all().map((o) => conDatos(o, sumarRecibido(porOrden.get(o.id) ?? [])));
  },
  entradas: () => stmts.entradas.all().map((e) => ({ ...e, renglones: JSON.parse(e.renglones) })),
  entradasEntre: (desde, hasta) => stmts.entradasEntre.all(desde, hasta).map((e) => ({ ...e, renglones: JSON.parse(e.renglones) })),
  porAprobar: () => stmts.porAprobar.get().n,
  porSurtir: () => stmts.porSurtir.get().n,
};
