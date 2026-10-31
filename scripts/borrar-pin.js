// PIN olvidado: npm run pin:borrar. Cierra todas las sesiones; la Oficina pide crear uno nuevo en esta PC.
const { borrarPin } = require('../src/lib/pin');

borrarPin();
console.log('PIN borrado. Abre http://localhost:3000 en esta PC para crear uno nuevo.');
