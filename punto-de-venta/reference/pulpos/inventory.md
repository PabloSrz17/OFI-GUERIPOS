# F. Inventario

Pulpos **no tiene una página llamada "Inventario"**. El inventario se reparte entre:

| Función | Ruta | Menú |
|---|---|---|
| Existencias por producto | Columna Stock en `/products`, detalle de producto | Productos |
| Ajustes de Stock (entradas, salidas, conteos) | `/stock-adjustments` | Productos → Ajustes de Stock |
| Traspasos entre sucursales | `/transfers` | Productos → Traspasos |
| Movimientos (kardex) | `/reports/stock-movements` | Reportes → Entradas y Salidas, o "Ver Todos los Movimientos" en el producto |
| Reportes de stock | `/reports/stock`, `/reports/inventory`, `/reports/committed-stock`, `/reports/product-expiration` | Reportes |

Capturas: `F-stock-adjustments.png`, `F-stock-inout-menu.png`, `F-stock-entry-form.png`, `F-stock-entry-with-item.png`, `F-stock-entry-qty.png`, `F-stock-count-form.png`, `F-transfers.png`, `F-stock-movements-report.png`, `D-product-detail.png`.

## Ajustes de Stock — `/stock-adjustments`

- **Estado vacío** (la cuenta no tiene ajustes):
  - Tabla fantasma (Ajuste | Fecha | Tipo) con filas de esqueleto difuminadas.
  - Encima, el texto "**Ajusta el stock de tu negocio** — Registra entradas y salidas de stock o realiza conteos físicos para mantener tu inventario siempre al día."
  - Botones [Nuevo Conteo de Stock] (secundario) y [**Nueva Entrada o Salida ▾**] (primario).
- **Menú "Nueva Entrada o Salida":**
  - "Nueva Entrada de Stock — Ingresa stock recibido" → `/stock-adjustments/add?type=ENTRY`
  - "Nueva Salida de Stock — Retira stock de tu inventario" → `?type=EXIT` (inferido por simetría; no se abrió)
- Nuevo Conteo → `/stock-adjustments/add?type=COUNT`.

### Formulario "Nueva Entrada" (página completa)

- Encabezado: ← "Nueva Entrada".
- **Columna principal:**
  - Tarjeta "**Productos a Ingresar**": buscador "Buscar productos" con botón de código de barras.
  - Tabla Producto (miniatura, SKU, nombre, precio) | **Cantidad** (input con placeholder "Completar") | **Stock Final** (ⓘ) | ⋯.
  - Tarjeta de totales: **Stock a Ingresar** | **Costo a Ingresar** | **Valor a Ingresar**.
- **Columna lateral:**
  - Tarjeta "**Motivo del Ajuste**": select "Elegir Motivo" con las opciones Corrección, Conteo, Expiración, Robo o pérdida, Deterioro y Regalo.
  - Tarjeta "**Notas**" (con botón ✎): "No hay ninguna nota".
- **Barra inferior fija:** [Cancelar] [Guardar Borrador] [**Confirmar Entrada**]. Los dos últimos están deshabilitados hasta que hay productos.

**Cálculo en vivo observado** (producto con stock 1 y precio $12, capturando cantidad 5):
- Stock Final = **6**
- Stock a Ingresar = **5**
- Costo a Ingresar = $0.00 (costo × cantidad; el costo del producto es 0)
- Valor a Ingresar = **$60.00** (precio × cantidad)

Al cancelar con cambios aparece el modal "Tienes cambios sin guardar".

### Formulario "Nuevo Conteo"

- Igual que la entrada, pero con el título "Nuevo Conteo", la tarjeta "**Productos a Contar**" y Notas.
- **No tiene "Motivo".**
- Barra inferior: [Cancelar] [Guardar Borrador] [**Confirmar Conteo**].
- No se agregaron productos, así que no se observaron las columnas del conteo. Se presume "Cantidad contada" y "Diferencia"; pendiente de verificar.

### Conceptos clave

- Hay **tres tipos de ajuste:** ENTRY (entrada), EXIT (salida) y COUNT (conteo físico que fija el stock).
- **Borradores:** un ajuste puede guardarse sin aplicar.
- El stock cambia **solo** al confirmar, y cada ajuste genera movimientos en el kardex.

## Traspasos — `/transfers`

- Estado vacío con banner: "**Mueve tu inventario entre Sucursales** — Usa Traspasos para enviar productos entre tus sucursales y almacenes." y el botón [Crear Traspaso].
- No se abrió el formulario.
- El negocio tiene una sola "Sucursal Principal", así que esta función es de baja prioridad.

## Movimientos de inventario (kardex) — Reporte "Entradas y Salidas"

- Ruta: `/reports/stock-movements?periodGrouping=byDay&period=last90Days[&productName=…]`.
- Encabezado: ← "Entradas y Salidas" y [⬇ Descargar Reporte].
- **Controles:**
  - Periodo "Últimos 90 días ▾".
  - Segmentado **Todos | Entradas | Salidas**.
  - Buscador "Buscar por nombre, SKU o código de barras".
  - [Filtrar].
- **Tabla:**

  | Columna | Ejemplo |
  |---|---|
  | Fecha | "10:26am / Hoy" |
  | Movimiento | "Entrega de **Venta N1283**" (con enlace a la venta) |
  | Producto | SKU + nombre (botón) |
  | Stock Anterior | 33 |
  | Tipo | pill ↑ Entrada / ↓ Salida |
  | Cantidad | −1 |
  | Nuevo Stock | 32 |
  | Ubicación | Sucursal Principal |
  | Usuario | nombre |

- **Tipos de movimiento vistos:**
  - "Entrega de Venta #N" (Salida)
  - "Eliminación de Venta #N" (Entrada, revierte la salida)
  - Ajustes (Entrada, Salida, Conteo)
- **El stock puede quedar negativo** (por ejemplo, −23 → −25). No hay bloqueo por falta de stock en la venta.

## Reglas para el sistema propio (coinciden con lo observado)

1. Nunca se modifica el stock directamente: todo cambio es un movimiento con *stock anterior*, *cantidad* y *nuevo stock*.
2. Revertir una venta crea un movimiento inverso; no se borran movimientos.
3. La salida de stock ocurre **en la entrega**, no necesariamente al cobrar: los pedidos o ventas "No Entregadas" dejan el stock **apartado** (reporte "Productos Apartados").
