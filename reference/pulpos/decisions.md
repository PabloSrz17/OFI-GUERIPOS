# Decisiones del usuario (después del informe de la Etapa 1)

Fecha: 21/11/2026

| # | Tema | Decisión | Consecuencia para el diseño |
|---|---|---|---|
| D1 | Observar la pantalla de cobro ("Cobrar") y el formulario "Hacer Corte de Caja" en Pulpos | **No autorizado.** | Estas dos pantallas **no tienen referencia visual**. Se diseñarán con el sistema de diseño ya documentado y los datos que sí se observaron: métodos de pago (Efectivo, Tarjeta de Crédito, Tarjeta de Débito, Transferencia, A Crédito), "Recuento Manual / Total Esperado / Diferencia", "Retiro por corte" y "Restante en caja". Se marcarán como **diseño propio** al comparar con las referencias. |
| D2 | Apertura de caja | **Igual que en Pulpos:** sin apertura explícita. | La caja está siempre activa; el corte cierra el periodo. "Efectivo al inicio" = "Restante en caja" del corte anterior. |
| D3 | Stock negativo | **Permitido.** | Vender sin existencias no se bloquea. La pill de stock se muestra roja con el valor negativo. Cada venta sigue generando su movimiento de inventario. |

# Decisiones técnicas de la Etapa 3 (pendientes de visto bueno del usuario)

| # | Tema | Decisión | Por qué |
|---|---|---|---|
| D4 | Motor SQLite | **sql.js** (SQLite compilado a WebAssembly) dentro de la app. La base completa se guarda después de cada transacción confirmada; hoy en IndexedDB. Al instalar Rust, se guarda como archivo en la carpeta de datos de la app (`%APPDATA%`), escribiendo en un temporal y renombrando, para que un apagón no deje el archivo a medias. | Sin Rust no se puede compilar SQLite nativo para Tauri. Con sql.js cada transacción es atómica por construcción (nada se intercala), y el mismo código corre en pruebas, navegador y Tauri. El SQL es estándar y se puede pasar a SQLite nativo sin reescribir el esquema. |
| D5 | Costo "neto / bruto" | **neto** (opción por defecto) = costo con impuestos, como muestra Pulpos ("Incluyendo impuestos"). **bruto** = costo antes de impuestos; para calcular el margen se le suman IVA e IEPS. | En Pulpos no se observó el efecto de la opción "bruto". Es una interpretación por confirmar. |
| D6 | Funciones de Pulpos que no se incluyen | Fuera: catálogo en línea ("Incluir en el catálogo en línea", "Ver en Catálogo", "Mostrar en el Catálogo en Línea"), Kits, Variantes, Lotes y Caducidades, Fabricación, "Crear Etiquetas", "Importar Productos", "Ver Tutorial", asistente de IA y el botón "+" de cada precio, cuyo comportamiento no se observó. | La app no tiene esos módulos, y un botón que no hace nada empeora la experiencia. Se pueden agregar en etapas futuras. |
| D7 | Diseño propio | Confirmación al eliminar (producto o categoría), barra de selección múltiple con "Eliminar", avisos tras guardar y el estado vacío del catálogo. | Estas pantallas no se observaron en Pulpos (solo hay datos reales y no se autorizó borrar). |

# Alcance definitivo (indicado por el usuario el 21/11/2026, después de la Etapa 3)

Lo único que se necesita de Pulpos: **hacer ventas y registrarlas, corte de caja, ingresos y gastos de dinero, reporte de ventas, registro de clientes, cobranza de clientes, reporte de inventario y movimientos de dinero.**

| # | Tema | Decisión | Consecuencia |
|---|---|---|---|
| D8 | Gastos de dinero | Son los **retiros de caja** ("Retirar Efectivo" de Pulpos), con su motivo. | No se construye el módulo "Compras y Gastos". Los retiros restan en el corte y aparecen en Movimientos de Dinero. |
| D9 | Entradas de mercancía | **Por definir** al final ("ya cuando esté todo listo lo vemos"). | Por ahora el stock se captura al crear el producto y lo bajan las ventas. El motor de movimientos ya admite ajustes, así que agregarlos después no requiere cambiar la base. "Ajustes de Stock" sale del menú hasta que se decida. |
| D10 | Clientes | Autorizado revisar la sección Clientes de Pulpos **solo en lectura**. | Se inspecciona antes de construir clientes y cobranza, sin crear, editar ni cobrar nada. |
| D11 | Respaldo | **Solo respaldo local**, sin Supabase. | Se quita la sincronización en la nube. El outbox se conserva porque no estorba y sirve como bitácora de cambios. El respaldo será a un archivo (carpeta o USB). |

# Etapa 5: ventas (21/11/2026)

| # | Tema | Decisión | Consecuencia |
|---|---|---|---|
| D12 | Pagos | **Un solo método por venta**: Efectivo, Tarjeta de Crédito, Tarjeta de Débito, Transferencia o A Crédito (respuesta del usuario: "Un solo método"). | No hay pagos mixtos. Cada venta pagada tiene un pago y un movimiento de caja con su método. |
| D13 | Quitar impuestos | Los precios incluyen impuestos. "Quitar Impuestos de la Venta" cobra cada renglón a precio / (1 + tasa). | Interpretación propia: en Pulpos no se confirmó una venta con esta opción. El ticket y el detalle muestran "Impuestos removidos". |
| D14 | Pedido y entrega posterior | **Pedido** y **Posponer Entrega de Productos** se cobran igual que una venta, pero los productos quedan "No Entregados" y el stock no se mueve hasta pulsar "Entregar Productos" en el detalle. | Las pestañas "No Entregadas" del historial y el movimiento "Entrega de Venta #N" salen de aquí. Un pedido sin cobrar no existe: no se pudo observar ese flujo sin crear datos reales. |
| D15 | Crédito | Exige cliente. Vence a los **15 días** (Preferencias → Clientes → "Plazo de Crédito", diseño propio). Respeta el límite del cliente o el predeterminado. Si se activa "Restringir vender a crédito a clientes con deuda vencida", bloquea al cliente con deuda vencida. | La deuda = total − pagos no revertidos. El cobro de deudas llega en la Etapa 7. |
| D16 | Ticket y eliminación | Ticket de **80 mm** impreso desde la app, con nombre, dirección, teléfono, RFC y pie configurables (Preferencias → Tickets, diseño propio). **Eliminar venta** pide confirmación, regresa el stock entregado ("Eliminación de Venta #N"), revierte los pagos y descuenta el dinero de la caja con movimientos negativos. | No se borra nada: la venta queda marcada como eliminada, con su historial. |
| D17 | Pantalla de cobro | **Diseño propio** (D1): el usuario no autorizó abrir "Cobrar" en Pulpos. | Total, 5 métodos (Alt+1–5), efectivo recibido con billetes sugeridos y cambio, datos de crédito, y pantalla de "Venta registrada". |
| D18 | Funciones del POS que no se incluyen | Promociones, Vendedor, Recargas, Facturar, Descargar PDF, Devolver, Compartir por WhatsApp, Ticket de Regalo, Registrar Cobro (Etapa 7) y la casilla de selección en el historial. En el historial, la columna **Método** sustituye a "Canal". | Fuera del alcance definitivo, o sin una función que se pueda observar sin crear datos reales. |
