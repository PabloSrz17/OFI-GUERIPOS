# Navegación y estructura general

Capturas: `A-dashboard.png`, `nav-sidebar-expanded.png`, `C-pos-empty.png` (menú colapsado), `nav-settings.png`, `nav-404.png`.

## Esqueleto de la aplicación

```
┌──────────────┬──────────────────────────────────────────────────────┐
│ ASIDE 240px  │ HEADER 64px (blanco, borde inferior gray-200)        │
│ gray-800     │   [¡Envíanos Sugerencias!] [Asistente] | [avatar ▾]  │
│              ├──────────────────────────────────────────────────────┤
│ logo         │ MAIN (fondo gray-100, scroll propio)                 │
│ [Nueva Venta]│   contenido centrado, ancho máx. ≈ 890–1110 px       │
│ nav…         │                                                      │
│ ── pie ──    │                                   (panel Asistente   │
│ gray-900     │                                    opcional 311 px)  │
└──────────────┴──────────────────────────────────────────────────────┘
```

- **Aside (menú lateral):** 240 px de ancho y fondo `rgb(31,41,55)` (gray-800). El bloque inferior (Novedades, Contactar a Soporte, Preferencias) usa `rgb(17,24,39)` (gray-900). La zona de navegación hace scroll propio y muestra su barra de desplazamiento.
- **En el Punto de Venta (`/pos`)** el aside se colapsa a **60 px** y solo muestra iconos. El botón "Nueva Venta" pasa a ser un icono ⊕ con fondo gray-900.
- **Header:** 64 px de alto, blanco, con borde inferior 1 px gray-200 y padding izquierdo de 32 px. A la derecha tiene:
  - el enlace de texto "¡Envíanos Sugerencias!", color sky-600 con icono de globo de chat;
  - el botón "Asistente", estilo indigo: texto indigo-500, fondo indigo-50 y borde indigo-300. Abre y cierra un panel lateral derecho de 311 px con un chat de IA y preguntas sugeridas;
  - un separador vertical;
  - el avatar con el nombre del usuario y una flecha ▾.
- **Panel Asistente:** cuando está abierto empuja el contenido de `main` (padding-right 311 px). Por defecto aparece abierto al entrar y se puede cerrar con ✕.

## Menú lateral (orden exacto observado)

| Elemento | Tipo | Ruta |
|---|---|---|
| **Nueva Venta** | Botón destacado (bg gray-600, radio 6) | `/pos` |
| Inicio | Enlace | `/` |
| Productos ▾ | Grupo | – |
| · Productos | | `/products` |
| · Traspasos | | `/transfers` |
| · Ajustes de Stock | | `/stock-adjustments` |
| · Fabricación | | `/manufacturing-orders` |
| Ventas ▾ | Grupo | – |
| · Ventas | | `/sales` |
| · Recargas | | `/pos?openDigitalServices=true` |
| · Cotizaciones | | `/quotations` |
| · Promociones | | `/promotions` |
| · Caja | | `/cashier-audits/current` |
| · Cortes Históricos | | `/cashier-audits/history` |
| Clientes ▾ | Grupo | `/clients`, `/customer-portal`, `/settings/loyalty-program` (Monedero) |
| Reportes | Enlace | `/reports` |
| Compras y Gastos ▾ | Grupo | `/purchases`, `/providers` |
| Facturas ▾ | Grupo | `/invoices`, `/global-invoices`, `/reconciliations` |
| Empleados IA | Enlace | `/ai-employees` |
| Refiere y Gana $2,590 | Enlace | `/referrals` |
| Cobra con Clip **Nuevo** | Enlace destacado (bg naranja 20 %, insignia naranja) | `/cobra-con-clip` |
| *Canales de Venta* | Rótulo de sección (12 px, gray-400) | – |
| WhatsApp | | `/whatsapp` |
| Catálogo en Línea | | `/catalog` |
| **Pie:** Novedades (punto rojo de aviso), Contactar a Soporte (menú), Preferencias | | `/updates-hub`, –, `/settings` |

### Comportamiento

- **Acordeón:** solo un grupo queda abierto a la vez. Al abrir *Ventas* se cierra *Productos* (`nav-sidebar-expanded.png`). El chevron gira (▾ ↔ ▴).
- **Al navegar** se abre automáticamente el grupo de la página actual.
- **Ítem activo:** fondo gray-900, texto `rgb(85,194,201)` (teal claro) con peso 600 y una **barra vertical teal de 4 px** pegada al borde izquierdo del aside.
- **Ítem normal:** texto gray-300 (`rgb(209,213,219)`), 14 px y peso 500. Alto 32 px, padding 6×8 y radio 6. Al pasar el mouse toma fondo gray-700.
- **Subítems:** sin icono y con sangría de ≈ 40 px.
- **Iconos:** sólidos de 16 px en gray-400. En el ítem activo toman el color teal.

