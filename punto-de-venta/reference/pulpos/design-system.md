# Sistema de diseño (valores medidos)

Todos los valores salen de `getComputedStyle` sobre elementos reales, con viewport de 1416×808. La paleta coincide con la **paleta por defecto de Tailwind CSS**, más un color primario teal propio y algunos acentos. Esto facilita reproducirla con Tailwind y shadcn/ui.

## 1. Color

### Neutros (Tailwind gray)

| Token | RGB | Uso observado |
|---|---|---|
| gray-50 | 249,250,251 | Encabezado de tabla, fondo del cuerpo de modales y filas hover |
| gray-100 | 243,244,246 | **Fondo de la app** (`body`), botón deshabilitado |
| gray-200 | 229,231,235 | Bordes de tarjeta, header, divisores de tabla (el color más frecuente) |
| gray-300 | 209,213,219 | Borde de inputs y botones secundarios; texto del menú lateral |
| gray-400 | 156,163,175 | Iconos y rótulos de sección del aside, placeholders |
| gray-500 | 107,114,128 | Texto secundario (SKU, fechas, precios en tabla), texto de botón deshabilitado |
| gray-600 | 75,85,99 | Fondo del botón "Nueva Venta" del aside |
| gray-700 | 55,65,81 | Texto de botón secundario |
| gray-800 | 31,41,55 | **Fondo del aside**, labels de formulario |
| gray-900 | 17,24,39 | **Texto principal**, ítem activo del aside, pie del aside |

### Marca y acciones

| Token | RGB / HEX | Uso |
|---|---|---|
| **primary** (teal) | 0,164,174 · `#00A4AE` | Botón primario (fondo y borde), "¡Comenzar a Referir!" |
| primary-light | 85,194,201 · `#55C2C9` | Texto e icono del ítem activo del aside, barra indicadora |
| link (sky-600) | 2,132,199 · `#0284C7` | Enlaces en tablas (nombres de producto, N° de venta), "Ver reporte", "Editar", paginación activa, checkbox marcado, tipo seleccionado |
| focus (sky-500) | 14,165,233 | Borde y ring de input enfocado; select "neto ▾" |
| sky-50 / sky-300 / sky-900 | 240,249,255 / 125,211,252 / 12,74,110 | Banner informativo; botones *Gestionar …* (bg sky-50, texto sky-600) |
| indigo-500 / indigo-50 / indigo-300 | 99,102,241 / 238,242,255 / 165,180,252 | Todo lo relacionado con IA (Asistente, "¿Qué ocurrió con este producto…?") |
| naranja Clip | 252,76,2 · `#FC4C02` | Banner "Cobra con Clip", insignia "Nuevo" (no reproducir: es marca de terceros) |
| amber-600 | 217,119,6 | Botón "Ver Reporte Avanzado" (Plan Pro), candado |

### Estados (insignias tipo pill)

| Estado | Texto | Fondo | Ejemplos |
|---|---|---|---|
| Éxito | green-800 `22,101,52` | green-100 `220,252,231` | "1 unidad", "Pagada", "Entregados", "Ingreso", "↑ Entrada" |
| Peligro | red-800 `153,27,27` | red-100 `254,226,226` | "0 unidades", stock negativo, "Retiro", "↓ Salida" |
| Deuda | pink/rose 800 | pink/rose 100 | "Deuda pendiente", "$332,852.31 vencidos" |
| Advertencia | amber-800 | amber-100 / yellow-100 | "No Entregados", "8016 productos pedidos" |

Las pills miden 12 px/16 px, peso 500, padding 2×10 y radio 9999 px.
Los montos positivos van en green-600 con "+" y los negativos en red-600 con "−".

## 2. Tipografía

- **Texto general:** `Inter`, con respaldo `ui-sans-serif, system-ui, Segoe UI…`.
- **Títulos de página y display:** `Manrope`, pesos 700 y 800.

