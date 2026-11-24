# Etapa 8: reportes

Fecha: 23/11/2026. Referencias: `reference/pulpos/reports.md` y las capturas `I-reports-index*.png`, `I-report-sales-by-period.png`, `I-report-payment-methods.png` e `I-report-money-movements.png`. Decisiones nuevas: D27–D29 en `reference/pulpos/decisions.md`.

Alcance acordado:
- **Ventas:** por periodo (con Facturación y Margen), Productos más Vendidos y con más Margen, por Método de Pago y por Cliente;
- **Finanzas:** Movimientos de Dinero y Cuentas por Cobrar;
- **Inventario:** Stock de Productos y Valor del Inventario;
- el Inicio sigue con datos de ejemplo, para después.

## Qué se construyó

| Pieza | Archivo(s) |
|---|---|
| Periodos (presets, fecha personalizada, cubetas por día o mes) | `src/reports/period.ts` |
| Consultas de los reportes y sus CSV | `src/repos/reports.ts` |
| Controles comunes, esqueleto de reporte, tarjetas de vista previa y barras | `src/components/reports/ReportKit.tsx` |
| Índice `/reports` | `src/pages/reports/ReportsIndexPage.tsx` |
| Ventas `/reports/sales`, `/reports/products`, `/reports/payment-methods`, `/reports/clients` | `src/pages/reports/SalesReportPages.tsx` |
| Finanzas e inventario `/reports/receivables`, `/reports/transactions`, `/reports/stock`, `/reports/inventory` | `src/pages/reports/OtherReportPages.tsx` |
| Gráfico de área: las etiquetas del eje se espacian solas para no encimarse | `src/components/charts/area-chart.tsx` |

## Comportamiento

- **Controles:**
  - Periodo: Hoy, Ayer, Últimos 7 días (por defecto), Últimos 30 días, Últimos 90 días, Mes actual, Mes pasado y Fecha Personalizada (desde / hasta).
  - Por Día / Por Mes en el índice y en el Reporte de Ventas.
  - "Agrupado por Fecha / Producto / Método de Pago / Cliente" cambia de reporte de ventas sin perder el periodo.
  - El periodo queda en la dirección, así que al regresar al índice se conserva.
  - Cada reporte tiene **Descargar Reporte**, que descarga un CSV.
- **Índice:** tarjetas Ventas, Facturación y Margen con su gráfico; Productos más Vendidos, con más Margen y Ventas por Cliente (los 4 primeros); barras por método de pago; Cuentas por Cobrar; últimos Movimientos de Dinero; Stock (con stock, bajo, sin stock) y Valor del Inventario. Cada tarjeta tiene "Ver reporte".
- **Reporte de Ventas:**
  - Métrica del gráfico a elegir: Ventas, Facturación o Margen.
  - Tabla: Fecha, Ventas, Ventas Totales, Costo Total y Margen. La primera fila es **Total**, y después cada día o mes del más reciente al más antiguo, aunque no tenga ventas.
- **Productos:** Cantidad, Ventas, Facturación, Costo y Margen. Se ordena por facturación, margen o unidades; el margen negativo sale en rojo.
- **Método de Pago:** barras con el monto y el porcentaje, más la tabla con Total.
- **Cliente:** Ventas, Total, Margen y Deuda Pendiente de hoy. Las ventas sin cliente se agrupan en "Público en General".
- **Cuentas por Cobrar** (diseño propio, D28): Total por Cobrar, Vencido, 0 a 7, 8 a 30 y +30 días, por cliente. Los vencidos van primero.
- **Movimientos de Dinero:**
  - El libro de caja: ventas pagadas, cobros, ingresos, retiros y anulaciones.
  - Cifras: Movimientos, Entradas, Salidas y Neto.
  - Filtros Todos / Entradas / Salidas y búsqueda por movimiento, folio o usuario.
  - Cada venta tiene su enlace. Las ventas a crédito no aparecen hasta que se cobran.
