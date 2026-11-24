// 💬 WhatsApp de Chatito. En esta PC (el servidor) el botón trae al frente su ventana de WhatsApp Web;
// en las otras PCs abre su propio WhatsApp Web. Con teléfono (desde una cotización) va directo a ese chat.
import { api } from './api.js';

export function montarWhatsapp({ toast }) {
  let estaPC = null;
  async function abrir(telefono) {
    if (estaPC === null) {
      try { estaPC = (await api.get('/api/whatsapp')).estaPC; } catch { estaPC = false; }
    }
    if (!estaPC) {
      const d = String(telefono ?? '').replace(/\D/g, '');
      window.open(d.length >= 10 ? `https://web.whatsapp.com/send?phone=${d}` : 'https://web.whatsapp.com/', '_blank', 'noopener');
      return;
    }
    try {
      await api.post('/api/whatsapp/ventana', telefono ? { telefono } : {});
    } catch (err) {
      toast(err.message, true);
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-abrir-whatsapp]');
    if (b) abrir(b.dataset.telefono);
  });
}