## Preferencias (`/settings`)

Es un layout de dos columnas: un submenú blanco de 240 px con el rótulo "PREFERENCIAS" (gris, mayúsculas) y el contenido a la derecha. Entradas:

General (`/settings/my-store`), Usuarios, Vendedores, Impresoras y Dispositivos, Terminales Clip, Tickets, Sucursales y Almacenes, Ventas, Cotizaciones, **Cajas** (`/settings/cashiers`), **Productos** (`/settings/products` → Categorías, Marcas, Unidades de Medida, Lotes y Caducidades, Manejo de Stock, Fabricación), Facturación, Listas de Precios, Clientes, Monedero Electrónico, Recargas y Servicios, Bancos y Tarjetas, Métodos de Pago, WhatsApp, Notificaciones y Mi Suscripción.

## Patrones de página

1. **Lista:** título h2 a la izquierda y botones a la derecha (secundarios blancos y uno primario teal, a veces con ▾ que abre un menú). Debajo, una tarjeta blanca con buscador, *Filtrar* (abre un modal) y *Ordenar* (listbox), y luego una tabla con checkbox por fila y paginación numérica.
2. **Detalle:** botón ← cuadrado de 44 px con borde, título h2, acciones a la derecha y dos columnas: contenido (≈ 600 px) y una barra lateral de tarjetas (≈ 290 px).
3. **Formulario de página completa:** botón ←, título y tarjetas por sección. Una **barra fija inferior** blanca contiene *Cancelar*, *Guardar Borrador* (si aplica) y el botón primario.
4. **Modal:** encabezado con título de 18 px/500 y ✕; cuerpo con fondo gray-50 y tarjetas blancas o fondo blanco; pie con Cancelar y botón primario a la derecha. El primario queda **deshabilitado (gray-100 / gray-500) hasta que el formulario es válido**.
5. **Estado vacío con banner:** ilustración, título, texto y botones de acción (Ajustes de Stock, Traspasos).
6. **404:** "404" en teal, "Página no encontrada", botones *Ir al Inicio* (primario) y *Contactar a Soporte ▾*.

## Salir con cambios sin guardar

En los formularios de página completa (Agregar Producto, Nueva Entrada), al pulsar *Cancelar* o ← con cambios aparece el modal **"Tienes cambios sin guardar"**: *"Al salir de esta sección se perderán todos los cambios no guardados"*, con los botones **Continuar Editando** y **Salir sin Guardar** (`D-product-unsaved-dialog.png`).

## Atajos de teclado observados (POS)

| Atajo | Acción |
|---|---|
| Ctrl K | Enfocar "Buscar productos" |
| ↑ ↓ / Tab | Navegar resultados / ir al carrito |
| Ctrl Shift D | Añadir Promoción / Descuento a línea |
| Ctrl Shift M | Entrada manual |
| Ctrl Shift C | Añadir cliente |
| Ctrl Shift V | Añadir Vendedor |
| Ctrl Shift L | Añadir nota |
| Ctrl Shift P | Cambiar precio (línea) |
| Delete | Eliminar producto (línea) |
| Ctrl ↵ | Cobrar / Crear Pedido |

## Relaciones entre módulos (observadas)

```
Producto ──(existencias por sucursal)──► Movimientos de stock (kardex)
   ▲                                          ▲
   │ catálogo / búsqueda                      │ "Entrega de Venta #N" (Salida)
   │                                          │ "Eliminación de Venta #N" (Entrada)
POS ──► Venta ──► Pago (método) ──► Caja (total esperado por método)
          │          └─ crédito → "Deuda pendiente" → Registrar Cobro → "Cobros de Crédito"
          └─ Entrega de productos (inmediata o pospuesta / Pedido)
Caja ── Ingresos / Retiros de efectivo ──► Corte de caja ──► Cortes Históricos
Todo ──► Reportes (Ventas, Movimientos de Dinero, Entradas y Salidas…)
```

- El historial de una venta registra estos eventos: "Venta Registrada", "Cobro de $X en Efectivo … en Caja Principal" y "Entrega de Productos … en Sucursal Principal". En una venta a crédito, en su lugar: "Asignación de $X de Crédito" y "Apartado de Productos".
- **El stock solo cambia mediante movimientos tipificados.** En el kardex aparecen "Entrega de Venta", "Eliminación de Venta" y los ajustes. Se permite stock negativo (se observaron productos con −4 y −25 unidades).
