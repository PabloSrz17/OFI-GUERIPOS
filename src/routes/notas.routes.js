const express = require('express');
const notas = require('../repositories/notas.repo');
const clientes = require('../repositories/clientes.repo');
const bus = require('../events/bus');
const { httpError } = require('../lib/errors');
const { interpretar, datosConEmpaque } = require('../integraciones/sicar/texto');
const { normalizar } = require('../lib/telefono');
const { respaldar } = require('../integraciones/respaldos');

const router = express.Router();
const texto = (v) => (v == null ? '' : String(v).trim());

router.get('/', (req, res) => {
  res.json(notas.listarTablero());
});

router.get('/historial', (req, res) => res.json(notas.historialGeneral()));

// Corcho de Edgar: notas para otro día (no salen en el tablero hasta su fecha).
router.get('/programadas', (req, res) => res.json(notas.listarProgramadas()));

// fecha "AAAA-MM-DD" o null para regresarla a hoy. No avisa al cliente ni toca la hoja.
router.patch('/:id/programar', (req, res) => {
  const nota = notas.programar(Number(req.params.id), req.body?.fecha || null, req.body?.con_fecha === true);
  bus.emit('nota:asignada', nota);
  res.json(nota);
});

// El respaldo va antes de archivar, y si falla el cierre sigue: la pantalla lo avisa.
router.post('/cierre', async (req, res) => {
  const respaldo = await respaldar().catch(() => null);
  const resultado = notas.cerrarJornada();
  bus.emit('jornada:cerrada', resultado);
  res.json({ ...resultado, respaldo });
});

const ETIQUETAS = ['SC', 'SALIDA'];

// Clic en la etiqueta de la tarjeta. No toca el resto de la nota, ni la hoja, ni avisa a nadie.
router.patch('/:id/etiqueta', (req, res) => {
  const etiqueta = req.body?.etiqueta || null;
  if (etiqueta && !ETIQUETAS.includes(etiqueta)) throw httpError(400, 'La etiqueta debe ser SC o SALIDA');
  const nota = notas.ponerEtiqueta(Number(req.params.id), etiqueta);
  bus.emit('nota:asignada', nota);
  res.json(nota);
});

// Orígenes que se pueden capturar a mano (las de Pulpos las trae el robot).
const ORIGENES_MANUALES = ['manual', 'sicar'];