- **Stock de Productos:** Todos / Con stock / Bajo stock / Sin stock con su conteo, y búsqueda. Columnas: Stock, Stock Mínimo, Estado, Costo y Precio.
- **Valor del Inventario:** Valor, Costo y Margen totales, y por categoría. Solo cuenta el stock positivo (D29).

## Reglas que se garantizan (con prueba)

- Las ventas eliminadas y las que están fuera del periodo no cuentan.
- Los días del periodo se calculan en hora local; los días sin ventas aparecen con 0.
- El costo usa el costo guardado en la venta, no el actual del producto.
- Un reporte lee la base en una sola transacción, así que los totales y las filas siempre cuadran.
- En Movimientos de Dinero, el neto del periodo es la suma de entradas y salidas.

## Comparación con Pulpos

| Pantalla | Referencia | Esta app (`screenshots/`) | Diferencias |
|---|---|---|---|
| Índice de reportes | `I-reports-index*.png` | `I-reports-index.png`, `I-reports-index-bottom.png` | Solo los reportes acordados. Sin Compras y Gastos ni los de Plan Pro, excepto Cuentas por Cobrar. Método de Pago ocupa todo el ancho. |
| Reporte de Ventas | `I-report-sales-by-period.png` | `I-report-sales-by-period.png` | Sin Reembolsos ni Ventas Netas (no hay devoluciones). Se agregó el selector de métrica. Sin Filtrar. |
| Ventas por Método de Pago | `I-report-payment-methods.png` | `I-report-payment-methods.png` | Barras horizontales con porcentaje. |
| Productos más Vendidos | — | `I-report-products.png` | Las columnas son propias: en Pulpos no se capturó el detalle. |
| Ventas por Cliente | — | `I-report-clients.png` | Diseño propio. |
| Movimientos de Dinero | `I-report-money-movements.png` | `I-report-money-movements.png` | Se agregaron las cifras de Entradas, Salidas y Neto. Sin Sucursal (hay una sola) ni Filtrar. "Caja Principal" en vez de "Principal". |
| Cuentas por Cobrar | Plan Pro (solo la vista previa) | `I-report-receivables.png` | Diseño propio (D28). |
| Stock de Productos | — | `I-report-stock.png` | Diseño propio. |
| Valor del Inventario | Vista previa del índice | `I-report-inventory.png` | Desglose por categoría. Sin stock negativo (D29). |

## Pendiente por diseño

- **El Inicio** sigue con datos de ejemplo (lo pediste para después).
- **Etapa 9:** respaldo local, pruebas integrales y empaquetado de Windows (necesita Rust).
- **No incluido (D27):** Ventas por Categoría, Listado y Detalle de Ventas, Cajero y Vendedor, Entradas y Salidas, Productos por Reponer, Apartados, Compras y Gastos.

## Pruebas

- **Vitest, 92/92.** Incluye 8 pruebas nuevas en `src/repos/reports.test.ts`:
  - periodos en hora local, cubetas por día y por mes, fecha personalizada y mes pasado;
  - ventas por periodo sin eliminadas, con su CSV;
  - productos por facturación y por margen;
  - por método de pago y por cliente (con deuda);
  - cuentas por cobrar por antigüedad;
  - movimientos de dinero con entradas y salidas, búsqueda y etiquetas;
  - estados del stock;
  - valor del inventario sin stock negativo.
- **Playwright, 40/40.** Incluye 1 prueba nueva en `e2e/reports.spec.ts`: ventas en 3 fechas distintas (con reloj simulado), con crédito, tarjeta, transferencia y un retiro. Recorre el índice, el reporte por día y por mes con su métrica, la descarga CSV, la agrupación que conserva el periodo, productos, métodos, clientes, cuentas por cobrar, movimientos con filtro y búsqueda, stock y valor.
- **`npm run build`:** OK.
