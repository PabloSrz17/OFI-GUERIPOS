# Etapa 4: clientes

Fecha: 21/11/2026. Referencia: `reference/pulpos/clients.md`, inspeccionada en Pulpos solo en lectura (D10).

## Qué se construyó

| Pieza | Archivo(s) |
|---|---|
| Migración 2: tablas `clients` y `settings` (preferencias) | `src/db/migrations.ts` |
| Repositorio de clientes: alta, edición, cambios puntuales, borrado lógico, búsqueda, orden, filtro, CSV y límite de crédito | `src/repos/clients.ts` |
| Lista de clientes `/clients` | `src/pages/clients/ClientsListPage.tsx` |
| Detalle del cliente `/clients/detail?id=` | `src/pages/clients/ClientDetailPage.tsx` |
| Modales Nuevo/Editar Cliente, Ingresar Dirección, Lista de Precios, Límite de Crédito y Comentarios | `src/components/clients/ClientDialogs.tsx` |
| Menú: nuevo grupo **Clientes**; "Ajustes de Stock" sale del menú (D9) | `src/components/layout/nav-config.ts` |

## Comportamiento

- **Lista:** busca por nombre, teléfono o email (sin distinguir acentos ni mayúsculas, mientras se escribe). Ordena por Nombre A-Z o Z-A, o por Creación (antiguos o recientes primero). Filtra por Lista de Precio. Permite seleccionar varios clientes para eliminarlos. **Exportar** descarga `clientes.csv`, que Excel abre con acentos.
- **Nuevo Cliente:** el botón Crear Cliente se habilita al escribir el nombre. El teléfono tiene un selector de país (+52 por defecto; también +1) y se guarda solo con dígitos ("555 010-2030" → "5550102030"). Si el email o el teléfono no son válidos, el error aparece en su campo. "Asignar una lista de precios" muestra un selector. "+ Añadir Dirección" abre "Ingresar Dirección", con los 32 estados de México.
- **Detalle:**
  - resumen con Ventas, Total Vendido y Deuda Pendiente, y la tarjeta Últimas Ventas;
  - tarjeta derecha con Datos Básicos (✎ editar; Ver Más muestra teléfono, email y dirección), Lista de Precios, Límite de Crédito y Comentarios ("Agregar" si está vacío);
  - **Más Acciones**, con Nueva Venta (abrirá el POS con el cliente en la Etapa 5) y Eliminar Cliente (pide confirmación).
- **Límite de crédito:** el cliente usa el predeterminado del negocio (hoy "Sin limitar") o un monto personalizado. En Pulpos el personalizado es del Plan Pro; aquí está disponible. La venta a crédito lo respetará en la Etapa 5.
- **Reglas:** UUID, outbox en la misma transacción y borrado lógico, igual que en productos. Los nombres se guardan tal como se escriben.

## Pendiente por diseño (llega con etapas posteriores)

- **Cantidad de Ventas, Deuda, Total Vendido y Últimas Ventas** salen en 0 o vacíos hasta que existan ventas (Etapa 5). En el código están marcados para reemplazarse por consultas reales.
- **Detalle de Deuda, Registrar Cobro, Estado de Cuenta y filtro "Estado de Deuda"**: Etapa 7 (Cobranza). Además, a partir de esa etapa no se podrá eliminar un cliente con deuda.
- **Preferencias → Clientes** (límite predeterminado y "Restringir vender a crédito con deuda vencida"): la tabla y la función ya existen. La pantalla se agrega junto con la venta a crédito (Etapa 5), que es cuando tiene efecto.
- **Se omite (D10):** Datos de Facturación, Monedero, Portal de Clientes, Cotizaciones, Importar Clientes y recordatorios por WhatsApp.

## Comparación con Pulpos

| Pantalla | Referencia | Esta app | Diferencias |
|---|---|---|---|
| Lista | `J-clients-list.png` | `screenshots/J-clients-list.png` | Sin "Importar Clientes" (fuera del alcance). |
| Ordenar | `J-clients-sort.png` | `screenshots/J-clients-sort.png` | Mismas 4 opciones. |
| Filtros | `J-clients-filter.png` | `screenshots/J-clients-filter.png` | Solo Lista de Precio. |
| Nuevo Cliente | `J-client-new-form.png`, `-bottom` | `screenshots/J-client-new-form.png`, `-bottom` | Sin la pestaña Datos de Facturación. La dirección capturada se muestra en el mismo formulario, con ✎ para editarla. |
| Ingresar Dirección | `J-client-new-address.png` | `screenshots/J-client-new-address.png` | Igual. |
| Detalle | `J-client-detail-nodebt.png` | `screenshots/J-client-detail-nodebt.png` | Sin Ver Portal ni Ver Estado de Cuenta (este llega en la Etapa 7), Datos de Facturación ni Monedero. |
| Ver Más | `J-client-basic-more.png` | `screenshots/J-client-basic-more.png` | También muestra teléfono y email. |
| Editar Cliente | `J-client-edit-basic.png` | `screenshots/J-client-edit-basic.png` | Mismo formulario que Nuevo Cliente. |
| Límite de Crédito | `J-client-credit-limit.png` | `screenshots/J-client-credit-limit.png` | Sin candado de Plan Pro. |
| Más Acciones | `J-client-more-actions.png` | `screenshots/J-client-more-actions.png` | Sin Crear Cotización. |

### Ajustes hechos tras comparar

- La bandera del prefijo se dibuja en SVG, porque Windows mostraba "MX" en lugar del emoji. El selector se ensanchó para que "+52" no se corte.
- Los campos de texto largo (Comentarios, Descripción) se veían de una sola línea; ahora respetan su número de renglones. Esto también corrige la Descripción del editor de productos.
- La columna Deuda va centrada y el modal de límite mide 432 px, como en Pulpos.

## Cómo verlo

```
npm run dev   →  http://localhost:1420/#/clients
```

Para cargar 10 clientes ficticios: en la consola de desarrollo, `__posDev.seedClients()`. Solo existe en modo desarrollo; se verificó que no queda en la versión final.

## Pruebas

- **Vitest, 45/45.** Incluye 8 pruebas nuevas de clientes:
  - alta con dirección y outbox;
  - validaciones;
  - búsqueda sin acentos por nombre, teléfono y email;
  - orden y paginación;
  - lista de precios y filtro;
  - límite predeterminado o personalizado;
  - edición y borrado lógico;
  - CSV;
  - migración de una base de la Etapa 3 sin perder datos.
- **Playwright, 25/25.** Incluye 4 pruebas nuevas en `e2e/clients.spec.ts`:
  - alta completa hasta el detalle, verificando lo guardado en la base;
  - validaciones del formulario;
  - editar datos, límite, lista y comentarios, y eliminar;
  - lista: buscar, ordenar, filtrar y exportar el CSV.
- **`npm run build`:** OK.
