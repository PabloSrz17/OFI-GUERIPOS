// Descarga de fotos recibidas. mensaje.downloadMedia() de whatsapp-web.js 1.34.7 no sirve: busca el
// mensaje con id._serialized, que llega vacío (error "r"), y pide el archivo sin decir su tipo (WhatsApp
// Web lo rechaza). Aquí se hace dentro de la página sin esos dos fallos; no se modifica la librería.
async function bajarEnPagina(clave) {
  const { Msg } = window.require('WAWebCollections');
  const msg = Msg.getModelsArray().find((m) => m.id.id === clave);
  if (!msg) return null;
  const qpl = { addAnnotations() { return this; }, addPoint() { return this; } };
  const archivo = await window.require('WAWebDownloadManager').downloadManager.downloadAndMaybeDecrypt({
    directPath: msg.directPath,
    encFilehash: msg.encFilehash,
    filehash: msg.filehash,
    mediaKey: msg.mediaKey,
    mediaKeyTimestamp: msg.mediaKeyTimestamp,
    mimetype: msg.mimetype,
    type: msg.type,
    signal: new AbortController().signal,
    downloadQpl: qpl,
  });
  return { mimetype: msg.mimetype, data: await window.WWebJS.arrayBufferToBase64Async(archivo) };
}

const bajarImagen = (mensaje) => mensaje.client.pupPage.evaluate(bajarEnPagina, mensaje.id.id);

module.exports = { bajarImagen };
