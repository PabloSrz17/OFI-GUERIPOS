# A. Dashboard (Inicio) — `/`

Capturas: `A-dashboard.png` (con el panel Asistente abierto) y `A-dashboard-full.png` (página completa, Asistente cerrado).

## Distribución (de arriba abajo, ancho de contenido ≈ 890 px centrado)

1. **Saludo:** h2 "¡Hola!" (Manrope 24/800).
2. **Banner informativo de novedades:** fondo sky-50, borde sky-300 y radio 8. Lleva icono de megáfono, el texto "Nuevo Lanzamiento: …", el enlace "Ver Más →" y una ✕ para cerrarlo.
3. **Acciones rápidas:** fila de 5 tarjetas (148×100) con ilustración:
   | Tarjeta | Destino |
   |---|---|
   | Nueva Venta | `/pos` |
   | Nueva Compra | `/purchases/add` |
   | Crear Producto | botón: abre el modal "Crear Producto Rápido" (ver products.md) |
   | Nueva Factura | botón (no se abrió) |
   | Hacer Corte de Caja | `/cashier-audits/current` |
4. Divisor horizontal (gray-200).
5. **Banner promocional de Clip** (naranja). *No aplica al proyecto propio.*
6. Divisor.
7. **"Acciones Pendientes"** (h3 16/600): tarjetas blancas de ≈ 270 px.
   - 🚚 "**166 Pedidos por Entregar**", con la pill amarilla "8016 productos pedidos" y el botón suave "Gestionar Pedidos".
   - 🕒 "**44 Clientes con Deuda a Vencer**", con la pill rosa "$332,852.31 vencidos" y el botón "Gestionar Recordatorios" (`/customer-portal`).
8. Divisor.
9. **Rejilla de 2 columnas de tarjetas KPI**:
   - **Ventas:** título, enlace "Ver reporte" (`/reports/sales-by-period`), número grande (30/600) con el **conteo de ventas** de los últimos 7 días y un gráfico de área (línea sky-600 con relleno degradado sky) con eje X por día ("15 nov … 21 nov").
   - **Facturación:** la misma estructura, con el monto total en $ y el eje Y en `$10k`.
   - **Cuentas por Cobrar** y **Cuentas por Pagar:** contenido difuminado con la superposición "Disponible en **Plan Pro**" y el botón amber "🚀 Ver Reporte Avanzado".
10. Botón secundario centrado "Ver Todos los Reportes" (`/reports`).
11. Tarjetas finales: "¡Gana $2,590 por cada tienda que refieras…" (referidos) y "¿Necesitas Ayuda?", con los botones "Ir al Centro de Ayuda" y "Hablar con el Asistente".

## Comportamiento observado

- El periodo de los KPI está fijo en los **últimos 7 días** y no hay selector en el dashboard.
- Los números del dashboard coinciden con los del reporte "Reporte de Ventas", que tiene el mismo gráfico.
- El panel **Asistente** se abre solo al entrar y se cierra con ✕ o con el botón del header.

## Qué reproducir en el proyecto propio

| Elemento | ¿Reproducir? |
|---|---|
| Saludo + acciones rápidas (Nueva Venta, Crear Producto, Hacer Corte) | Sí |
| Acciones pendientes (pedidos por entregar, clientes con deuda) | Sí, si se implementan ventas a crédito y pedidos |
| KPI Ventas / Facturación con gráfico de 7 días | Sí |
| CxC / CxP | Opcional (en Pulpos son de Plan Pro) |
| Banners de Clip, referidos, asistente IA | No |
