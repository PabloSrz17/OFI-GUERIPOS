# Etapa 6: caja y cortes

Fecha: 23/11/2026. Referencias: `reference/pulpos/cash.md` y las capturas `G-cash-*` y `H-cash-*`. Decisiones nuevas: D19–D22 en `reference/pulpos/decisions.md`.

Alcance acordado:
- en el corte se cuentan todos los métodos;
- no se deja fondo (cada corte retira todo el efectivo);
- se pueden eliminar ingresos y retiros, con confirmación;
- el corte se imprime en 80 mm.

## Qué se construyó

| Pieza | Archivo(s) |
|---|---|
| Migración 4: tablas `cash_cuts` y `cash_cut_lines`; `cash_movements` admite anulaciones y protege lo ya cortado | `src/db/migrations.ts` |
| Repositorio de caja: esperado por método, ingresos, retiros, anulación, corte, historial y CSV | `src/repos/cash.ts` |
| Caja `/cash` | `src/pages/cash/CashPage.tsx` |
| Hacer Corte de Caja `/cash/cut` (diseño propio, D21) | `src/pages/cash/CutPage.tsx` |
| Cortes Históricos `/cash/history` | `src/pages/cash/CutsHistoryPage.tsx` |
| Detalle de corte `/cash/history/detail?id=` | `src/pages/cash/CutDetailPage.tsx` |
| Ingresar o retirar efectivo, desglose del esperado, lista de movimientos | `src/components/cash/CashDialogs.tsx` |
| Ticket de corte de 80 mm | `src/cash/cut-ticket.ts` |

## Comportamiento

- **Caja:**
  - Muestra el Total Esperado por método: Efectivo, Tarjeta de Crédito, Tarjeta de Débito, Transferencia y Total.
  - Cada monto abre su desglose:
    - **Resumen:** al inicio, ventas, cobros de crédito, ingresos, retiros y ventas eliminadas;
    - **Detalle de Movimientos:** cada movimiento, con enlace a su venta.
  - Las ventas a crédito no suman a la caja; entran hasta que se cobren (Etapa 7).
- **Ingresar Efectivo / Retirar Efectivo:**
  - Piden un monto y un motivo opcional, y muestran "Realizado por".
  - Confirmar se habilita solo con un monto.
  - Si un retiro es mayor que el efectivo esperado, se avisa pero se permite.
- **Eliminar un ingreso o retiro:**
  - Pide confirmación y solo se puede antes del corte.
  - Se agrega un movimiento que lo anula; no se borra nada (D20).
- **Hacer Corte de Caja:**
  - Capturas el efectivo contado. Tarjetas y transferencia vienen llenas con lo esperado y solo las corriges si no cuadran.
  - Cada método muestra "Sin diferencia", "Faltan $X" o "Sobran $X", y también el total.
  - Puedes añadir comentarios.
  - El lado derecho muestra Al inicio, Retiro por corte (todo el efectivo contado) y Restante en caja ($0).
  - **Confirmar Corte** pide confirmación, guarda el corte, abre su detalle e imprime el ticket.
  - La caja vuelve a empezar en $0.
- **Cortes Históricos:**
  - Tabla: Fecha, Caja, Realizado por, Total Esperado, Diferencia y Comentarios.
  - Búsqueda por caja, vendedor o comentario.
  - Filtros por fecha y por diferencia; orden por fecha.
  - Exportar descarga `cortes-de-caja.csv`.
- **Detalle de corte:**
  - Tabla con Recuento Manual, Total Esperado (abre el desglose de ese corte) y Diferencia por método.
  - Los ingresos y retiros del periodo.
  - Información (caja, fecha, número de corte), Efectivo y Comentarios.
  - **Ver Movimientos** lista todos los movimientos del corte; **Imprimir Ticket** lo reimprime.

## Reglas que se garantizan (con prueba)

