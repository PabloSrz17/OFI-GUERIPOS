# Etapa 7: cobranza

Fecha: 23/11/2026. Referencias: `reference/pulpos/clients.md` y las capturas `J-client-detail.png`, `J-client-statement.png` y `J-clients-filter.png`. Decisiones nuevas: D23–D26 en `reference/pulpos/decisions.md`.

Alcance acordado:
- se cobra desde el cliente y desde la venta;
- se admiten abonos parciales;
- un cobro se puede cancelar, con confirmación;
- extra elegido: ticket de cobro de 80 mm.

## Qué se construyó

| Pieza | Archivo(s) |
|---|---|
| Migración 5: tabla `collections`, `payments.collection_id` y el movimiento de caja `collection_void` | `src/db/migrations.ts` |
| Repositorio de cobranza: deuda por antigüedad, reparto, cobrar, cancelar, últimos cobros | `src/repos/collections.ts` |
| Registrar Cobro, Estado de Cuenta y Últimos Cobros | `src/components/collections/CollectionDialogs.tsx` |
| Ticket de cobro de 80 mm | `src/collections/collection-ticket.ts` |
| Detalle del cliente: franja de deuda vencida, Detalle de Deuda, Últimos Cobros, Ver Estado de Cuenta | `src/pages/clients/ClientDetailPage.tsx` |
| Detalle de venta: botón Registrar Cobro y eventos de cobro | `src/pages/sales/SaleDetailPage.tsx` |
| Lista de clientes: filtro Estado de Deuda | `src/repos/clients.ts`, `src/pages/clients/ClientsListPage.tsx` |

## Comportamiento

- **Detalle del cliente:**
  - Con deuda vencida, una franja amarilla en el resumen: "El cliente tiene una deuda vencida de $X".
  - **Detalle de Deuda** (solo si hay deuda): total, Vencida (en rojo), A cobrar en 0 a 7 días, A cobrar en +7 días y el botón **Registrar Cobro**.
  - **Últimos Cobros** (solo si hay cobros): folio, ventas cobradas (con enlace), monto, fecha y método. El menú ⋯ tiene Imprimir Ticket y Cancelar Cobro.
  - **Ver Estado de Cuenta**: nombre, Ventas con Deuda, Deuda Pendiente y cada venta con su vencimiento y "$X adeudados". Desde ahí también se puede registrar un cobro.
- **Registrar Cobro** (diseño propio, D23):
  - El monto empieza con toda la deuda. Si es menor, se avisa que es un abono parcial. Si es mayor que la deuda, no deja cobrar.
  - Métodos: Efectivo, Tarjeta de Crédito, Tarjeta de Débito y Transferencia. En efectivo se puede capturar lo recibido y muestra el cambio.
  - "Se aplica a" muestra cómo se reparte: desde el cliente, de la venta que vence primero a la última; desde una venta, solo a ella. Cada venta dice "Liquidada" o "Resta $X".
  - Al cobrar: "Cobro #N registrado", el cambio en grande e **Imprimir Ticket**.
- **En la caja:** cada cobro suma a su método en "Cobros de Crédito", y el movimiento dice "Cobro de Deuda en Venta N#". La venta registra el evento "Cobro de $X en Método".
- **Cancelar Cobro** (D24): pide confirmación y solo se puede antes del corte. La deuda vuelve a las ventas y el dinero sale de la caja. El cobro queda en el historial como "Cancelado".
- **Filtro Estado de Deuda** (Clientes → Filtrar): Sin deuda, Deuda Vencida y Deuda no Vencida. Se combina con Lista de Precio.

## Reglas que se garantizan (con prueba)

- **El cobro es atómico.** El cobro, los pagos por venta, los movimientos de caja, los eventos y el outbox se guardan juntos, o no se guarda nada.
- **No se duplica.** El id se genera al abrir el modal, así que un doble clic cobra una sola vez.
- **No se cobra de más.** El monto debe ser mayor a $0 y no mayor que la deuda. En efectivo, lo recibido debe alcanzar.
- **El reparto es predecible.** Primero se cobra la venta que vence antes.
- **Cancelar no borra nada.** Los pagos se marcan como revertidos y la caja recibe movimientos negativos.
- **Lo cortado no se cancela.** Tampoco un cobro de una venta que ya se eliminó.
- **Las bases de la Etapa 6 se actualizan sin perder datos.** Las pruebas de migración de las Etapas 3 y 5 siguen pasando con la versión 5.

## Comparación con Pulpos

| Pantalla | Referencia | Esta app (`screenshots/`) | Diferencias |
|---|---|---|---|
| Detalle del cliente con deuda | `J-client-detail.png` | `J-client-detail-debt.png` | Igual estructura. Sin "Enviar Recordatorio", "Ver Portal del Cliente", Datos de Facturación ni Monedero (fuera del alcance). La pill dice "Por cobrar" cuando nada está vencido (propio). |
| Últimos Cobros | `J-client-detail.png` | `J-client-detail-collections.png` | Sin "Facturar" ni la pill "No Facturado". El ⋯ tiene Imprimir Ticket y Cancelar Cobro. Un cobro puede abarcar varias ventas. |
| Estado de Cuenta | `J-client-statement.png` | `J-client-statement.png` | Sin Compartir ni Imprimir (no se eligieron). Se agregó Registrar Cobro. |
| Filtros de clientes | `J-clients-filter.png` | `J-clients-filter.png` | Estado de Deuda es una lista desplegable (como Lista de Precio). Sin Saldo en Monedero. |
| Registrar Cobro | — (no se abrió) | `P-collect-dialog.png`, `P-collect-success.png` | Diseño propio (D23). |
| Ticket de cobro | — | `P-collection-ticket-80mm.png` | Diseño propio (D25). |

## Pendiente por diseño

- **Etapa 8 (Reportes):** Movimientos de Dinero (incluye los cobros) y los reportes de ventas e inventario.
- **No incluido:** Enviar Recordatorio por WhatsApp, imprimir o compartir el Estado de Cuenta, Facturar.

## Pruebas

- **Vitest, 84/84.** Incluye 7 pruebas nuevas en `src/repos/collections.test.ts`:
  - antigüedad de la deuda (vencida, 0 a 7 días, +7 días);
  - reparto de la más antigua a la más nueva, abono parcial, cambio, idempotencia, eventos y outbox;
  - cobro desde una venta;
  - validaciones de monto, efectivo y deuda;
  - cancelar sin borrar, con deuda y caja de vuelta;
  - no se cancela después del corte ni si la venta se eliminó;
  - filtro Estado de Deuda.
- **Playwright, 39/39.** Incluye 1 prueba nueva en `e2e/collections.spec.ts`: deuda vencida (con reloj simulado), Detalle de Deuda, cobro parcial con cambio, doble clic, ticket, Últimos Cobros, Estado de Cuenta, la caja con el cobro, cancelar con confirmación, cobro desde la venta por transferencia y el filtro.
- **`npm run build`:** OK.
