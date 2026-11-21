# D. Productos y E. Categorías

---

## D. Productos — `/products`

Capturas: `D-products-list.png`, `D-products-list-full.png`, `D-products-add-menu.png`, `D-products-filter.png`, `D-products-sort.png`, `D-products-search-empty.png`, `D-product-new-form.png`, `E-category-combobox.png`, `D-product-full-editor.png`, `D-product-unsaved-dialog.png`, `D-product-detail.png`.

### Lista

- **Encabezado:** "Productos" (Manrope 20/700). Botones a la derecha: [▦ Crear Etiquetas], [⬇ Descargar Productos], [⬆ Importar Productos] y **[Agregar Producto ▾]** (primario teal).
- **Tarjeta blanca** con:
  - El buscador "Buscar por nombre, SKU o código de barras". Al buscar se actualiza la URL (`?q=…&p=1&d=asc&f=name`).
  - [⚙ Filtrar] y [⇅ Ordenar ▾].
  - Una tabla con las columnas ☐ | **Producto** (miniatura + nombre en enlace + SKU) | **Stock** (pill verde o roja) | **Categoría** | **Precio**.
  - Paginación ("Anterior 1 2 3 … 29 Siguiente"), unas 25 filas por página.
- **Búsqueda sin resultados:** "No se encontraron productos para esta búsqueda".
- **Pill de stock:** verde si es mayor que 0, roja si es 0 o negativo. Texto "N unidad(es)" o la unidad del producto.

**Menú Agregar Producto ▾:**

| Opción | Descripción mostrada |
|---|---|
| Nuevo Producto | Añade un producto a tu negocio |
| Nuevo Servicio | Ofrece un servicio a tus clientes |
| Nuevo Kit de Productos | Combina uno o más productos en un kit y asígnale un precio |

**Ordenar:**
- Nombre (A - Z) (por defecto) / Nombre (Z - A)
- SKU (A - Z) / SKU (Z - A)
- Categoría (A - Z) / Categoría (Z - A)
- Menos Stock / Mayor Stock
- Creación (antiguos primero) / Creación (recientes primero)

**Filtros (modal):**
- Categorías: "Todas las Categorías ▾".
- Marcas: "Todas las Marcas ▾".
- Tipo: Producto / Servicio / Kit.
- Código de Barras: Con código / Sin código.
- Catálogo en Línea: Visible / No visible.
- Punto de Venta: Visible / No visible.
- Receta: Requiere / No requiere.
- Fabricación: Fabricable / No fabricable.
- Existencias: Con stock / Sin stock / Requiere reposición.
- Pie: "Limpiar Filtros (0)" y "Ver Resultados".

### Modal "Crear Producto Rápido"

Se abre desde Agregar Producto → Nuevo Producto, o desde el dashboard. Tiene cuerpo gris con tarjetas blancas.

| Campo | Tipo | Notas |
|---|---|---|
| Tipo | Segmentado **Producto** / Servicio | Producto por defecto |
| Nombre* | Texto, placeholder "Ej: Jabón de mano" | Obligatorio; recibe el foco al abrir |
| Existencias | Número (0) con sufijo "Unidad" | Stock inicial |
| Código de barras | Texto "Opcional" | |
| Categoría | Combobox "Buscar o crear categoría" | La lista empieza con "+ Crear categoría" |
| Precio de venta | "$ 0.00 por Unidad" | Ayuda: "Incluyendo impuestos" |
| Costo [neto ▾ / bruto] | "$ 0.00 por Unidad" | Selector neto/bruto en el label |

- Pie del cuerpo: el texto "Más Opciones: Para editar Impuestos, Unidades, Lotes, Talles y Colores, etc., ir al editor completo" y un botón ancho sky-50 "**Ir al Editor Completo ›**".
- Pie del modal: Cancelar y **Crear Producto**. Este último está deshabilitado en gris y **se habilita (teal) al escribir el Nombre**.
- **"Ir al Editor Completo"** abre `/products/add?name=<nombre>&stockQuantity=<n>` y **conserva lo escrito**.

### Editor completo — `/products/add`

Es una página con ← "Agregar Producto" y "▶ Ver Tutorial", más una **barra inferior fija** con [Cancelar] y [**Crear Producto**]. Está formada por estas tarjetas:

1. **Datos del Producto** (columna izquierda):
   - Nombre del producto* ("Ej: Jabon de mano").
   - Tipo: Producto / Servicio.
   - Código de barras (?) y SKU (?), ambos opcionales.
   - ☑ Vender en el Punto de Venta (?).
   - ☑ Incluir en el catálogo en línea.
   - ☐ Requerir receta médica para su venta.
2. **Imágenes** (columna derecha): zona punteada "Añadir imagen".
3. **Datos Adicionales:**
   - Unidad de venta (select "Unidad").
   - Categoría (combobox con creación).
   - Marca ("Buscar o crear marca").
   - Ubicación ("Ej.: Estante 3B").
   - Descripción (textarea).
