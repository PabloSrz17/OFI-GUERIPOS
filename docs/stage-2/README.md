# Etapa 2: sistema de diseño y reconstrucción visual

Fecha: 21/11/2026

## Qué se construyó

| Pieza | Archivo(s) |
|---|---|
| Proyecto base: Vite 5 + React 18 + TypeScript + Tailwind 3 + estructura shadcn/ui (Radix) | `package.json`, `vite.config.ts`, `tailwind.config.ts`, `components.json` |
| Tauri 2 (configuración, iconos) | `src-tauri/` (**sin compilar**: falta Rust, ver Pendientes) |
| Tokens de diseño medidos en Pulpos | `tailwind.config.ts` (primary `#00A4AE`, sombra `card`, `control` 38 px, header 64 px, aside 240/60 px) |
| Fuentes locales (funcionan sin internet) | `@fontsource/inter` y `@fontsource/manrope` en `src/styles/globals.css` |
| Componentes | `src/components/ui/`: Button (6 variantes y 5 tamaños), Input, InputGroup ($ / "por Unidad"), Textarea, Field, Badge/StockBadge, Card, Table, Checkbox, Dialog, DropdownMenu, Select, Segmented (pill/outline), Pagination, Kbd/Shortcut, ToggleChip, PillTabs, Thumb, EmptyState |
| Gráfico de área con tooltip | `src/components/charts/area-chart.tsx` |
| Esqueleto de la app | `src/components/layout/`: Sidebar (acordeón y modo colapsado), Header, AppShell, Page/PageHeader/StickyFooter |
| Pantallas | Dashboard (datos de demostración), POS (carrito vacío, modo Venta/Pedido), catálogo de componentes en `#/design`, páginas reservadas y 404 |
| Formatos | `src/lib/format.ts`: `$12,951.00`, `$10k`, "1 unidad", "Hoy a las 10:26" |

## Cómo verlo

```
npm run dev      → http://localhost:1420   (catálogo: http://localhost:1420/#/design)
npm test         → pruebas unitarias (Vitest)
npm run e2e      → pruebas de interfaz y capturas (Playwright en Microsoft Edge)
```

## Pruebas

- **Vitest:** 14/14 ✔. Cubre formatos de moneda, cantidades y fechas; reglas de navegación; paginación; botón; insignia de stock; control segmentado.
- **Playwright:** 14/14 ✔. Mide **en la app real** contra los valores de Pulpos:
  - aside de 240 px en `rgb(31,41,55)`, header de 64 px, fondo `rgb(243,244,246)`, fuente Inter;
  - "Nueva Venta" en y=100 e "Inicio" en y=168, igual que en Pulpos;
  - ítem activo con fondo gray-900, texto `rgb(85,194,201)` y barra de 4 px en x=0;
  - acordeón con un solo grupo abierto; grupo abierto automáticamente según la ruta;
  - aside de 60 px en el POS; botón primario `rgb(0,164,174)` de 38 px y radio 6;
  - botón deshabilitado gray-100/gray-500; pill roja de stock negativo;
  - el modal se habilita al escribir el nombre; contador "Limpiar Filtros (N)".
- **`npm run build`:** ✔ (TypeScript sin errores).

## Comparación con las referencias

Las capturas están en `docs/stage-2/screenshots/`, con el mismo nombre que su referencia en `reference/pulpos/screenshots/` y el mismo viewport (1416×808).

| Pantalla | Referencia | Resultado | Diferencias que quedan |
|---|---|---|---|
| Menú lateral | `nav-sidebar-expanded.png` | Misma estructura, medidas, colores, acordeón y barra activa | Iconos de contorno (Lucide) en vez de sólidos; logo y nombre propios; solo los módulos del proyecto |
| Header | `A-dashboard.png` | 64 px, borde, separador, avatar con ▾ | Sin "Sugerencias" ni "Asistente" IA. Se añadió "Trabajando localmente" (estado offline, propio) |
| Dashboard | `A-dashboard-full.png` | Saludo, tarjetas de acción, divisor, KPI Ventas/Facturación con gráfico de 7 días, "Ver Todos los Reportes" | 3 acciones en lugar de 5 (sin Compra ni Factura); iconos en lugar de ilustraciones 3D; sin banners de Clip ni referidos; sin "Acciones Pendientes" (llegan con crédito y pedidos) |
| POS vacío | `C-pos-empty.png` | Aside colapsado, buscador con Ctrl K y código de barras, rejilla de acciones, pestañas de venta, Venta/Pedido, lista de precios, ⋯, estado vacío y Cobrar deshabilitado | Sin "Recargas y Servicios" ni "Añadir Vendedor"; "Añadir Promoción" pasa a "Añadir Descuento" |
| Lista de productos | `D-products-list.png` | Encabezado con 4 botones, tarjeta, buscador, Filtrar, Ordenar, tabla con checkbox, miniatura, enlace sky, SKU, pill de stock y paginación "1 2 3 … 29" | Datos ficticios; la conexión a datos llega en la Etapa 3 |
| Menú "Agregar Producto" | `D-products-add-menu.png` | Icono + título + descripción, separadores | – |
| Crear Producto Rápido | `D-product-new-form.png` | 660 px, cuerpo gris con tarjetas, Tipo Producto/Servicio, campos, "neto ▾", "Ir al Editor Completo", primario deshabilitado hasta escribir el nombre | El combobox de categoría es un input simple (se implementa en la Etapa 3) |
| Filtros | `D-products-filter.png` | Tarjetas por grupo con chips; "Limpiar Filtros (N)" + "Ver Resultados" | El estado de chip **activo** no se observó en Pulpos; se diseñó en sky-50/sky-600 |

## Problemas pendientes

1. **Rust y Visual Studio Build Tools no están instalados.** Sin ellos, Tauri no compila el ejecutable de Windows. La interfaz se desarrolla y prueba en el navegador mientras tanto; `src-tauri/` está configurado pero **sin verificar**.
2. **Playwright usa Microsoft Edge** (canal `msedge`) porque la descarga del Chromium de Playwright se atascó. Funciona igual para las pruebas.
3. **Diseño propio sin referencia:** las pantallas de cobro y de corte de caja (decisions.md D1) se diseñarán en las Etapas 5 y 6.
4. **Iconos:** se usa Lucide (contorno). Si se quiere más parecido con los iconos sólidos del menú lateral de Pulpos, se puede cambiar a Heroicons solid (licencia MIT).
5. **Nombre y logo de la app:** de momento "Mi Punto de Venta" con un icono genérico. Falta definir el nombre del negocio.
6. **Git:** la carpeta no es un repositorio. `.gitignore` ya excluye las capturas de Pulpos.
