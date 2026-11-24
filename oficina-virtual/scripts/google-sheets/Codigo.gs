/**
 * Oficina Virtual -> "FORMATO DE REPARTO" (Google Sheets).
 * Cada entrega se anota como en la hoja de reparto de siempre:
 *   - una pestaña por mes ("OCTUBRE 26"), con título azul y encabezados CHOFER | NOTA | CLIENTE | MATERIAL
 *   - una franja azul por día con la fecha ("29/10/26")
 *   - un renglón por reparto: chofer, nota, cliente, cemento en la columna D y lo demás desde la E
 *
 * Instalación (una vez): Extensiones -> Apps Script, pegar este archivo, poner el TOKEN (SHEETS_TOKEN
 * del .env), Implementar -> Nueva implementación -> Aplicación web (Ejecutar como: Yo · Acceso:
 * Cualquier persona) y poner la URL en SHEETS_URL del .env. Sin el TOKEN correcto no se escribe nada.
 * Al actualizar este archivo: conservar la línea del TOKEN y usar Implementar -> Gestionar
 * implementaciones -> editar -> Nueva versión, para que la URL no cambie.
 *
 * Una nota cancelada, regresada o editada en la Oficina borra o actualiza su renglón. El renglón se
 * busca por el folio en la columna NOTA, en la pestaña del mes; lo demás de la hoja no se toca.
 */
const VERSION = 2;
const TOKEN = 'PEGA_AQUI_EL_SHEETS_TOKEN';
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const AZUL = '#4472c4';
const COLUMNAS = 14; // A..N: CHOFER, NOTA, CLIENTE y 11 columnas de material
const ENCABEZADOS = 3; // renglones 1-2 título, 3 encabezados

function doGet() {
  return responder({ ok: true, servicio: 'formato de reparto', version: VERSION });
}

function doPost(e) {
  let datos;
  try {
    datos = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: 'datos inválidos' });
  }
  if (datos.token !== TOKEN) return responder({ ok: false, error: 'token incorrecto' });
  if (datos.accion) return cambiarRenglon(datos);
  const r = datos.fila;
  if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) return responder({ ok: false, error: 'fila sin fecha' });

  const candado = LockService.getScriptLock();
  candado.waitLock(20000); // dos entregas al mismo tiempo no se enciman
  try {
    const partes = r.fecha.split('-').map(Number); // [año, mes, día]
    const hoja = hojaDelMes(partes[1], partes[0]);
    const fecha = partes[2] + '/' + partes[1] + '/' + String(partes[0]).slice(2);
    // Si la nota ya está (un reintento tras una falla de internet), no se duplica.
    escribirRenglon(hoja, renglonDeNota(hoja, r.nota) || renglonDelDia(hoja, fecha), r);
  } finally {
    candado.releaseLock();
  }
  return responder({ ok: true });
}

// { accion: 'borrar' | 'actualizar', fecha, nota, nuevo }. Si el renglón ya no está (lo borraron a
// mano), no hay nada que hacer: no se crea otro.
function cambiarRenglon(datos) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) || !datos.nota) return responder({ ok: false, error: 'cambio sin fecha o nota' });
  if (['borrar', 'actualizar'].indexOf(datos.accion) < 0) return responder({ ok: false, error: 'acción desconocida' });
  const candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    const partes = datos.fecha.split('-').map(Number);
    const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MESES[partes[1] - 1] + ' ' + String(partes[0]).slice(2));
    const renglon = hoja && renglonDeNota(hoja, datos.nota);
    if (!renglon) return responder({ ok: true, encontrado: false });
    if (datos.accion === 'borrar') hoja.getRange(renglon, 1, 1, COLUMNAS).clearContent(); // queda libre para la siguiente entrega de ese día
    else escribirRenglon(hoja, renglon, datos.nuevo || {});
  } finally {
    candado.releaseLock();
  }
  return responder({ ok: true, encontrado: true });
}