| Rol | Fuente | Tamaño / interlineado | Peso | Ejemplo |
|---|---|---|---|---|
| Título de página h2 (listas) | Manrope | 20/28 | 700 | "Productos", "Ventas" |
| Saludo / POS h2 | Manrope | 24/32 | 800 | "¡Hola!", "Buscar productos" |
| Banner h1 / h4 | Manrope | 20/28 | 800 | "¡Nuevo! Cobra en Pulpos…" |
| KPI grande | Inter | 30/36 | 600 | "112", "$115,178" |
| Título de modal | Inter | 18/28 | 500 | "Crear Producto Rápido" |
| Título de sección o tarjeta h3/h4 | Inter | 16/24 | 600 | "Acciones Pendientes", "Datos del Producto" |
| Encabezado de tabla | Inter | 14/20 | 600 | "Producto", "Stock" |
| Cuerpo / UI | Inter | 14/20 | 400–500 | Celdas, botones, labels |
| Label de formulario | Inter | 14/20 | 500 | gray-800 |
| Secundario / ayuda | Inter | 12/16 | 400 | SKU, "Incluyendo impuestos" |
| Rótulo de sección del aside | Inter | 12/16 | 500 | "Canales de Venta" (gray-400) |

## 3. Espaciado y medidas

- **Escala Tailwind de 4 px.** Medidas frecuentes: 6, 8, 12, 16, 24 y 32 px.
- **Header:** 64 px. **Aside:** 240 px (60 px colapsado en el POS).
- **Contenido:** padding lateral de 24 px; el título queda a 24 px del header.
- **Tarjeta:** padding interno de 24 px; separación entre tarjetas de 12–16 px.
- **Controles:** alto de **38 px** (inputs, botones y selects); padding de botón 8×16; de input 8×12 (40 px a la izquierda si lleva icono de lupa).
- **Ítem del aside:** 32 px de alto. **Fila de tabla:** 73 px con miniatura o 54 px sin ella; padding de celda 16×12.
- **Miniatura de producto:** 40×40, borde gray-200, radio 6, icono de imagen gris como placeholder.

## 4. Radios y sombras

| Elemento | Radio | Sombra |
|---|---|---|
| Botón, input, select, ítem del menú | 6 px | – |
| Tarjeta, modal, menú desplegable | 8 px | `0 1px 2px rgba(0,0,0,.15), 0 0 5px rgba(23,24,24,.05)` |
| Contenedor de tabla | 8 px | ring de 1 px gray-200 (box-shadow), fondo gray-50 en el thead |
| Botón segmentado (Producto/Servicio) | 8 px | ring de 1 px: sky-600 si está seleccionado, gray-300 si no |
| Pill / insignia | 9999 px | – |
| Checkbox | 4 px | – |

Overlay de modal: negro semitransparente (≈ gray-500/75) sobre toda la app.

## 5. Componentes

### Botones (alto 38, texto 14/500, radio 6)

| Variante | Fondo | Texto | Borde | Ejemplos |
|---|---|---|---|---|
| Primario | teal `#00A4AE` | blanco | teal | Agregar Producto, Crear, Editar, Facturar Venta, Hacer Corte de Caja, Descargar Reporte |
| Primario deshabilitado | gray-100 | gray-500 | transparente | Crear Producto (formulario incompleto), Cobrar $0.00 |
| Secundario | blanco | gray-700 | gray-300 | Crear Etiquetas, Filtrar, Ordenar, Cancelar, Más Acciones |
| Suave informativo | sky-50 | sky-600 | transparente | Gestionar Pedidos, Ir al Editor Completo |
| Enlace | – | sky-600 | – | Editar (tabla), Asignar Cliente, Ver reporte |
| Destructivo con icono | – | gray-700 con icono de papelera | – | Eliminar (detalle de producto) |
| Icono cuadrado | blanco | gray-600 | gray-300 | ← volver (44×44), ⋯, 🗑 en el POS (38×38) |

