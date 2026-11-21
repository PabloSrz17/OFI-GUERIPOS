# J. Clientes — `/clients`

Inspección del 21/11/2026, **solo en lectura** (decisions.md D10). No se creó, editó, cobró ni eliminó nada. Se abrieron formularios solo para verlos y se cerraron con Escape o Cancelar. **No se abrió "Registrar Cobro"**: es el equivalente a cobrar y queda como diseño propio, igual que D1.

Capturas: `J-clients-list.png`, `J-clients-sort.png`, `J-clients-filter.png`, `J-client-new-form.png`, `J-client-new-form-bottom.png`, `J-client-new-address.png`, `J-client-new-billing.png`, `J-client-detail.png` (con deuda), `J-client-detail-nodebt.png`, `J-client-basic-more.png`, `J-client-more-actions.png`, `J-client-edit-basic.png`, `J-client-credit-limit.png`, `J-client-statement.png`, `J-settings-clients.png`.

> ⚠️ Las capturas contienen nombres, teléfonos y deudas reales de clientes. Son de uso interno.

## Menú

Clientes ▾ es un grupo con Clientes, Portal de Clientes y Monedero.

## Lista

- **Encabezado:** "Clientes" y los botones [⬆ Importar Clientes], [⬇ Exportar] y [**+ Agregar Cliente**] (primario).
- **Tarjeta:**
  - Buscador "Filtrar por nombre, teléfono, email o razón social", con [Filtrar] y [Ordenar ▾].
  - Tabla con las columnas ☐ | **Nombre** (enlace sky, tal como se capturó, p. ej. en mayúsculas) | **Teléfono** ("+529811052126") | **Email** | **Cantidad de Ventas** (centrada; vacía si es 0) | **Deuda** (enlace sky "$700.00"; vacía si es 0).
  - Paginación como en productos (1 2 3 … 29).
- **Ordenar:** Nombre (A - Z) (por defecto), Nombre (Z - A), Creación (antiguos primero), Creación (recientes primero).
- **Filtros (modal):** Lista de Precio ("Todas las listas ▾"), Saldo en Monedero (Con Saldo / Sin Saldo) y Estado de Deuda (Sin deuda / Deuda Vencida / Deuda no Vencida). Pie: "Limpiar Filtros (0)" y "Ver Resultados".

## Modal "Nuevo Cliente" (y "Editar Cliente", con el mismo formulario)

Tiene las pestañas **Datos Básicos** | Datos de Facturación (subrayado sky en la activa). El cuerpo es gris con tarjetas blancas.

1. **Información del Cliente:**
   - Nombre* ("Ingresar nombre") y Apellido ("Ingresar apellido"), en dos columnas.
   - Teléfono: selector de país "🇲🇽 +52" pegado al input "Ingresar teléfono".
   - Email ("Ingresar email").
2. **Precios:** ☐ "Asignar una lista de precios al cliente" (ⓘ). Al marcarlo aparece el selector de lista.
3. **Dirección y Más:**
   - Dirección: botón [+ Añadir Dirección], que abre el modal "Ingresar Dirección".
   - Comentarios: textarea "Agrega información adicional de tu cliente".
- **Pie:** Cancelar y **Crear Cliente** (deshabilitado hasta escribir el Nombre).
- **Modal "Ingresar Dirección":**
  - Calle ("Ingresa una calle");
  - Número Exterior | Número Interior (Opcional);
  - Código postal ("Ingresar código postal") | Colonia (Opcional);
  - Municipio (Opcional);
  - Ciudad (Opcional) | Estado ("Seleccionar ▾").
  - Pie: Cancelar y **Guardar**.
- **Pestaña Datos de Facturación:** Razón Social, Código postal, R.F.C., Régimen Fiscal y "Mostrar campos opcionales". **Fuera del alcance**, porque no hay facturación.

## Detalle — `/clients/detail?id=…`

- **Encabezado:** ← y el nombre del cliente (Manrope 20). A la derecha:
  - [Más Acciones ▾], con las opciones Nueva Venta, Crear Cotización y Eliminar Cliente;
  - [👁 Ver Portal del Cliente];
  - [👤 Ver Estado de Cuenta].
