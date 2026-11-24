# Etapa 9: respaldo, varias PCs y empaquetado

Fecha: 23/11/2026. Decisiones nuevas: D30–D34 en `reference/pulpos/decisions.md`. Todo lo de esta etapa es **diseño propio**: Pulpos guarda los datos en su nube, así que no hay pantalla equivalente que comparar.

Lo que elegiste:
- respaldo **manual + aviso diario**;
- **varias PCs con datos compartidos**, con el servidor en **la PC de mostrador**;
- sin conexión: **solo consulta, no vende**;
- **Servidor Node, sin Rust**;
- datos iniciales: **respaldo de una PC**.

## Qué se construyó

| Pieza | Archivo(s) |
|---|---|
| Protocolo de sincronización (sentencias, cambios, validación) | `src/db/sync-protocol.ts` |
| La base captura cada escritura y la manda al servidor; reintenta si otra PC escribió antes | `src/db/database.ts` |
| Cliente del servidor: copia inicial, envío, *long polling*, sin conexión y reconexión | `src/db/sync-client.ts`, `src/db/connection.ts`, `src/db/client.ts` |
| Núcleo del servidor: aplica las escrituras en orden, guarda, respalda y restaura | `src/server/core.ts` |
| Servidor HTTP (API, app, respaldo automático diario, bitácora) | `src/server/main.ts` |
| Respaldo: descargar, revisar, restaurar, aviso | `src/backup/backup.ts` |
| Preferencias → Respaldo | `src/pages/settings/BackupSettingsPage.tsx` |
| Indicador de conexión, aviso sin conexión y aviso de respaldo | `src/components/layout/Header.tsx`, `src/components/layout/StatusBanners.tsx` |
| Armado de `build/ServidorPOS/` y del .exe | `tools/build-server.mjs`, `tools/server-files/` |
| Base de prueba para la prueba integral | `tools/make-demo-db.mjs` |
| Usuario y contraseña: hash, sesiones, bloqueo por intentos (D33) | `src/server/auth.ts` |
| Inicio de sesión / crear usuario | `src/pages/LoginPage.tsx` |
| Preferencias → Acceso (cambiar contraseña) y menú del usuario (Cerrar sesión) | `src/pages/settings/AccessSettingsPage.tsx`, `src/components/layout/Header.tsx` |

## Cómo funciona con varias PCs

```
PC mostrador (servidor)                     Otras PCs
┌──────────────────────────────┐            ┌──────────────────────┐
│ ServidorPOS.exe              │  WiFi/LAN  │ Edge / Chrome        │
│  datos/pos.sqlite  (la única)│◄──────────►│ http://IP:8420       │
│  respaldos/ (1 al día, 30)   │            │ copia en memoria     │
│ Navegador: localhost:8420    │            └──────────────────────┘
└──────────────────────────────┘
```

- Al abrir, cada PC descarga la base del servidor y trabaja sobre una copia.
- **Guardar:**
  - La PC hace la operación completa (venta, cobro, corte…), captura sus cambios, la deshace y la manda al servidor.
  - Si otra PC guardó algo antes, el servidor devuelve lo que falta. La PC lo aplica y **vuelve a hacer la operación** con los datos al día. Por eso dos ventas al mismo tiempo reciben folios distintos y el stock baja dos veces.
- **Las demás PCs** reciben el cambio casi al instante, sin recargar.
- **Si una respuesta se pierde**, el reintento lleva el mismo id. La operación detecta que ya existe y no se duplica.
- **Arriba a la derecha** se ve el estado:
  - "Conectado al servidor" (verde);
  - "Sin conexión con el servidor" (rojo, con un aviso: se consulta, pero no se vende, cobra ni corta);
  - "Trabajando localmente" si se abre sin servidor, como hasta la Etapa 8.
- **Si el servidor se reinicia o se restaura un respaldo**, las PCs recargan la base solas.

## Usuario y contraseña (D33, pedido después de la entrega)

- **Todas las PCs piden iniciar sesión.** Sin sesión, el servidor no entrega ni recibe datos; solo muestra la pantalla de inicio.
- **Un usuario del negocio, `admin`.**
  - La carpeta del servidor se arma con ese usuario ya preparado, guardado solo como hash en `acceso-inicial.json`. El servidor lo copia a `datos/acceso.json` la primera vez que arranca.
  - La contraseña **no está en el código ni en GitHub**; en el disco solo queda el hash scrypt.
  - Si no hay usuario, la primera vez se crea desde la PC servidor (`localhost`). Desde otra PC solo se explica dónde hacerlo.
- **Sesión:**
  - Es una cookie que dura 30 días sin uso y sobrevive a reiniciar el servidor.
  - Tras 5 intentos fallidos, esa PC espera 5 minutos.
