// Respaldo a mano: npm run respaldo
const { respaldar, CARPETA } = require('../src/integraciones/respaldos');

respaldar()
  .then((nombre) => console.log(`Listo: ${CARPETA}\\${nombre}`))
  .catch((err) => {
    console.error(`No se pudo respaldar: ${err.message}`);
    process.exit(1);
  });
