# Referencia: Pulpos (inspección de la Etapa 1)

- **Fecha de inspección:** 21/11/2026
- **Cuenta:** cuenta propia del negocio (plan sin "Plan Pro"; varias funciones aparecen bloqueadas con candado o con el aviso "Disponible en Plan Pro").
- **Método:** Microsoft Edge con un perfil aislado, controlado por Playwright vía CDP (`tools/inspect/`). El usuario inició sesión manualmente. Lectura de árbol de accesibilidad, estilos calculados (`getComputedStyle`) y capturas PNG a 1416×808.
- **Regla aplicada:** solo lectura. Se abrieron formularios y modales para registrar campos y se cerraron con *Cancelar*, *Escape* o *Salir sin Guardar*. **No se confirmó ninguna operación.** Se verificó al final que el producto de prueba escrito en un formulario ("PRUEBA NO GUARDAR") **no** existe.

> ⚠️ Las capturas contienen datos reales del negocio (ventas, montos, nombres de clientes en `C-pos-add-client.png`). Son de uso interno: no subirlas a repositorios públicos ni compartirlas.

## Índice

| Documento | Contenido |
|---|---|
| [navigation.md](navigation.md) | Estructura general, menú lateral, rutas, relaciones entre módulos |
| [design-system.md](design-system.md) | Colores, tipografía, espaciados, componentes medidos |
| [dashboard.md](dashboard.md) | A. Inicio |
| [sales.md](sales.md) | B. Ventas y C. Punto de venta |
| [products.md](products.md) | D. Productos y E. Categorías |
| [inventory.md](inventory.md) | F. Inventario: ajustes, conteos, traspasos, movimientos |
| [cash.md](cash.md) | G. Caja y H. Cortes (aperturas y cierres) |
| [reports.md](reports.md) | I. Historial y reportes |
| [decisions.md](decisions.md) | Decisiones del usuario: cobro y corte sin referencia, sin apertura de caja, stock negativo permitido |

## Convención de capturas

`screenshots/<sección>-<pantalla>[-<estado>].png`, donde la sección es una letra de la A a la I según el plan de la Etapa 1, o `nav-` para los elementos globales. Las que terminan en `-full` son de página completa.

## Cobertura y lo que NO se observó

| Área | Observado | No observado (requiere confirmar una operación real o es de Plan Pro) |
|---|---|---|
| Dashboard | Completo | Reportes avanzados de CxC/CxP (Plan Pro) |
| Punto de venta | Búsqueda, carrito, menú de línea, descuento, cambio de precio, lista de precios, cliente, entrada manual, nota, modo Pedido, vaciar carrito | **Pantalla de cobro (botón "Cobrar")**, ticket posterior, venta a crédito, mensajes de éxito o error tras cobrar |
| Ventas | Lista, pestañas, filtros, detalle pagado, detalle con deuda, menú "Más Acciones" | Flujos de Devolver, Eliminar, Registrar Cobro, Entregar Productos y Facturar |
| Productos | Lista, filtros, orden, menú Agregar, creación rápida, editor completo, detalle, diálogo de cambios sin guardar | Guardar o editar, eliminar, importar, descargar, crear etiquetas, variantes, kits |
| Categorías | Lista, modales Crear y Editar | Guardar y eliminar |
| Inventario | Ajustes (estado vacío), entrada con cálculo, conteo, motivos, traspasos (estado vacío), reporte de entradas y salidas, kardex por producto | Confirmar entrada, salida o conteo; borradores; formulario de traspaso |
| Caja | Caja actual, total esperado (resumen), modales de ingreso y retiro, historial, detalle de corte | **Formulario "Hacer Corte de Caja"** (no se abrió porque podría ejecutar el corte), "Ver Movimientos", "Más Acciones" del corte |
| Apertura de caja | **No existe como pantalla separada**: la caja siempre está activa, "Efectivo al inicio" viene del "Restante en caja" del corte anterior (ver cash.md) | Confirmarlo requiere hacer un corte real |
| Reportes | Índice completo, Reporte de Ventas, Movimientos de Dinero, Ventas por Método de Pago, Entradas y Salidas, opciones de periodo y agrupación | Descarga de reportes, Plan Pro |

## Herramientas de inspección (reutilizables)

`tools/inspect/` tiene `launch.mjs`, que abre el navegador, y `run.mjs`, que ejecuta las tareas: `shot`, `snapshot`, `probe`, `click`, `fill`, `key` y `eval`. El script `click` bloquea por nombre los botones Guardar, Confirmar, Cobrar, Eliminar, Crear, etc.
