# OFI-GUERIPOS

Oficina Virtual y Punto de Venta de Materiales El Güero, en un solo repositorio.

- `oficina-virtual/`: Oficina Virtual (Express, puerto 3000): tablero de reparto, agentes, WhatsApp, SICAR, Pulpos, sincronización Principal-Mostrador. Monta el Punto de Venta en `/pos/`.
- `punto-de-venta/`: Punto de Venta (React, TypeScript, Vite, sql.js). `npm run build:oficina` lo arma dentro de `oficina-virtual/pos/`.

Cada carpeta conserva su historial. Las claves (`.env`), las sesiones y los datos (`data/`) no se suben.