- **Columna izquierda (≈600 px):**
  - **Resumen:** "Ventas 2 · Total Vendido $1,855 · Deuda Pendiente $700" (etiqueta gris y valor 18 px). Con deuda vencida, una franja amarilla en la misma tarjeta: "⚠ El cliente tiene una deuda vencida de $700" y el enlace "Enviar Recordatorio".
  - **Últimas Ventas:** "Venta N961" (enlace) y $700.00; fecha "31/10/2026 08:21:04"; pills "Deuda pendiente" (rosa) y "No Entregada" (ámbar) o "Pagada" y "Entregada" (verdes); y "🕓 Venció hace 6 días". Abajo, el botón [↗ Ver Todas las Ventas].
  - **Últimos Cobros:** icono, "Cobro de Venta #2126" (enlace), pill "No Facturado", $1,460.00, fecha, "Facturar" y ⋯. Solo aparece si hay cobros.
- **Columna derecha (≈288 px):**
  - **Detalle de Deuda**, solo si hay deuda:
    - pill "Vencida" (rosa) y monto total "$700";
    - filas: Vencida **$700** (rojo), "A cobrar en 0 a 7 días" $0 y "A cobrar en +7 días" $0;
    - botones [**Registrar Cobro**] (primario, ancho completo) y [Enviar Recordatorio] (WhatsApp).
  - Una tarjeta con secciones separadas por líneas, cada una con su título 14/600 y un ✎ que abre su modal de edición:
    - **Datos Básicos:** el nombre y "Ver Más". Ver Más despliega la Dirección.
    - **Datos de Facturación:** "Sin Datos de Facturación".
    - **Lista de Precios:** "Sin lista asignada".
    - **Límite de Crédito:** "Sin limitar".
    - **Saldo en Monedero:** "Desactivado" y "Activar Monedero".
    - **Comentarios:** el texto, o el enlace "Agregar" si está vacío.
- **Modal "Editar Límite de Crédito":**
  - franja gris "Límite Predeterminado: Sin limitar";
  - radios: ◉ "Límite predeterminado *Sin limitar*" / ○ "Personalizar límite para este cliente" (🔒 en Pulpos indica Plan Pro).
  - Pie: Cancelar y Guardar.
- **Modal "Estado de Cuenta":**
  - tarjeta con el icono de persona, el nombre, "Ventas con Deuda: 1" y "Deuda Pendiente: **$700**";
  - lista de ventas con deuda: "Venta N961 $700.00 · Venció hace 6 días · pill '$700.00 adeudados'".
  - Pie: [Compartir ▾] y [**Imprimir Ticket**].

## Preferencias → Clientes — `/settings/clients`

- **Crédito Predeterminado para Clientes:** ◉ Sin limitar / ○ Limitar por monto fijo.
- **Deuda Pendiente:** ☐ "Restringir vender a crédito a clientes con deuda vencida".
- Portal de Clientes (QR en tickets y PDF): fuera del alcance.

## Reglas observadas

- Los nombres se guardan tal como se escriben; no hay mayúsculas forzadas. Varios clientes reales tienen el teléfono dentro del nombre.
- La deuda tiene **vencimiento** ("Venció hace 6 días"). La antigüedad se agrupa en Vencida / 0 a 7 días / +7 días.
- El límite de crédito es predeterminado (global) o personalizado por cliente.

## Alcance para esta app (decisions.md D10)

- **Se incluye:** lista, búsqueda, orden, filtro por lista de precios, nuevo y editar cliente (datos básicos, lista de precios, dirección y comentarios), detalle, límite de crédito, eliminar y exportar.
- **Llegan con Ventas y Cobranza (Etapas 5 y 7):** Cantidad de Ventas, Deuda, Últimas Ventas, Últimos Cobros, Detalle de Deuda, Registrar Cobro, Estado de Cuenta y el filtro Estado de Deuda.
- **Se omite:** Datos de Facturación, Monedero, Portal de Clientes, Cotizaciones, Importar Clientes y Enviar Recordatorio por WhatsApp (se puede revisar en la Etapa 7).
