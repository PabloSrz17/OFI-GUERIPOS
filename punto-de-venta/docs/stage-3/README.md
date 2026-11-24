# Etapa 3: productos y categorías

Fecha: 21/11/2026

## Qué se construyó

| Pieza | Archivo(s) |
|---|---|
| Base local SQLite: transacciones atómicas, cola única y persistencia después de cada confirmación | `src/db/database.ts`, `src/db/client.ts` |
| Esquema versionado (migración 1) | `src/db/migrations.ts` |
| Repositorios: productos, categorías, marcas, listas de precios, inventario y outbox | `src/repos/` |
| Reglas: unidades, IVA/IEPS, margen, búsqueda sin acentos y conversión a centavos | `src/domain/catalog.ts` |
| Lista de productos | `src/pages/products/ProductsListPage.tsx` |
| Crear Producto Rápido, Filtros, combobox "Buscar o crear" | `src/components/products/` |
| Editor completo para agregar y editar, con aviso "Tienes cambios sin guardar" | `src/pages/products/ProductEditorPage.tsx` |
| Detalle del producto con kardex ("Últimos Movimientos") | `src/pages/products/ProductDetailPage.tsx` |
| Preferencias → Productos → Categorías de Productos, con los modales Crear y Editar | `src/pages/settings/SettingsPages.tsx`, `src/components/products/CategoryDialog.tsx` |

## Reglas de negocio garantizadas

- **Llaves UUID** en todas las tablas, generadas en el equipo, para que la sincronización no tenga colisiones.
- **Alta atómica.** Al crear un producto se guardan en **una sola transacción**: el producto, sus precios, sus existencias por sucursal, el movimiento "Stock inicial" y los eventos de sincronización. Si algo falla, se deshace todo; la prueba "rollback" lo verifica.
- **El stock nunca cambia sin un movimiento.** La propia base lo impide con triggers: rechaza cualquier cambio de `stock_levels.quantity` que no coincida con el último movimiento, y las existencias nacen siempre en 0. Una prueba intenta modificar el stock directamente y la base lo rechaza.
- **El kardex es inmutable.** Los movimientos no se pueden editar ni borrar; los errores se corrigen con un movimiento inverso, como en Pulpos.
- **Editar un producto nunca cambia sus existencias.** El campo Cantidad aparece deshabilitado; los ajustes llegan en la Etapa 4.
- **Transactional Outbox.** Cada cambio deja su evento en la tabla `outbox` dentro de la misma transacción. Así queda listo para la sincronización con Supabase de la Etapa 7, usando el id del evento como llave de idempotencia.
- **Borrado lógico** de productos y categorías: se conservan el historial y la sincronización, y el SKU o código de barras queda libre para reutilizarse.
- **Validaciones:** el nombre es obligatorio. No se permiten SKU, código de barras ni categoría repetidos (sin distinguir mayúsculas); el error aparece en el campo correspondiente.
- **Dinero en centavos**, sin errores de redondeo. **Margen calculado sobre el precio**, como en Pulpos.
- **Durabilidad:** la UI confirma una operación solo cuando los datos ya quedaron guardados. Las pruebas verifican que los datos sobreviven a recargar la app.

## Cómo verlo

```
npm run dev   →  http://localhost:1420/#/products
```

La base empieza vacía, como un negocio nuevo, con "Sucursal Principal" y la lista "Público". Para cargar el catálogo ficticio de ferretería (27 productos), abre la consola de desarrollo y ejecuta `__posDev.seedDemo()`. Esta herramienta solo existe en modo desarrollo y no se incluye en la versión final.

## Pruebas

- **Vitest: 37/37 ✔.** 23 son nuevas, de la capa de datos, contra SQLite real en memoria. Cubren:
  - atomicidad y rollback; categoría creada al vuelo;
  - triggers de stock e inmutabilidad del kardex; stock negativo;
  - búsqueda sin acentos y con caracteres especiales; los 10 órdenes; los 7 filtros; paginación;
  - borrado lógico; CSV;
  - persistencia y llaves foráneas después de reabrir la base; margen e impuestos.
