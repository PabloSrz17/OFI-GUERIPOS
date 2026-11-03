// Octavio recibe por WhatsApp las órdenes de compra de la sucursal. Nada se guarda como aprobado ni se
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
  editarEntrada: db.prepare('UPDATE entradas_almacen SET proveedor = @proveedor, folio = @folio, nota = @nota, renglones = @renglones WHERE id = @id'),
  entradas: db.prepare('SELECT * FROM entradas_almacen ORDER BY id DESC LIMIT 50'),
  // Para la hoja impresa: de la más vieja a la más nueva, como se anotan en la libreta.
  entradasEntre: db.prepare('SELECT * FROM entradas_almacen WHERE date(creado_en) BETWEEN ? AND ? ORDER BY creado_en, id'),
};

const conDatos = (o) => o && { ...o, folio: `OC-${o.id}`, original: JSON.parse(o.original), renglones: JSON.parse(o.renglones) };
const avisar = () => bus.emit('orden:cambio');
const obtener = (id) => conDatos(stmts.porId.get(id));

const limpio = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dicePalabra = (texto) => /\b(?:orden(?:es)?|compras?|mando)\b/.test(limpio(texto));
const diceNombre = (texto) => /\boctavio\b/.test(limpio(texto));
const esOrden = (texto) => diceNombre(texto) && dicePalabra(texto);

// "Octavio" y la palabra pueden llegar en mensajes separados, hasta 2 minutos aparte. Sólo en memoria,
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

// Lo que dice el aviso antes de la lista: "Octavio te mando esta orden de compra: 10 bultos cemento".
const INICIO_AVISO = /^\D*(?<![\p{L}\d])(?:octavio|[oó]rden(?:es)?|compras?|m[aá]nd[oó])(?![\p{L}\d])(?:\s+de(?!\p{L}))?[\s:.,-]*/iu;

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

// Lo llama el lector de WhatsApp si el mensaje es para Octavio. leerFoto y guardarFoto son los de Chatito.
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

// Orden de compra capturada en el panel de Octavio. Sin folio que escribir: el folio es OC-n.
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
  listar: () => stmts.listar.all().map(conDatos),
  entradas: () => stmts.entradas.all().map((e) => ({ ...e, renglones: JSON.parse(e.renglones) })),
  entradasEntre: (desde, hasta) => stmts.entradasEntre.all(desde, hasta).map((e) => ({ ...e, renglones: JSON.parse(e.renglones) })),
  porAprobar: () => stmts.porAprobar.get().n,
  porSurtir: () => stmts.porSurtir.get().n,
};
