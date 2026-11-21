// 💰 El cliente avisa por WhatsApp que ya pagó o que confirma: su cotización abierta más reciente cambia sola.
//   "ya pagué", "ya deposité", "ya te hice la transferencia", "comprobante" -> Pagada (cuenta como venta)
//   "confirmo", "procede", "de acuerdo", "va"                             -> ✅ Confirmó (sigue en espera)
//   foto sin texto claro                                                   -> 🧾 Comprobante por revisar
// Con duda o negación ("aún no", "¿cuánto?", "voy a pagar", "?") no se toca nada.
// "transferencia" o "spei" solos no cuentan: así contestan "¿cómo le gustaría pagar?" (no es un pago).
const db = require('../../db/connection');
const bus = require('../../events/bus');

const DIAS_ABIERTA = 15; // cotizaciones más viejas no se tocan

const limpiar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const DUDA = /\?|\b(aun no|todavia no|no puedo|no he|no se|no tengo|no me|cuanto|cuando|voy a|vamos a|te pago|le pago|pago con|puedo pagar|pagaria|aceptan|se puede|mas tarde|al rato|manana|luego|ahorita|ahora (te|le|les)|despues|en un rato|(te|le|les) (confirmo|aviso|digo)|lo (checo|veo|pienso)|dej(a|ame|eme))\b/;
const PAGO = [
  /\bya (te |le |les )?(pague|deposite|transferi|liquide|abone)\b/,
  /\bya (te |le |les )?(hice|mande|envie|realice) (el |la |un |una )?(pago|deposito|transferencia|spei|comprobante)\b/,
  /\b(pago|deposito|transferencia|spei) (hech[oa]|realizad[oa]|enviad[oa]|list[oa])\b/,
  /\bpagad[oa]\b/,
  /\bcomprobante\b/,
  /\bya quedo\b/,
];
const CONFIRMA = [/\b(confirmad[oa]|confirmo|procede|de acuerdo|adelante|me l[oa]s? llevo)\b/, /^(si |ok |sale |orale )?(va|sale|va pues|vale)$/];

// 'pagado' | 'confirmado' | 'comprobante' | null
function intencion(texto, esFoto = false) {
  const t = limpiar(texto);
  if (t && DUDA.test(t)) return null;
  if (PAGO.some((re) => re.test(t))) return 'pagado';
  if (CONFIRMA.some((re) => re.test(t))) return 'confirmado';
  if (esFoto) return 'comprobante';
  return null;
}

const stmts = {
  abierta: db.prepare(`
    SELECT co.id FROM cotizaciones co JOIN clientes cl ON cl.id = co.cliente_id
    WHERE cl.telefono = ? AND co.estado = 'aprobada' AND co.creado_en >= datetime('now', 'localtime', '-${DIAS_ABIERTA} days')
    ORDER BY co.id DESC LIMIT 1`),
  pagada: db.prepare(`
    UPDATE cotizaciones SET estado = 'pagada', pagada_en = datetime('now', 'localtime'),
      seguimiento_estado = CASE WHEN seguimiento_estado = 'pendiente' THEN 'cancelado' ELSE seguimiento_estado END,
      aviso_cliente = 'pagado', aviso_en = datetime('now', 'localtime'), aviso_texto = @texto
    WHERE id = @id AND estado = 'aprobada'`),
  // Confirmó o mandó comprobante: no es venta todavía, pero ya no se le manda el recordatorio de 24 h.
  aviso: db.prepare(`
    UPDATE cotizaciones SET aviso_cliente = @aviso, aviso_en = datetime('now', 'localtime'), aviso_texto = @texto,
      seguimiento_estado = CASE WHEN seguimiento_estado = 'pendiente' THEN 'cancelado' ELSE seguimiento_estado END
    WHERE id = @id AND estado = 'aprobada'`),
};

// Devuelve { id, aviso } si cambió una cotización; null si el mensaje no era de eso o no hay cotización abierta.
function revisar({ telefono, texto, esFoto }) {
  if (!telefono) return null;
  const aviso = intencion(texto, esFoto);
  if (!aviso) return null;
  const cot = stmts.abierta.get(telefono);
  if (!cot) return null;
  const extracto = (String(texto ?? '').trim() || '📷 Foto').slice(0, 200);
  const cambio = aviso === 'pagado' ? stmts.pagada.run({ id: cot.id, texto: extracto }) : stmts.aviso.run({ id: cot.id, aviso, texto: extracto });
  if (!cambio.changes) return null;
  const folio = `C-${String(cot.id).padStart(4, '0')}`;
  console.log(`[inspector] ${folio}: el cliente avisó "${aviso}" por WhatsApp`);
  bus.emit('solicitud:nueva'); // la Oficina refresca el historial de cotizaciones
  return { id: cot.id, aviso };
}

module.exports = { intencion, revisar };