- **Playwright: 21/21 ✔.** Son 7 nuevas, sobre la app real en Edge:
  - alta rápida con categoría nueva; se verifica en SQLite: 1 producto, 1 categoría, 1 movimiento y 3 eventos en outbox;
  - "Ir al Editor Completo" conserva lo escrito; marca nueva, mínimo, margen en vivo y lista "Mayoreo";
  - el aviso de cambios sin guardar; editar sin tocar el stock; error de SKU repetido;
  - buscar, filtrar, ordenar y paginar; eliminar con confirmación; descarga CSV;
  - crear, editar y eliminar categorías.
- **`npm run build`: ✔.** La herramienta de datos ficticios no queda en el paquete final; se comprobó.

## Comparación con las referencias

Las capturas están en `docs/stage-3/screenshots/` con el mismo nombre que su referencia en `reference/pulpos/screenshots/`.

| Pantalla | Resultado | Diferencias que quedan |
|---|---|---|
| `D-products-list` | Encabezado, buscador, Filtrar, Ordenar, tabla, pills, paginación | Sin "Crear Etiquetas" ni "Importar Productos" (D6) |
| `D-products-filter` | Tarjetas por grupo con chips y contador | Sin Catálogo en Línea, Fabricación ni Kit (D6). Se agregó "Sin Categoría" en el selector |
| `D-products-sort` | Las 10 opciones de Pulpos | – |
| `D-products-search-empty` | Mismo texto | – |
| `D-product-new-form` | Mismos campos, combobox, "neto ▾" e "Ir al Editor Completo" | Se muestra la pill "Nueva" cuando la categoría se creará al guardar (propio). En Servicio se oculta Existencias |
| `E-category-combobox` | "+ Crear categoría" primero, en sky, y luego las categorías con icono | Con texto escrito la opción dice `Crear categoría "texto"` |
| `D-product-full-editor` | Mismas tarjetas, en el mismo orden y con la misma distribución | Sin Lotes, Variantes ni Fabricación (D6). La barra inferior queda fija |
| `D-product-unsaved-dialog` | Mismo texto y botones | También aparece al salir por el menú o con ← |
| `D-product-detail` | Encabezado, tarjeta principal, ubicaciones, precios y Últimos Movimientos | Sin "Ver en Catálogo" ni IA. Se agregaron Categoría, Marca, Código, Ubicación y Clave SAT cuando existen. "Ver Todos los Movimientos" llega en la Etapa 4 |
| `E-settings-products` | Columna PREFERENCIAS y tarjeta con enlaces y chevron | Solo "Productos → Categorías" (el resto de Preferencias no está en el alcance) |
| `E-categories-list`, `E-category-add-modal`, `E-category-edit-modal` | Tabla, "Editar" y ✕, fila "+ Agregar Categoría", modal con imagen | Sin "Mostrar en el Catálogo en Línea" (D6) |

## Problemas pendientes y supuestos por confirmar

1. **Unidades de venta.** En Pulpos solo se vio "Unidad"; agregué Pieza, Kg, g, Litro, ml, Metro, Caja, Paquete y Par. ¿Te sirven?
2. **Costo neto/bruto (D5).** Es una interpretación; confírmala si usas "bruto".
3. **Tasas de IVA e IEPS.** Puse las vigentes en México: IVA 16, 8, 0 y Exento; IEPS 8, 25, 26.5, 30 y 53 %.
4. **Motor SQLite (D4).** Hoy guarda en IndexedDB. Cuando esté Rust, se pasa a un archivo en `%APPDATA%` (y entonces conviene un respaldo automático).
5. **Imágenes.** Se reducen a 600 px y se guardan dentro de la base. Para sincronizarlas en la Etapa 7 probablemente convenga Supabase Storage.
6. **"Importar Productos"** no está. Sería útil para traer tu catálogo exportado de Pulpos; propongo hacerlo en una etapa posterior si lo quieres.
7. **Usuarios.** Los movimientos se firman como "Administrador" hasta que existan usuarios, que no están en el alcance.
8. **Descarga CSV dentro de Tauri.** Sin compilar no se pudo probar; en Edge funciona. La prueba e2e intercepta la descarga porque Edge controlado por Playwright se cierra al descargar.
9. Siguen pendientes de la Etapa 2: Rust/MSVC, nombre y logo, y git.