// El renglón de una nota en la pestaña, o null. Compara el folio completo en la columna NOTA.
function renglonDeNota(hoja, nota) {
  const ultimo = hoja.getLastRow();
  if (!nota || ultimo <= ENCABEZADOS) return null;
  const notas = hoja.getRange(ENCABEZADOS + 1, 2, ultimo - ENCABEZADOS, 1).getDisplayValues();
  for (let i = 0; i < notas.length; i++) {
    if (notas[i][0] === String(nota)) return ENCABEZADOS + 1 + i;
  }
  return null;
}

function escribirRenglon(hoja, renglon, r) {
  const cemento = r.cemento || [];
  const otros = cemento.slice(1).concat(r.otros || []); // un cemento en D; si hay más, van con el resto
  const valores = [r.chofer || '', r.nota || '', r.cliente || '', cemento[0] || ''].concat(otros).slice(0, COLUMNAS);
  while (valores.length < COLUMNAS) valores.push('');

  const rango = hoja.getRange(renglon, 1, 1, COLUMNAS);
  rango.setBackground(null).setFontColor('#000000').setFontWeight('normal');
  hoja.getRange(renglon, 2).setNumberFormat('@'); // la nota tal cual (N925 o 32712)
  rango.setValues([valores]);
}

function hojaDelMes(mes, anio) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const nombre = MESES[mes - 1] + ' ' + String(anio).slice(2);
  let hoja = libro.getSheetByName(nombre);
  if (hoja) return hoja;

  hoja = libro.insertSheet(nombre, 0);
  hoja.getRange(1, 1, hoja.getMaxRows(), COLUMNAS).setFontFamily('Calibri').setFontSize(11);
  hoja.getRange(1, 1, 2, COLUMNAS).merge()
    .setValue('FORMATO REPARTO ' + nombre)
    .setBackground(AZUL).setFontColor('#ffffff').setFontWeight('bold').setFontSize(16)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  const encabezados = ['CHOFER', 'NOTA', 'CLIENTE', 'MATERIAL'];
  while (encabezados.length < COLUMNAS) encabezados.push('');
  hoja.getRange(3, 1, 1, COLUMNAS).setValues([encabezados])
    .setBackground(AZUL).setFontColor('#ffffff').setFontWeight('bold');
  hoja.setFrozenRows(ENCABEZADOS);
  hoja.setColumnWidth(1, 130);
  hoja.setColumnWidth(2, 90);
  hoja.setColumnWidth(3, 200);
  hoja.setColumnWidths(4, COLUMNAS - 3, 115);

  // La pestaña vacía que trae un archivo nuevo ("Hoja 1") ya no hace falta.
  libro.getSheets().forEach(function (h) {
    if (h.getName() !== nombre && /^(Hoja|Sheet) ?1$/.test(h.getName()) && h.getLastRow() === 0) libro.deleteSheet(h);
  });
  return hoja;
}

// Devuelve el renglón donde anotar: el primero vacío bajo la franja del día. Si el día no existe,
// crea su franja al final; si el día está lleno, inserta un renglón antes de la siguiente franja.
function renglonDelDia(hoja, fecha) {
  const ultimo = Math.max(hoja.getLastRow(), ENCABEZADOS);
  const valores = hoja.getRange(1, 1, ultimo, 3).getDisplayValues();
  const esFranja = function (f) { return /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(f[0]) && !f[1] && !f[2]; };
  const vacio = function (f) { return !f[0] && !f[1] && !f[2]; };

  let inicio = -1;
  for (let i = ENCABEZADOS; i < valores.length; i++) {
    if (esFranja(valores[i]) && valores[i][0] === fecha) inicio = i;
  }
  if (inicio < 0) {
    const r = ultimo > ENCABEZADOS ? ultimo + 2 : ENCABEZADOS + 1; // un renglón de separación
    franja(hoja, r, fecha);
    return r + 1;
  }
  for (let i = inicio + 1; i < valores.length; i++) {
    if (esFranja(valores[i])) {
      hoja.insertRowBefore(i + 1);
      return i + 1;
    }
    if (vacio(valores[i])) return i + 1;
  }
  return valores.length + 1;
}

function franja(hoja, renglon, fecha) {
  hoja.getRange(renglon, 1, 1, COLUMNAS).setBackground(AZUL).setFontColor('#ffffff').setFontWeight('bold');
  hoja.getRange(renglon, 1).setNumberFormat('@').setValue(fecha);
}

function responder(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}