- Los botones con menú llevan un chevron ▾ a la derecha.
- Los botones del POS muestran **atajos de teclado como "kbd"**: cajas pequeñas con borde gray-300, radio 4 y texto de 12 px.

### Inputs

- Fondo blanco, borde gray-300 de 1 px, radio 6, alto 38 y texto de 14 px.
- **Al enfocar:** borde sky-500 más un ring de 1 px sky-500.
- **Prefijo o sufijo dentro del input:** "$" a la izquierda; "por Unidad" o "Unidades" a la derecha en gray-500.
- **Texto de ayuda** debajo, 12 px gray-500 ("Incluyendo impuestos").
- **Obligatorio:** asterisco "Nombre*".
- **Combobox con creación:** placeholder "Buscar o crear categoría". La lista desplegable empieza con "+ Crear categoría" en sky-600 y sigue con las opciones existentes, cada una con su icono.
- **Botón segmentado** (Tipo: Producto | Servicio; Venta | Pedido; Cantidad ($) | Porcentaje (%)): contenedor gray-100 y opción activa blanca con sombra.

### Tabla

- Contenedor con radio 8 y ring gray-200. Encabezado con fondo gray-50, texto 14/600 gray-900 y borde inferior gray-200.
- Cuerpo blanco, filas divididas por gray-200 y hover gray-50.
- Primera columna con checkbox (selección múltiple) y la principal con miniatura de 40 px: nombre en enlace sky-600 14/500 y debajo un subtítulo 12 px gray-500 (SKU).
- Columnas numéricas centradas o alineadas a la derecha, en gray-500.
- **Paginación:** "← Anterior | 1 2 3 … 29 | Siguiente →" con estilo de pestañas: la página activa lleva borde superior de 2 px sky-600 y texto sky-600.

### Menú desplegable (Agregar Producto ▾)

- Tarjeta blanca con radio 8, sombra y ancho de ≈ 320 px.
- Cada opción tiene icono de contorno de 20 px gray-400, título 14/500 y descripción 14/400 gray-500, separadas por un divisor gray-100.

### Modal de filtros

- Título "Filtros" y ✕. Cuerpo gris con grupos en tarjetas blancas: icono más título, y **chips de alternancia** (botones redondeados con borde gray-200) o selects.
- Pie: "🗑 Limpiar Filtros (N)" (secundario) y "Ver Resultados" (primario).

### Tarjetas de acción rápida (dashboard)

148×100, blancas, radio 8 y sombra. Título 14/500 centrado arriba e ilustración 3D a color abajo (recortada por el borde inferior).

### Iconografía

- **Contorno** (estilo Heroicons outline / Tabler) de 16–20 px en botones y menús.
- **Sólidos** en el aside.
- **Ilustraciones 3D a color** en tarjetas y banners. Al reconstruir: usar Lucide más ilustraciones propias o neutras, **no** los recursos de Pulpos.

## 6. Formato de datos

- **Moneda:** `$12,951.00` (MXN, coma de miles y punto decimal). En los gráficos se abrevia: `$10k`.
  ⚠️ Algunos inputs vacíos muestran `0,00` con coma, por la configuración regional del navegador.
- **Fechas relativas:** "Hoy a las 10:26", "Ayer a las 17:07". Las antiguas van como `19/11/2026 17:33:01`. En detalle: "20 de noviembre de 2026 a las 5:07:58 p.m.". En reportes: "10:26am" más "Hoy" en dos líneas.
- **Cantidades:** "1 unidad" / "0 unidades" / "10 kg", según la unidad de venta.
- **Numeración de ventas:** prefijo más número consecutivo (`N1283`). Hay ventas antiguas con formato `#2524`.

## 7. Notas para la reconstrucción

- Tailwind por defecto más un token `primary = #00A4AE` cubre casi todo.
- **Fuentes:** Inter y Manrope son de Google Fonts con licencia OFL, así que se pueden usar sin problema.
- **No reproducir** el logo, el naranja ni los banners de Clip, ni las ilustraciones de Pulpos.
