# G. Caja y H. Aperturas y cierres (Cortes)

Capturas: `G-cash-current.png`, `G-cash-expected-breakdown.png`, `G-cash-in-modal.png`, `G-cash-out-modal.png`, `H-cash-history.png`, `H-cash-cut-detail.png`, `H-settings-cashiers.png`.

## Modelo observado: la caja no se "abre", se "corta"

- **No existe un botón ni una pantalla de "Apertura de caja".** La caja (por defecto "Caja Principal") está **siempre activa** y acumula movimientos hasta que se hace un **Corte de Caja**.
- **El corte equivale al cierre del turno.** Su detalle muestra:
  - Efectivo **Al inicio**
  - **Retiro por corte**: el efectivo que se retira al cerrar
  - **Restante en caja**: lo que queda como fondo del siguiente periodo
- **El "Efectivo al inicio" del periodo actual = el "Restante en caja" del corte anterior.** En esta cuenta es $0.00, porque el usuario retira todo en cada corte. Es una deducción: confirmarla requiere hacer un corte real.
- La configuración está en Preferencias → **Cajas Registradoras** (`/settings/cashiers`): "Configura tus cajas para llevar un control del dinero que circula en cada caja". Hay una tabla de cajas con "Caja Principal (Por defecto)", [Editar] y [Agregar Caja / Agregar Nueva].

## G. Caja actual — `/cashier-audits/current`

- **Encabezado:** "Caja Principal" con el subtítulo "Registra ingresos y egresos en efectivo de tu caja chica". Botones: [↑ Ingresar Efectivo], [↓ Retirar Efectivo] y [🧮 **Hacer Corte de Caja**] (primario).
- **Tarjeta "Total Esperado"**, con una fila por método de pago (icono de color + nombre + monto):
  - Efectivo
  - Tarjeta de Crédito
  - Tarjeta de Débito
  - Transferencia
  - **Total** (fila de pie con fondo gray-50)

  Cada monto es un **botón**: abre el modal de desglose.
- **Tarjeta "Ingresos y Retiros de Efectivo":** tabla Vendedor | Movimiento (pill **Ingreso** verde / **Retiro** rojo) | Valor (+$6,530.00 / −$900.00) | Detalles (el motivo capturado) | 🗑 (eliminar el movimiento; no se probó).
- **Barra lateral, tarjeta "Efectivo":** "Al inicio $0.00".

### Modal "Total Esperado en Efectivo"

- Segmentado **Resumen | Detalle de Movimientos** (solo se vio Resumen).
- **Resumen**, con iconos ↑ verde y ↓ rojo:
  ```
  Efectivo al inicio            $0
  Ventas (En Efectivo)          +$5,873
  Cobros de Crédito (En Efectivo) +$977
  Ingresos (En Efectivo)        +$7,371
  Retiros (En Efectivo)         -$1,270
  Devoluciones (En Efectivo)    -$0
  Compras y Gastos (En Efectivo) -$0
  ─────────────────────────────
  Total Esperado                $12,951
  ```
- **Fórmula:** esperado = inicio + ventas + cobros de crédito + ingresos − retiros − devoluciones − compras y gastos, todo **por método de pago**.

### Modales Ingresar / Retirar Efectivo

| Modal | Campos | Botones |
|---|---|---|
| "Ingresar Efectivo a Caja" | **Monto** ($), **Motivo (opcional)**: "Ej: Reposición de billetes"; "Realizado por <usuario>" (solo lectura) | Cancelar / **Confirmar** (deshabilitado sin monto) |
| "Retirar Efectivo de Caja" | Monto ($), Motivo (opcional): "Ej. Pago de luz"; Realizado por | Cancelar / **Confirmar** |

## H. Cortes Históricos — `/cashier-audits/history`

- **Encabezado:** "Cortes de Caja", con el subtítulo "Al finalizar cada turno haz un recuento de tu efectivo y otros pagos y compáralos con lo registrado en Pulpos." Botones: [Exportar] y [**Hacer Corte de Caja**].
- Buscador "Buscar por caja o vendedor", [Filtrar] y [Ordenar ▾].
- **Tabla:** ☐ | **Fecha** (enlace: "Ayer a las 17:07", "19/11/2026 17:33:01") | **Caja** | **Realizado por** | **Total Esperado** | **Diferencia** ("Sin diferencia") | **Comentarios**.
- Paginación. Hay aproximadamente un corte diario, entre las 14:30 y las 17:30.

### Detalle de corte — `/cashier-audits/detail?id=…`

- **Encabezado:** ← "Detalle de Corte de Caja", con [Más Acciones ▾], [⇅ Ver Movimientos] y [🖨 **Imprimir Ticket**] (primario).
- **Tabla de conciliación:** método | **Recuento Manual** | **Total Esperado** (botón con desglose) | **Diferencia**. Una fila por método más la fila Total.
- **"Ingresos y Retiros de Efectivo"** del periodo: Vendedor | Movimiento | Valor | Detalles.
- **Barra lateral:**
  - **Información:** "Caja Principal" y "20 de noviembre de 2026 a las 5:07:58 p.m.".
  - **Efectivo:** Al inicio $0.00 · **Retiro por corte** $15,245.50 · **Restante en caja** $0.00.

### Hacer Corte de Caja — ❌ no observado

El botón no se pulsó para no arriesgar un corte real. Por el detalle del corte se deduce que el formulario debe pedir:

1. El **recuento manual** por método de pago (al menos efectivo; probablemente también tarjeta y transferencia).
2. El **retiro por corte** (o el restante en caja).
3. **Comentarios.**

Y que muestra la diferencia contra lo esperado. **Pendiente de verificar con autorización expresa.**

## Reglas para el sistema propio

- La caja acumula movimientos: venta (por método), cobro de crédito, ingreso, retiro, devolución y gasto.
- El corte **congela** el esperado, guarda el recuento y la diferencia, registra el retiro y deja un remanente que será el "inicio" del siguiente periodo.
- Si se quiere una "apertura" explícita (fondo inicial capturado), sería **una mejora sobre Pulpos**, no algo observado. Hay que decidirlo en el diseño.
