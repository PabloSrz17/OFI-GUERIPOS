# I. Historial y reportes — `/reports`

Capturas: `I-reports-index.png` (completo), `I-reports-index-top.png`, `I-report-sales-by-period.png`, `I-report-period-picker.png`, `I-report-payment-methods.png`, `I-report-money-movements.png`, `F-stock-movements-report.png`.

El "historial" operativo está en **Ventas** (`/sales`, ver sales.md), **Cortes Históricos** (cash.md) y el **kardex** (inventory.md). Esta sección cubre el módulo Reportes.

## Índice de reportes

Es una página con cuatro secciones (h3). Cada reporte es una **tarjeta con vista previa** (mini gráfico o top 4 en tabla) y el enlace "Ver reporte".

| Sección | Reporte | Ruta | Vista previa |
|---|---|---|---|
| **Ventas** | Ventas | `/reports/sales-by-period` | Conteo y gráfico de 7 días |
| | Facturación | (igual, en $) | Monto y gráfico |
| | Margen | | Monto y gráfico |
| | Productos más Vendidos | `/reports/sales-by-product?orderBy=totalAfterRefundsDesc` | |
| | Productos con más Margen | `/reports/sales-by-product?orderBy=marginDesc` | Producto / Margen |
| | Detalle de Ventas | `/reports/sales-by-sale-and-product` | Venta / Total con productos |
| | Listado de Ventas | `/reports/sales-by-number` | Número de Venta / Total |
| | Ventas por Método de Pago | `/reports/sales-by-payment-method` | Barras: Efectivo, A Crédito, Tarjeta de Crédito… |
| | Ventas por Categoría | `/reports/sales-by-category` | |
| | Ventas por Cajero | `/reports/sales-by-clerk` | |
| | Ventas por Vendedor | `/reports/sales-by-seller` | |
| | Ventas por Cliente | `/reports/sales-by-client` | |
| **Finanzas** | Cuentas por Cobrar 🔒 | Plan Pro | Total, Vencido, 0–7 días, 8–30 días, +30 días |
| | Cuentas por Pagar 🔒 | Plan Pro | Igual |
| | Utilidad 🔒 | Plan Pro | Ventas − Compras − Gastos = Resultado |
| | Movimientos de Dinero | `/reports/transactions` | Movimiento / Monto |
| **Inventario** | Stock de Productos | `/reports/stock` | |
| | Entradas y Salidas | `/reports/stock-movements` | Producto / Movimiento |
| | Valor del Inventario | `/reports/inventory` | Valor Total, Costo Total, Margen Total |
| | Productos por Reponer | (sin enlace en la lista capturada) | |
| | Productos Pronto a Expirar | `/reports/product-expiration` | |
| | Productos Apartados | `/reports/committed-stock` | Producto / Apartados |
| **Compras y Gastos** | Listado de Compras | `/reports/purchases` | |
| | Detalle de Compras | `/reports/purchased-products` | |
| | Listado de Gastos | `/reports/expenses` | |

> Nota: el índice expone 19 enlaces para 22 tarjetas con "Ver reporte". Ventas, Facturación y Margen parecen compartir `/reports/sales-by-period`, y "Productos por Reponer" no mostró una ruta propia. La asignación tarjeta → ruta de esas filas es aproximada.

Estado vacío en la vista previa: "No se han encontrado compras en las fechas seleccionadas".

## Estructura común de un reporte (ej. "Reporte de Ventas")

- **Encabezado:** ← título y [⬇ **Descargar Reporte**] (primario).
- **Barra de controles** (botones secundarios con icono y ▾):
  - **Granularidad:** Por Día / Por Mes.
  - **Periodo:** Hoy, Ayer, Últimos 7 días (por defecto), Últimos 30 días, Últimos 90 días, Mes pasado, Mes actual, Fecha Personalizada.
  - **Agrupación** (cambia de reporte): Por Fecha, Por Producto, Por Venta y por Producto, Por Número de Venta, Por Método de Pago, Por Categoría, Por Vendedor, Por Cajero, Por Cliente.
  - [Filtrar] a la derecha.
- **Tarjeta del gráfico:** métrica (por ejemplo "Ventas 113"), rango ("15 de noviembre - 21 de noviembre") y gráfico de área suavizado (línea sky-600 con relleno degradado).
- **Tabla de datos:** encabezados con ⓘ de ayuda. **La primera fila es "Total"** con fondo gray-50 y le siguen las filas por periodo en orden descendente.
  - Columnas del Reporte de Ventas: **Fecha | Ventas | Ventas Totales | Reembolsos | Ventas Netas | Costo Total | Margen**.
  - Ejemplo: Total 113 | $115,398.10 | $0.00 | $115,398.10 | $67,336.10 | $48,062.01.

## Movimientos de Dinero — `/reports/transactions`

- Periodo "Últimos 7 días ▾", segmentado **Todos | Entradas | Salidas**, buscador "Buscar movimiento" y [Filtrar].
- **Tabla:** Fecha ("10:28am / Hoy") | Movimiento ("Cobro de Deuda en **Venta N1263**", "**Venta N1283**", "Ingreso de Efectivo en **Caja**", "Retiro de Efectivo en **Caja**") | Método de Pago | Tipo (↑ Entrada / ↓ Salida) | Monto (+ verde / − rojo) | Caja (enlace "Principal") | Sucursal | Usuario.
- Es el **libro de caja** unificado: une ventas, cobros de crédito, ingresos y retiros.

## Métricas definidas (deducidas de las columnas)

- **Ventas** = número de ventas.
- **Ventas Totales (Facturación)** = suma de los totales con impuestos.
- **Ventas Netas** = Ventas Totales − Reembolsos.
- **Margen** = Ventas Netas − Costo Total.
- **Valor del Inventario** = Σ stock × precio. **Costo Total** = Σ stock × costo. En esta cuenta sale negativo porque hay stock negativo.

## No observado

- Descarga de reportes (formato del archivo) y filtros avanzados por reporte.
- Detalle de los reportes de Inventario y de Compras; reportes Plan Pro.