// "HH:MM" de hoy -> "AAAA-MM-DD HH:MM:00" (hora de la venta); null = ahora.
function horaDeHoy(valor) {
  const m = texto(valor).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hoy = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-${p(hoy.getDate())} ${p(m[1])}:${m[2]}:00`;
}

router.post('/', (req, res) => {
  const b = req.body ?? {};
  const nombreCliente = texto(b.cliente);
  const datos = datosConEmpaque({
    origen: ORIGENES_MANUALES.includes(b.origen) ? b.origen : 'manual',
    etiqueta: ETIQUETAS.includes(b.etiqueta) ? b.etiqueta : null,
    folio: texto(b.folio),
    material: texto(b.material),
    cantidad: texto(b.cantidad), // texto libre ("1/2"); SQLite guarda como número lo que lo sea
    unidad: b.unidad == null ? 'm³' : texto(b.unidad),
    detalle: texto(b.detalle) || null,
    total:Number(b.total) > 0 ? Number(b.total) : null,
    direccion: texto(b.direccion),
    zona: texto(b.zona) || null,
    chofer_id: b.chofer_id ? Number(b.chofer_id) : null,
    creado_en: horaDeHoy(b.hora),
    telefono: normalizar(b.telefono),
  });
  if (!datos.folio || !(b.cliente_id || nombreCliente) || !datos.material || !datos.direccion || !datos.cantidad || Number(datos.cantidad) <= 0) {
    throw httpError(400, 'Faltan datos: folio, cliente, material, cantidad y dirección');
  }
  if (texto(b.telefono) && !datos.telefono) throw httpError(400, 'Teléfono inválido: escribe los 10 dígitos, ej. 981 196 5122');
  datos.cliente_id = b.cliente_id
    ? Number(b.cliente_id)
    : clientes.obtenerOCrear({ nombre: nombreCliente, telefono: normalizar(b.telefono) });
  const nota = notas.crear(datos);
  bus.emit('nota:creada', nota);
  res.status(201).json(nota);
});

// Vista previa: interpreta una nota de SICAR escrita en texto, sin guardarla.
router.post('/interpretar', (req, res) => {
  const resultado = interpretar(req.body?.texto);
  if (!resultado.ok) throw httpError(400, resultado.error);
  res.json(resultado.nota);
});

router.patch('/:id/estado', (req, res) => {
  // Salir a ruta avisa al cliente por WhatsApp: se exige confirmación explícita.
  if (req.body?.estado === 'en_ruta' && req.body?.confirmado !== true) {
    throw httpError(428, 'Confirma la salida a ruta antes de enviarla');
  }
  const { nota, anterior } = notas.cambiarEstado(Number(req.params.id), req.body?.estado);
  bus.emit('nota:estado', { nota, anterior, retroceso: false });
  res.json(nota);
});

router.patch('/:id/regresar', (req, res) => {
  const { nota, anterior } = notas.regresar(Number(req.params.id));
  // retroceso: true -> los avisos (WhatsApp, Sheets) no deben dispararse por esto.
  bus.emit('nota:estado', { nota, anterior, retroceso: true });
  res.json(nota);
});

// "No se entregó" desde el Historial. body: { fecha: null (hoy) | "AAAA-MM-DD" }.
// retroceso: no avisa al cliente; la hoja de reparto borra su renglón.
router.post('/:id/devolver', (req, res) => {
  const { nota, anterior } = notas.devolver(Number(req.params.id), req.body?.fecha || null);
  bus.emit('nota:estado', { nota, anterior, retroceso: true });
  res.json(nota);
});

router.get('/:id/renglones', (req, res) => res.json(notas.renglones(Number(req.params.id))));

// Envío parcial: lo que no va en este viaje queda en Saldos Pendientes. Ni avisa al cliente ni toca la hoja.
// saldo: la tarjeta como quedó; null si el viaje se llevó todo y se cerró.
router.post('/:id/parcial', (req, res) => {
  const id = Number(req.params.id);
  const saldo = notas.envioParcial(id, req.body?.enviar, { folio: req.body?.folio, salida: req.body?.salida === true });
  bus.emit('nota:asignada', notas.obtener(id));
  res.json({ saldo });
});

router.post('/:id/reprogramar', (req, res) => {
  const nota = notas.reprogramar(Number(req.params.id));
  bus.emit('nota:asignada', nota);
  res.json(nota);
});

// Desde la confirmación de salida a ruta: vale para esta nota y queda guardado en el cliente.
router.patch('/:id/telefono', (req, res) => {
  const textoTel = texto(req.body?.telefono);
  const telefono = textoTel ? normalizar(textoTel) : null;
  if (textoTel && !telefono) throw httpError(400, 'Teléfono inválido: escribe los 10 dígitos, ej. 981 196 5122');
  const nota = notas.ponerTelefono(Number(req.params.id), telefono);
  clientes.actualizarTelefono(nota.cliente_id, telefono);
  res.json(notas.obtener(nota.id));
});

router.patch('/:id/chofer', (req, res) => {
  const choferId = req.body?.chofer_id ? Number(req.body.chofer_id) : null;
  const nota = notas.asignar(Number(req.params.id), 'chofer', choferId);
  bus.emit('nota:asignada', nota);
  res.json(nota);
});

router.patch('/:id/camion', (req, res) => {
  const camionId = req.body?.camion_id ? Number(req.body.camion_id) : null;
  const nota = notas.asignar(Number(req.params.id), 'camion', camionId);
  bus.emit('nota:asignada', nota);
  res.json(nota);
});

// Corcho de Edgar: soltar la nota en un viaje de un camión (camion_id null = sin unidad).
router.patch('/:id/viaje', (req, res) => {
  const camionId = req.body?.camion_id ? Number(req.body.camion_id) : null;
  const nota = notas.ponerViaje(Number(req.params.id), camionId, Number(req.body?.viaje));
  bus.emit('nota:asignada', nota);
  res.json(nota);
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const anterior = notas.obtener(id);
  const nombre = texto(b.cliente);
  const telefonoTexto = texto(b.telefono);
  const telefono = telefonoTexto ? normalizar(telefonoTexto) : null;
  const datos = datosConEmpaque({
    folio: texto(b.folio),
    cantidad: texto(b.cantidad),
    unidad: texto(b.unidad),
    material: texto(b.material),
    detalle: texto(b.detalle) || null,
    total: Number(b.total) > 0 ? Number(b.total) : null,
    direccion: texto(b.direccion),
    zona: texto(b.zona) || null,
    chofer_id: b.chofer_id ? Number(b.chofer_id) : null,
    camion_id: b.camion_id ? Number(b.camion_id) : null,
    telefono,
  });
  if (!datos.folio || !nombre || !datos.material || !datos.direccion || !datos.cantidad || Number(datos.cantidad) <= 0) {
    throw httpError(400, 'Faltan datos: folio, cliente, cantidad y descripción del primer artículo, y dirección');
  }
  if (telefonoTexto && !telefono) throw httpError(400, 'Teléfono inválido: escribe los 10 dígitos, ej. 981 196 5122');
  // Otro nombre = otro cliente sólo en esta nota; las demás notas del cliente anterior no cambian.
  datos.cliente_id = nombre.toUpperCase() === anterior.cliente.toUpperCase()
    ? anterior.cliente_id
    : clientes.obtenerOCrear({ nombre, telefono });
  const nota = notas.editar(id, datos);
  if ((telefono ?? null) !== (anterior.cliente_telefono || null)) clientes.actualizarTelefono(datos.cliente_id, telefono);
  bus.emit('nota:editada', nota);
  res.json(notas.obtener(id)); // ya con el teléfono nuevo
});

router.delete('/:id', (req, res) => {
  bus.emit('nota:eliminada', notas.eliminar(Number(req.params.id)));
  res.status(204).end();
});

module.exports = router;
