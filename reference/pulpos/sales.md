# B. Ventas y C. Punto de Venta

---

## C. Punto de Venta — `/pos`

Capturas: `C-pos-empty.png`, `C-pos-search-results.png`, `C-pos-cart-1-item.png`, `C-pos-line-menu.png`, `C-pos-line-discount.png`, `C-pos-line-price.png`, `C-pos-pricelist-menu.png`, `C-pos-cart-menu.png`, `C-pos-add-client.png`, `C-pos-manual-entry.png`, `C-pos-add-note.png`, `C-pos-mode-pedido.png`, `C-pos-clear-cart.png`.

### Distribución

- El aside se **colapsa a 60 px** (solo iconos).
- **Columna izquierda (≈ 640 px, fondo gray-100), "Buscar productos":**
  - Título h2 Manrope 24/800.
  - **Buscador grande** (46 px de alto, borde sky al enfocar): icono de lupa, input "Buscar productos" y a la derecha un segmento con icono de **código de barras**. Atajo **Ctrl K**.
  - **Rejilla de acciones** de 2 columnas dentro de una tarjeta blanca. Cada celda tiene un icono en un cuadrado de color pastel (40×40, radio 8) y un título de 16/500. Al pasar el mouse muestra su atajo en "kbd".
    | Acción | Color del icono | Atajo |
    |---|---|---|
    | Crear producto | teal | – |
    | Añadir Promoción | indigo | Ctrl Shift D |
    | Entrada manual | azul | Ctrl Shift M |
    | Añadir cliente | rojo | Ctrl Shift C |
    | Añadir Vendedor 🔒 | ámbar (bloqueado por plan) | Ctrl Shift V |
    | Añadir nota | verde | Ctrl Shift L |
    | Recargas y Servicios | azul | – |
- **Columna derecha (carrito, ≈ 676 px, fondo blanco):**
  - **Pestañas de ventas en paralelo:** "Nueva Venta ✕" y el botón "+" para abrir otra venta simultánea (estilo pestaña de navegador; la activa es blanca).
  - **Barra superior:** un control segmentado **Venta | Pedido** con iconos, y a la derecha: selector de **lista de precios** ("$ Público ▾"), 🗑 (vaciar carrito, solo visible con productos) y ⋯ (opciones de la venta).
  - **Estado vacío:** "Tu carrito esta vacío" (Manrope, gray-400), "Agrega productos a tu venta" y los botones "🔍 Buscar productos" y "¡Escanea tus productos!".
  - **Pie fijo:** "Subtotal (N)" con el monto a la derecha, y el botón **"Cobrar $X"** a todo el ancho (56 px de alto, teal, texto 18/600, kbd "Ctrl ↵"). Con el carrito vacío queda deshabilitado en gris.

### Búsqueda de productos

- Al escribir, el panel de acciones se reemplaza por una **lista de resultados** dentro de una tarjeta blanca. Cada resultado muestra la miniatura de 40 px, el SKU (12 px gris), el nombre (14/500), el precio y, a la derecha, una **pill de stock** (verde "1 unidad", roja "0 unidades" o "-4 unidades").
- Al final aparece "**+ Crear producto "<texto buscado>"**".
- Pie de la lista con ayuda de teclado: "↑ ↓ Navegar" y "Tab Ir al carrito".
- Los productos **sin stock o con stock negativo siguen siendo seleccionables** (se observó al agregar productos con 1 unidad; no se probó con 0).
- **Al hacer clic en un resultado** se agrega con cantidad 1, el buscador se limpia y vuelve el panel de acciones.

### Línea del carrito

- La tarjeta (fondo gray-50, radio 8) muestra:
  - miniatura;
  - SKU, nombre y precio unitario;
  - un **input numérico de cantidad** (≈ 120 px);
  - el **importe de la línea** en negrita;
  - el botón **⋯**.