- **Cambiar contraseña** (menú del usuario → Cambiar contraseña, o Preferencias → Acceso): pide la actual, y las demás PCs vuelven al inicio de sesión.
- **Cerrar sesión:** menú del usuario.
- **Si se olvida la contraseña:** cierra el servidor y ejecuta `restablecer-acceso.cmd`. Borra usuarios y sesiones, no ventas. Después se crea de nuevo en `localhost`.
- **En modo local** (sin servidor) no hay inicio de sesión: los datos son de ese navegador.

## Importación desde Pulpos (D34, pedido después de la entrega)

**Qué se importa (23/11/2026, datos de las 12:00):**

| Dato | Cantidad | Detalle |
|---|---|---|
| Productos | 722 | Stock en 0 |
| Clientes | 715 | |
| Notas | 398 | 326 de noviembre por $602,655.85, y 72 de meses anteriores que tienen deuda |
| Deuda pendiente | $430,412.90 | Igual a Pulpos |
| Cortes de noviembre | 17 | |

- **No se importaron** 8 notas reembolsadas.
- **Cómo se hizo:** solo con los botones oficiales de descarga de Pulpos. No se modificó nada allá. Los archivos quedan en `importar/pulpos/`, que no se sube a git porque tiene datos reales.
- **Repetirlo al cambiar de sistema:**
  1. Haz el último corte en Pulpos.
  2. Descarga de nuevo los 5 archivos a `importar/pulpos/`: Productos, Clientes, Ventas (todas), Cortes de Caja (todos) y el reporte Detalle de Ventas desde marzo.
  3. Ejecuta `node tools/import/pulpos.mjs 2026-11`. Arma `importar/pos-desde-pulpos-*.sqlite` y un resumen con avisos.
  4. Restáuralo en Preferencias → Respaldo. Lo que había queda en `respaldos/antes-de-restaurar-*`.
- **Cómo queda lo importado:**
  - Es historial: no toca la caja ni el inventario de aquí.
  - Las deudas se cobran normalmente.
  - Las notas importadas no se pueden eliminar aquí.
  - Los cortes importados muestran lo esperado y lo contado, sin desglose.

## Tickets en la impresora del mostrador (D35, pedido después de la entrega)

- Preferencias → Tickets → **Impresora de tickets de la PC servidor**: activar, elegir la impresora (la lista sale de Windows en la PC servidor), ancho del papel y corte; "Imprimir prueba" con vista previa.
- Con eso, "Imprimir Ticket" en cualquier PC (nota, reimpresión, corte, cobro) sale en esa impresora, sin diálogo. El servidor manda ESC/POS en crudo a la cola de Windows (`src/server/printer.ts`, `src/print/escpos.ts`).
- Prueba: `e2e/multi-pc.spec.ts` con `POS_PRINT_DRYRUN` (el servidor guarda los tickets como archivos en vez de imprimir). La impresora térmica real no se pudo probar desde aquí.

## Respaldo

- **Preferencias → Respaldo:**
  - **Descargar Respaldo:** un `.sqlite` con todo.
  - **Restaurar:** valida el archivo, muestra cuántas ventas, productos y clientes trae y pide confirmación. Antes se guarda lo que había: en el servidor, en `respaldos/antes-de-restaurar-*`; sin servidor, como descarga.
  - **Respaldos en el servidor:** se pueden descargar desde aquí.
- **Aviso diario:** si hay ventas y pasaron más de 24 h sin descargar un respaldo, aparece una franja ámbar (no en el punto de venta). Se puede descargar ahí mismo o posponer con ✕ (vuelve en la siguiente sesión).
- **Automático:** el servidor guarda uno al día en `respaldos/` y conserva los últimos 30.
- Escritura segura: la base se escribe a un archivo temporal, se fuerza al disco y se renombra. Un apagón no deja una base a medias.

## Instalación (en `build/ServidorPOS/LEEME.txt`)

1. **En esta PC de desarrollo:**

   ```
   npm run build:server
   ```

   Esto arma `build/ServidorPOS/`: el .exe (~100 MB), la app, el motor SQLite, `instalar.cmd`, `desinstalar.cmd` y `LEEME.txt`.
2. **En la PC de mostrador:**
   - Copia la carpeta a `C:\ServidorPOS` y haz doble clic en `instalar.cmd`. Esto deja el servidor arrancando con Windows y crea "Abrir POS" en el escritorio; no pide administrador.
   - Una vez, en PowerShell **como administrador**:

     ```
     New-NetFirewallRule -DisplayName "Servidor POS" -Direction Inbound -Protocol TCP -LocalPort 8420 -Profile Private -Action Allow
     ```

     Yo no lo ejecuto porque cambia la seguridad de Windows.
