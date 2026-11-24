# Etapa 5: ventas

Fecha: 21/11/2026. Referencias: `reference/pulpos/screenshots/C-*` (punto de venta), `B-*` (historial y detalle) y `J-settings-clients.png`. Decisiones nuevas: D12–D18 en `reference/pulpos/decisions.md`.

Alcance acordado: ventas en paralelo, entrega posterior y quitar impuestos; ticket de 80 mm; un solo método de pago por venta; eliminar venta con confirmación.

## Qué se construyó

| Pieza | Archivo(s) |
|---|---|
| Migración 3: `cash_registers`, `sales`, `sale_items`, `payments`, `cash_movements` (inmutable), `sale_events` | `src/db/migrations.ts` |
| Cálculo del carrito (descuentos, impuestos, cambio, billetes sugeridos, vencimiento) | `src/domain/sale.ts` |
| Repositorio de ventas: registrar, entregar, eliminar, comentar, nota, cliente, historial, CSV y búsqueda del POS | `src/repos/sales.ts` |
| Carritos en paralelo guardados en el equipo (sobreviven a recargar) | `src/pos/cart-store.ts` |
| Punto de venta `/pos` | `src/pages/PosPage.tsx`, `src/components/pos/PosDialogs.tsx` |
| Pantalla de cobro (diseño propio, D17) | `src/components/pos/CheckoutDialog.tsx` |
| Ticket de 80 mm | `src/sales/ticket.ts` |
| Historial `/sales` y detalle `/sales/detail?id=` | `src/pages/sales/SalesListPage.tsx`, `SaleDetailPage.tsx` |
| Preferencias → Tickets y → Clientes | `src/pages/settings/SalesSettingsPages.tsx` |
| Detalle del cliente: Ventas, Total Vendido, Deuda y Últimas Ventas reales | `src/pages/clients/ClientDetailPage.tsx`, `src/repos/clients.ts` |

## Comportamiento

- **Buscar y agregar:**
  - escribe nombre, SKU o código; un código exacto + Enter (lector de códigos) agrega directo;
  - ↑↓ y Enter eligen un resultado; cada resultado muestra su stock;
  - si no hay resultados, "Crear producto" lo da de alta con ese nombre.
- **Carrito:**
  - cantidad editable;
  - menú por renglón: Cambiar Precio (otra lista o precio personalizado), Añadir Descuento ($ o %, con título), Ver Detalles, Editar Producto y Eliminar;
  - Entrada manual (producto sin catálogo) y Añadir nota;
  - Lista de precios de toda la venta. Un cliente con lista asignada cambia los precios al asignarlo.
- **Ventas en paralelo:** "+" abre otra venta en una pestaña. Cada pestaña se llama como su cliente. Cerrar una con productos pide confirmación. Todo sigue ahí al recargar la app.
- **Venta | Pedido** y opciones de la venta:
  - **Quitar Impuestos de la Venta** cobra sin IVA/IEPS (D13);
  - **Posponer Entrega de Productos** y **Pedido** dejan los productos "No Entregados" hasta entregarlos (D14).
- **Cobrar (Ctrl+Enter):**
  - Efectivo con billetes sugeridos y cambio; Tarjeta de Crédito, Tarjeta de Débito o Transferencia; o A Crédito (D12);
  - a crédito exige cliente (se asigna desde el mismo cobro), respeta el límite y, si está activado, bloquea a clientes con deuda vencida (D15);
  - al terminar muestra "Venta N# registrada" con el cambio, Imprimir Ticket y Nueva Venta.
- **Ticket de 80 mm:** se imprime con la impresora predeterminada de Windows. Lleva los datos del negocio de Preferencias → Tickets. Desde el detalle se reimprime con la leyenda "REIMPRESIÓN".
- **Historial:**
  - pestañas Todas, Pagos Pendientes y No Entregadas, con contador;
  - búsqueda por folio, producto o cliente;
  - Filtros: Fecha, Método de Pago, Cliente, Pago, Entrega y Descuentos;
  - Ordenar, y Descargar Ventas (`ventas.csv`).
- **Detalle:**
  - productos con su estado de entrega y "Entregar Productos";
  - totales e Historial, con comentarios y eventos (Venta Registrada, Cobro, Asignación de Crédito, Entrega o Apartado);
  - Estado: Total, Abonado, Adeudado, Método, Recibido, Cambio y vencimiento;
  - Fecha, Caja, Cajero, Cliente (asignar o quitar) y Nota;
  - Más Acciones → Eliminar (D16).
- **Preferencias → Clientes:**
  - Crédito Predeterminado: Sin limitar, o un monto fijo;
  - "Restringir vender a crédito a clientes con deuda vencida";
  - Plazo de Crédito, en días (diseño propio).

## Reglas que se garantizan (con prueba)

- **La venta es atómica.** Encabezado, renglones, pago, movimiento de inventario, movimiento de caja, eventos y outbox se guardan en una sola transacción. Si algo falla (por ejemplo, el crédito excede el límite), no se guarda nada.
- **No se duplica.** El carrito tiene su propio UUID y ese es el id de la venta. Un doble clic o un reintento devuelve la misma venta.
- **Totales confiables.** El repositorio recalcula los totales; no confía en lo que manda la pantalla.
- **El stock solo cambia con un movimiento:**
  - "Entrega de Venta #N" al entregar;
  - "Eliminación de Venta #N" al eliminar.
- **Stock negativo permitido (D3).**
- **El dinero solo cambia con un movimiento de caja.** Los movimientos de caja no se pueden borrar ni modificar; eliminar una venta agrega movimientos negativos.
- **Nada se borra.** La venta eliminada queda en la base, marcada, con su historial.