- **Menú ⋯ de la línea:**
  | Opción | Atajo | Resultado |
  |---|---|---|
  | Cambiar Precio | Ctrl Shift P | Modal "Elige la Lista de Precios": botones "Público $12.00" y "Precio Personalizado" |
  | Añadir Descuento | Ctrl Shift D | Modal "Añadir Descuento" (ver abajo) |
  | Ver Detalles | – | (no abierto) |
  | Editar Producto | – | (no abierto) |
  | Eliminar Producto | Delete | (no ejecutado) |
- **Modal "Añadir Descuento":**
  - Tarjeta del producto (nombre y precio).
  - Segmentado **Cantidad ($) | Porcentaje (%)**.
  - "Cantidad del Descuento" con el prefijo "$".
  - "Título del Descuento (opcional)", placeholder "Ej: Promo20".
  - Botones Cancelar y **Añadir**, deshabilitado hasta que se escribe un monto.

### Opciones de la venta

- **Lista de precios ("Público ▾")**: listbox con "Precio Público" (seleccionado) y "ML". Las listas se definen en Preferencias → Listas de Precios.
- **Menú ⋯** del carrito: "Quitar Impuestos de la Venta" y "Posponer Entrega de Productos".
- **🗑 Vaciar carrito:** vacía el carrito **sin pedir confirmación** (se observó).
- **Modo Pedido:**
  - La pestaña pasa a llamarse "Nuevo Pedido".
  - Aparece el texto "Crea un pedido para envío o retiro posterior".
  - El botón principal cambia a **"Crear Pedido - $X"** (Ctrl ↵).
  - Los productos del carrito se conservan al cambiar de modo.

### Modales de las acciones

- **Añadir Cliente:**
  - Buscador "Buscar por nombre, teléfono, email o razón social" y botón "Nuevo cliente".
  - Lista de clientes con nombre y teléfono. La primera opción es "Público en General".
  - Pie con ayuda de teclado: ↑ ↓ Navegar, ↵ Confirmar.
- **Entrada Manual de Producto** ("Añade un producto al carrito sin agregarlo a tu inventario"):
  - Nombre del producto (placeholder "Ej. Jabón de mano").
  - Cantidad y Unidad de Venta (botón "Unidad").
  - Precio de Venta "$ … por Unidad".
  - Costo (opcional).
  - ☑ Cobrar impuestos del producto, con IVA (16 % ▾) e IEPS (No aplica ▾).
  - Botones Cancelar y **Crear y Agregar** (deshabilitado hasta completar).
- **Añadir Nota:**
  - Área de texto "Escribe una nota para esta venta".
  - Ayuda: "Se mostrará a tus clientes en los comprobantes".
  - Botones Cancelar y Añadir.

### ❌ No observado (requiere aprobación)

- La **pantalla o modal de cobro** que abre "Cobrar $X": métodos de pago, efectivo recibido y cambio, pagos mixtos, crédito.
- La confirmación posterior, la impresión de ticket y los mensajes de éxito o error.

Por el historial de ventas y la caja se sabe que existen estos métodos: **Efectivo, Tarjeta de Crédito, Tarjeta de Débito, Transferencia y A Crédito**. También se sabe que una venta a crédito genera "Deuda pendiente" con vencimiento ("Vence en 15 días").

---

## B. Ventas — `/sales`

Capturas: `B-sales-list.png`, `B-sales-filter.png`, `B-sale-detail.png`, `B-sale-detail-debt.png`, `B-sale-more-actions.png`.

### Lista

- **Encabezado:** "Ventas", con "⬇ Descargar Ventas" (secundario) y "**+ Crear ▾**" (primario con menú, no abierto).
- **Buscador:** "Filtrar por productos, vendedor o cliente", más *Filtrar* y *Ordenar ▾*.
- **Pestañas en pill** (activa con fondo gray-100): **Todas**, **Pagos Pendientes (130)** y **No Entregadas (166)**. Los contadores van en una pill pequeña.
- **Tabla** (con scroll horizontal):

  | Columna | Contenido |
  |---|---|
  | ☐ | selección |
  | Venta | enlace sky-600 "N1283" |
  | Fecha | "Hoy a las 10:26" |
  | Cliente | enlace con el nombre (vacío = público general) |
  | Pago | pill: **Pagada** (verde) / **Deuda pendiente** (rosa) |
  | Total | $ |
  | Deuda | $ (solo si hay deuda) |
  | Productos | pill: **Entregados** (verde) / **No Entregados** (ámbar) |
  | Cajero | usuario |
  | Vendedor | – |
  | Canal | "Punto de Venta" (también Catálogo en Línea, Facturador) |
  | Factura | – |