- **El corte es atómico.** Recalcula lo esperado dentro de la transacción (no confía en la pantalla), guarda el recuento por método y cierra el periodo marcando sus movimientos. Si algo falla, no se guarda nada.
- **No se duplica.** El corte y cada ingreso o retiro llevan un id generado al abrir la pantalla, así que un doble clic registra una sola vez.
- **Lo cortado no cambia.** La base rechaza modificar o eliminar un corte, y cambiar de corte un movimiento.
- **Los movimientos de caja nunca se borran.** Eliminar un ingreso o retiro agrega una anulación.
- **Eliminar una venta de un corte ya cerrado** descuenta el dinero en el periodo actual, porque sale de la caja hoy.
- **No hay cortes vacíos.** Un corte sin movimientos se rechaza.
- **Las bases de la Etapa 5 se actualizan sin perder datos.** Hay una prueba que lo verifica.

## Comparación con Pulpos

| Pantalla | Referencia | Esta app (`screenshots/`) | Diferencias |
|---|---|---|---|
| Caja actual | `G-cash-current.png` | `G-cash-current.png` | Igual estructura. "Vendedor" muestra el usuario ("Administrador"). |
| Desglose del esperado | `G-cash-expected-breakdown.png` | `G-cash-expected-breakdown.png` | "Ventas Eliminadas" en lugar de Devoluciones. Sin Compras y Gastos. Montos con centavos (D22). |
| Ingresar Efectivo | `G-cash-in-modal.png` | `G-cash-in-modal.png` | Igual. |
| Retirar Efectivo | `G-cash-out-modal.png` | `G-cash-out-modal.png` | Igual, más un aviso si el retiro supera el efectivo esperado. |
| Hacer Corte de Caja | — (no autorizado) | `P-cash-cut-form.png` | Diseño propio (D21). |
| Cortes Históricos | `H-cash-history.png` | `H-cash-history.png` | Sin casillas de selección. La diferencia dice "Faltan $X" o "Sobran $X". |
| Detalle de corte | `H-cash-cut-detail.png` | `H-cash-cut-detail.png` | Sin "Más Acciones". Se agregaron el número de corte y la tarjeta de Comentarios. |
| Preferencias → Cajas Registradoras | `H-settings-cashiers.png` | — | No se construyó: hay una sola caja, "Caja Principal". |

### Ajustes hechos tras comparar

- En Caja, el subtítulo se parte en dos líneas y los botones quedan a la derecha del título, a la misma altura que en Pulpos.
- El modal de Filtros del historial usa el mismo formato que el de Ventas: 523 px, con cada grupo en su propia tarjeta.

## Pendiente por diseño

- **Etapa 7 (Cobranza):** Registrar Cobro. Los cobros de crédito ya tienen su renglón en el desglose de la caja ("Cobros de Crédito").
- **Etapa 8 (Reportes):** Movimientos de Dinero, que usa los mismos movimientos de caja. El Inicio sigue con datos de ejemplo.
- **Varias cajas:** fuera del alcance. La base ya guarda la caja de cada movimiento, por si se necesita después.

## Pruebas

- **Vitest, 77/77.** Incluye 9 pruebas nuevas en `src/repos/cash.test.ts`:
  - esperado por método con ventas, tarjeta, transferencia, crédito, ingresos, retiros y ventas eliminadas;
  - validación e idempotencia de ingresos y retiros;
  - anulación sin borrar;
  - la base rechaza borrar o modificar movimientos y cortes;
  - corte con faltante, retiro total y periodo nuevo;
  - corte idempotente, sin cortes vacíos y deshecho completo si falla;
  - venta eliminada después del corte;
  - historial, filtros y CSV;
  - actualización de una base de la Etapa 5.
- **Playwright, 38/38.** Incluye 2 pruebas nuevas en `e2e/cash.spec.ts`:
  - caja con ventas en tres métodos, ingreso, retiros, desglose y eliminar un retiro;
  - corte con faltante, confirmación (doble clic = un corte), ticket, Ver Movimientos, caja en cero, segundo corte, historial, filtro y búsqueda.
- **`npm run build`:** OK, y las herramientas de desarrollo no quedan en la versión final.