4. **Existencias:**
   - ☑ Utilizar Existencias (?) y ☐ Utilizar Lotes y Caducidades.
   - Cantidad y Cantidad mínima, ambas en "Unidades".
5. **Impuestos:** ☑ Cobrar impuestos del producto; IVA (16 % ▾); IEPS (No aplica ▾).
6. **Variantes:** "+ Agregar opciones como tallas o colores".
7. **Fabricación:** ☐ Permitir Fabricar este Producto (?).
8. **Precio de Compra:** Costo [neto ▾], "$ … por Unidad", "Incluyendo Impuestos".
9. **Precios de Venta:**
   - Tabla con las columnas Lista de Precios | Precio de Venta (Con Impuestos Incluidos) | Margen | Ganancia.
   - Una fila por lista: **Público** y **ML**. Cada una tiene un input "$" y un botón "+".
   - Margen y Ganancia muestran "--" hasta que se captura el precio.
   - Al final: "+ Agregar Lista de Precios".
10. **Facturación:** Clave SAT (?), "Busca por palabras clave de tu producto o ingresa la clave".

**Cancelar con cambios** abre el modal "Tienes cambios sin guardar", con "Continuar Editando" y "Salir sin Guardar".

### Detalle de producto — `/products/detail?id=…`

- **Encabezado:** ← "Detalle del Producto", con [🗑 Eliminar] (botón de texto), [👁 Ver en Catálogo] y [✎ **Editar**] (primario). Editar lleva a `/products/edit?id=…`.
- **Tarjeta principal:**
  - Nombre (Manrope 20) y "SKU: …".
  - Tres columnas de datos: **Precio** $12.00 (IVA 16 %), **Costo** $0.00 (Incluyendo impuestos) y **Existencias** 1 (Unidad).
  - Descripción y "👁 Se muestra en el catálogo en línea".
  - Botón de IA "¿Qué ocurrió con este producto este mes?".
  - A la derecha, la imagen (placeholder) de 220×220.
- **Tarjeta de ubicaciones:** tabla Ubicación | Existencias | Cantidad Mínima (por ejemplo, "Sucursal Principal | 1 | 0").
- **Tarjeta de precios:** Lista de Precios | Precio de Venta (Impuestos Incluidos) | Margen | Ganancia (por ejemplo, Público $12.00 100 % $12.00).
- **Últimos Movimientos** (kardex resumido):
  - Columnas: Fecha | Movimiento | Stock Anterior | Tipo (pill ↑ Entrada verde / ↓ Salida roja) | Cantidad (+1 verde / −1 rojo) | Nuevo Stock | Ubicación | Usuario.
  - Botón "↗ Ver Todos los Movimientos", que abre `/reports/stock-movements?productName=…&period=last90Days`.

### Reglas observadas

- Precio de venta **con impuestos incluidos**. El costo puede capturarse neto o bruto.
- **El margen se calcula sobre el precio.** Ejemplo: precio $12 y costo $0 dan margen 100 % y ganancia $12.
- **El stock es por ubicación o sucursal** y tiene una cantidad mínima, usada para "Requiere reposición" y "Productos por Reponer".
- Hay **múltiples listas de precios** por producto.

---

## E. Categorías — `/settings/product-categories`

Capturas: `E-settings-products.png`, `E-categories-list.png`, `E-category-add-modal.png`, `E-category-edit-modal.png`, `E-category-combobox.png`.

- **No tienen menú propio en la barra lateral.** Se llega por Preferencias → Productos → **Categorías**, o se crean al vuelo desde el combobox "Buscar o crear categoría" del formulario de producto.
- La página Preferencias → Productos es una lista de enlaces con chevron: Categorías, Marcas, Unidades de Medida, Lotes y Caducidades, Manejo de Stock y Fabricación.

### Lista

- Encabezado: ← "Categorías de Productos" y [**+ Agregar Categoría**] (primario).
- Tabla Categoría (miniatura 40 px + nombre) | Cantidad de Productos | acciones (**Editar**, como enlace sky-600, y **✕** para eliminar).
- La última fila es "+ Agregar Categoría" (enlace).
- Categorías actuales de la cuenta: Aderezos, Almacén, Cereales y Pan (0 productos cada una). Los productos reales aparecen "Sin Categoría".

### Modal Crear / Editar Categoría

| Campo | Tipo |
|---|---|
| Imagen | Zona punteada "Añadir Imagen" |
| Nombre de la Categoría | Texto, placeholder "Indicar nombre" |
| Mostrar en el Catálogo en Línea | Checkbox (marcado por defecto) |

- Pie: Cancelar y **Crear Categoría** (o **Guardar Cambios** al editar). El botón primario queda deshabilitado hasta que hay un nombre o un cambio.
- No se observó la confirmación al eliminar (✕).