- Paginación de 42 páginas, con el mismo estilo que en Productos.

### Filtros (modal "Filtros")

- **Fecha:** "Seleccionar Fecha ▾".
- **Numeración:** "Seleccionar Numeración ▾".
- **Método de Pago:** "Todos los Métodos de Pago ▾".
- **Caja:** "Todas las Cajas ▾".
- **Cajero:** "Todos los Cajeros ▾".
- **Cliente:** combobox.
- **Producto:** combobox.
- **Chips:**
  - Pago: Pagadas / Impagas / Deuda Pendiente.
  - Entrega: Entregadas / No entregadas.
  - Factura: Facturada / No facturada.
  - Devoluciones: Sin Devolución / Devolución Parcial / Devolución Total.
  - Canal de Venta: Punto de Venta / Catálogo en Línea / Facturador.
  - Descuentos: Con descuento / Sin descuento.
- **Pie:** Limpiar Filtros (N) y Ver Resultados.

### Detalle de venta — `/sales/detail?id=…`

- **Encabezado:** ← "Venta N1283", con los botones **Más Acciones ▾**, 🖨 **Imprimir Ticket**, ⬇ **Descargar PDF** y **Facturar Venta** (primario).
- **Columna principal:**
  - **Tarjeta de productos:** pill de estado de entrega ("🛒 Entregados") y tabla Producto (enlace + precio unitario) | Cantidad | Subtotal. Si se usó un precio distinto aparece el texto "Personalizado" bajo el precio. Las cantidades muestran la unidad ("10 kg").
  - Si **no** se entregó, el botón "**Entregar Productos**".
  - **Tarjeta de totales:** Subtotal, Descuentos (ⓘ) y **Total**.
  - **Historial** (🕒): campo "Añadir un Comentario" y una línea de tiempo vertical de eventos, cada uno con su icono y hora:
    - "Venta Registrada — usuario en Sucursal Principal"
    - "Cobro de $220.00 en Efectivo — usuario en Caja Principal"
    - "Entrega de Productos — usuario en Sucursal Principal"
    - En crédito: "Asignación de $2,121.00 de Crédito" y "Apartado de Productos"
- **Barra lateral (tarjetas):**
  - **Estado:** pill "($) Pagada" y Total. Con deuda: "Deuda pendiente", Total, **Abonado**, **Adeudado**, "**Vence en 15 días**", los botones "**Registrar Cobro**" y "Enviar Recordatorio", y un botón de icono (no identificado).
  - **Factura:** "Ver detalles".
  - **Fecha**, **Canal** (Punto de Venta), **Caja** (Principal) y **Cajero**.
  - **Vendedor:** "Asignar Vendedor".
  - **Cliente:** "Asignar Cliente" o un enlace con el nombre.
  - **Envío a Domicilio** (si es un pedido): "Enviar a: <dirección>" y "Ver mapa".
  - **Nota:** "Añadir Nota".
- **Más Acciones ▾:** Compartir por WhatsApp, Imprimir Ticket de Regalo, **Devolver** y **Eliminar**. No se abrieron.

### Reglas de negocio deducidas

- La venta tiene **tres estados independientes**: pago (Pagada / Deuda pendiente / Impaga), entrega (Entregados / No Entregados) y factura.
- **Eliminar una venta revierte el stock** con un movimiento "Eliminación de Venta #N" de tipo Entrada (visto en el kardex de un producto). No se borra el movimiento original.
- **El cobro queda ligado a una caja** ("en Caja Principal") y alimenta el total esperado de esa caja.