3. **Pasar los datos actuales:**
   - En la PC donde ya usabas el POS, ve a Preferencias → Respaldo → Descargar Respaldo. Hoy la PC de mostrador lo abre en `http://192.168.1.141:1420`, el servidor de desarrollo de esta PC; los datos están en el navegador de la PC de mostrador.
   - En `http://localhost:8420`: Preferencias → Respaldo → Elegir Archivo… → Restaurar.
   - Ojo: los datos de `:1420` y de `:8420` son distintos aunque sea la misma PC, porque cada dirección tiene su propio almacenamiento en el navegador.
4. **Las otras PCs:** abre la dirección "En la red" que muestra la ventana del servidor (`http://<IP de la PC de mostrador>:8420`) y guárdala en favoritos.

## Reglas que se garantizan (con prueba)

- Una venta de una PC aparece en la otra sin recargar.
- Dos ventas simultáneas dan folios distintos, y el stock baja por las dos.
- Un cambio que llega dos veces (consulta atrasada) no se aplica dos veces.
- Una respuesta perdida seguida de un reintento con el mismo id no duplica la venta.
- Sin conexión no se guarda nada; al volver, se reconecta y se vende.
- Los cobros también se comparten.
- **El servidor rechaza sentencias que no sean INSERT/UPDATE/DELETE.** Los triggers siguen impidiendo modificar ventas, cortes y movimientos.
- La base persiste y se vuelve a abrir igual.
- Restaurar un respaldo hace que todas las PCs recarguen.
- **Un archivo que no es respaldo se rechaza.** Un respaldo de una versión más nueva también; uno más viejo se actualiza al abrirlo.
- El aviso aparece solo con ventas y más de 24 h sin respaldo.

## Capturas (`screenshots/`)

| Captura | Qué muestra |
|---|---|
| `P-connected.png` | PC conectada al servidor (indicador verde). |
| `P-shared-sales.png` | La PC B ve las ventas de A, incluidas las simultáneas. |
| `P-offline.png` | Servidor apagado: aviso rojo y la venta no se guarda. |
| `P-backup-reminder.png` | Aviso de respaldo y Preferencias → Respaldo con el servidor (respaldo automático en la tabla). |
| `P-backup-server.png` | Después de descargar: "Último respaldo descargado: Hoy". |
| `P-restore-confirm.png` | Confirmación de restaurar con el resumen del archivo. |
| `P-backup-local.png` | Respaldo sin servidor ("Los datos están en este navegador"). |
| `P-setup.png` | Crear el usuario la primera vez, en la PC servidor. |
| `P-login.png` | Inicio de sesión con contraseña incorrecta. |
| `P-access.png` | Preferencias → Acceso después de cambiar la contraseña. |

## Pendiente o fuera

- **Un solo usuario**, sin usuarios por cajero ni permisos (no se pidieron).
- **La conexión no va cifrada** (http dentro de la red local). Conviene WiFi con contraseña y separar la red de clientes.
- **Ventas sin conexión:** no se hacen, por decisión (D30).
- **El Inicio** sigue con datos de ejemplo (pendiente desde la Etapa 8).
- **Tauri / app de escritorio con Rust:** sustituida por el Servidor POS (D32). La carpeta `src-tauri/` queda sin usar.
- **Ejecutar `instalar.cmd` y crear la regla del firewall en la PC real:** te toca a ti. Los accesos directos se probaron en una carpeta temporal, no en tu Inicio de Windows.

## Pruebas

- **Vitest, 112/112.** `tsc` OK. Pruebas nuevas en esta etapa:
  - `src/server/sync.test.ts` (9): las reglas anteriores, con dos PCs simuladas contra el núcleo del servidor.
  - `src/backup/backup.test.ts` (4): cuándo aparece el aviso.
  - `src/server/auth.test.ts` (7):
    - el primer usuario se crea una vez y se guarda solo el hash;
    - validaciones;
    - inicio de sesión, y la sesión sobrevive a reabrir;
    - bloqueo tras 5 intentos;
    - vencimiento a 30 días;
    - cambiar la contraseña cierra las demás sesiones;
    - cookie.
- **Playwright, 44/44** (`npm run e2e`; la de varias PCs corre si el servidor está armado con `npm run e2e:server`):
  - `e2e/multi-pc.spec.ts` corre contra el **servidor real ya armado** con dos navegadores. Recorre la API protegida sin sesión, crear el usuario en la PC servidor, iniciar sesión con contraseña incorrecta y correcta, conexión, venta compartida, ventas simultáneas, servidor apagado, reconexión, aviso, descarga, restaurar y recarga de la otra PC. Al final, cambia la contraseña (la otra PC vuelve al inicio de sesión) y cierra sesión. Se corre con `npm run e2e:server`. Si el servidor no está armado, se salta.
  - `e2e/backup.spec.ts`: el respaldo sin servidor, que recorre aviso, descarga, restaurar (N2 desaparece y se descarga la copia previa) y archivo inválido.
- **`npm run build:server`:** OK. `ServidorPOS.exe` arrancó en una carpeta temporal: creó la base y su respaldo automático, y sirvió la app y la API.