## Comparación con Pulpos

| Pantalla | Referencia | Esta app (`screenshots/`) | Diferencias |
|---|---|---|---|
| Resultados de búsqueda | `C-pos-search-results.png` | `C-pos-search-results.png` | Igual estructura; se agregó el atajo "Tab Ir al carrito". |
| Carrito con producto | `C-pos-cart-1-item.png` | `C-pos-cart-1-item.png` | Sin Vendedor ni Promoción (D18). |
| Menú del renglón | `C-pos-line-menu.png` | `C-pos-line-menu.png` | Mismas acciones y atajos. |
| Descuento | `C-pos-line-discount.png` | `C-pos-line-discount.png` | Igual. |
| Cambiar precio | `C-pos-line-price.png` | `C-pos-line-price.png` | Igual. |
| Entrada manual / Nota | `C-pos-manual-entry.png`, `C-pos-add-note.png` | ídem | Igual. |
| Añadir cliente | `C-pos-add-client.png` | `C-pos-add-client.png` | Igual. |
| Opciones de la venta | `C-pos-cart-menu.png` | `C-pos-cart-menu.png` | Solo Quitar Impuestos y Posponer Entrega. |
| Modo Pedido | `C-pos-mode-pedido.png` | `C-pos-mode-pedido.png` | Igual. |
| Cobro, crédito, venta registrada | — (no autorizado) | `P-checkout-cash.png`, `P-checkout-credit.png`, `P-checkout-success.png` | Diseño propio (D17). |
| Ventas en paralelo | — | `P-parallel-sales.png` | Diseño propio: no se observó en Pulpos. |
| Ticket | — | `P-ticket-80mm.png` | Diseño propio. |
| Historial | `B-sales-list.png` | `B-sales-list.png` | Sin casillas de selección ni Vendedor. "Método" en lugar de "Canal". "Nueva Venta" en lugar del menú "Crear" (solo tendría una opción). |
| Filtros | `B-sales-filter.png` | `B-sales-filter.png` | Sin Numeración, Caja, Cajero, Producto, Factura ni Canal. |
| Detalle con deuda | `B-sale-detail-debt.png` | `B-sale-detail-debt.png` | Sin Registrar Cobro y Enviar Recordatorio (Etapa 7 / fuera), Factura, Canal, Vendedor, Forma de Entrega ni editar el vencimiento. Se agregó la fila Método. |
| Detalle pagado | `B-sale-detail.png` | `B-sale-detail.png` | Igual estructura. |
| Más Acciones | `B-sale-more-actions.png` | `B-sale-more-actions.png` | Solo Eliminar. |
| Preferencias → Clientes | `J-settings-clients.png` | `J-settings-clients.png` | Sin candados de plan ni Portal de Clientes. Se agregó "Plazo de Crédito". |
| Preferencias → Tickets | — (no se inspeccionó) | `J-settings-tickets.png` | Diseño propio. |

### Ajustes hechos tras comparar

- En el detalle, las pills de Estado y Entrega son más grandes, con esquinas poco redondeadas e ícono, como en Pulpos. "Imprimir Ticket" pasa a botón secundario.
- Modal Filtros: 523 px de ancho; cada selector va en su propia tarjeta y la etiqueta ya no se parte en dos líneas.
- Más Acciones: la opción se llama "Eliminar" con ícono rojo, y el menú se abre alineado al botón.

## Pendiente por diseño

- **Etapa 6 (Caja):** pantalla de caja, ingresos, retiros y corte. Los movimientos de caja de cada venta ya se están guardando.
- **Etapa 7 (Cobranza):** Registrar Cobro, abonos y Estado de Cuenta. La función para registrar un pago ya existe.
- **Etapa 8 (Reportes):** el Inicio (dashboard) sigue mostrando los datos de ejemplo de la Etapa 2.
- **D9:** entradas de mercancía, por definir.

## Cómo verlo

```
npm run dev   →  http://localhost:1420/#/pos
```

En la consola de desarrollo, `__posDev.seedDemo()` carga 27 productos y `__posDev.seedClients()` carga 10 clientes ficticios. Solo existen en modo desarrollo; se verificó que no quedan en la versión final.

## Pruebas

- **Vitest, 66/66.** Incluye 21 pruebas nuevas de ventas:
  - cálculo del carrito, descuentos, quitar impuestos, cambio y billetes;
  - registro completo con pago, inventario, caja, eventos y outbox;
  - idempotencia y deshacer todo si algo falla;
  - crédito: cliente obligatorio, límite y bloqueo por deuda vencida;
  - entrega posterior y pedido;
  - eliminación (stock, pagos y caja);
  - historial, filtros y CSV;
  - búsqueda del POS por código;
  - textos de vencimiento.
- **Playwright, 36/36.** Incluye 11 pruebas nuevas:
  - `e2e/pos.spec.ts` (8):
    - venta en efectivo con descuento y ticket;
    - doble clic = una venta;
    - crédito con cliente asignado desde el cobro;
    - límite de crédito;
    - precios, entrada manual, nota y quitar impuestos;
    - pestañas en paralelo al recargar;
    - pedido y entrega posterior;
    - lector de códigos.
  - `e2e/sales.spec.ts` (3):
    - historial: pestañas, búsqueda, filtros y CSV;
    - detalle: entregar, comentar, cliente, nota, reimprimir y eliminar, verificando stock y caja en la base;
    - preferencias de crédito y ticket.
- **`npm run build`:** OK.
