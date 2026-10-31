# Oficina Virtual & Dashboard Logístico

Sistema local para gestionar los viajes de materiales (polvo, grava, piedra, escombro, cemento…): un tablero Kanban con oficina virtual en pixel art, notas de **Pulpos** importadas solas por un robot y notas de **SICAR** capturadas por texto.

## Estado del proyecto

| Paso del PRD | Estado |
|---|---|
| **1. Fundación**: Express + SQLite + Oficina Virtual + Kanban | ✅ Completo |
| **2. El Rutas**: estados, camioncito animado, WhatsApp | ✅ Completo: 4 estados con arrastre y botones, "Regresar", confirmación antes de En Ruta, camioncito animado y aviso por WhatsApp (una sola vez por nota) |
| **3. El Chasis**: entrada de ventas | 🟡 Hecho: robot de Pulpos y captura de SICAR por texto. Falta: SICAR automático (ver [SICAR](#sicar)) |
| **Módulo 3: Google Sheets** | ✅ Completo: cada entrega se anota sola en "FORMATO DE REPARTO" (pestaña por mes, franja por día, tu formato corto de materiales) |
| **4. El Inspector**: cotizaciones | ✅ Completo: arma la cotización con la lista de precios y el flete por colonia, pregunta "¿Está correcta?" en la Oficina, aprende precios y fletes nuevos, genera imagen tipo Excel y la manda por WhatsApp |

## Requisitos

- Windows con Node.js **22.9 o superior** (instalado: 26 LTS).
- Internet para el robot de Pulpos.
- Red Wi-Fi local para entrar desde otros equipos o el celular.

## Instalación

```bash
npm install
copy .env.example .env        # y ajusta los valores (ver Configuración)
npm run seed:choferes         # carga choferes (edita la lista en src/db/seed.js)
npm run pulpos:login          # una sola vez: inicia sesión en Pulpos en la ventana que se abre y ciérrala
npm run inicio:instalar       # arranque automático al iniciar sesión en Windows
```

## Arranque automático

`npm run inicio:instalar` pone el acceso directo **"Oficina Virtual"** en la carpeta Inicio de Windows (no requiere administrador). Al iniciar sesión:

1. `scripts/iniciar-oficina.vbs` lanza, sin abrir ninguna ventana, `scripts/iniciar-oficina.ps1`.
2. Ese script es un **vigilante**: arranca el servidor y, si se cae, lo vuelve a arrancar en 10 segundos. Antes de cada arranque cierra navegadores del robot que hayan quedado huérfanos. Si ya hay una Oficina Virtual en el puerto, no abre otra.
3. Todo queda en `data/logs/oficina.log` (al pasar de 5 MB se renombra a `oficina.log.anterior`).

| Para… | Comando |
|---|---|
| Detener (p. ej. antes de `pulpos:login`) | `npm run oficina:detener` |
| Volver a arrancar sin reiniciar la PC | doble clic en `scripts/iniciar-oficina.vbs` |
| Quitar el arranque automático | `npm run inicio:quitar` |
| Probar sin vigilante (desarrollo) | `npm start` o `npm run dev` |

La PC tiene que estar encendida, con sesión iniciada y sin suspenderse para que el robot de Pulpos siga trabajando.

Abre `http://localhost:3000`. Desde otro equipo o el celular usa la IP que muestra la consola (ej. `http://192.168.1.141:3000`). Si no carga, permite Node.js en el Firewall de Windows para redes privadas.

**Navegador del robot.** npm 11 bloquea los scripts de instalación por defecto. El de puppeteer ya está aprobado en `package.json`. Si el robot dice que no encuentra Chrome, instálalo con:

```bash
npx puppeteer browsers install chrome
```

Si esa descarga se corta (pasó con la VPN activa), baja el zip de *Chrome for Testing* de la versión que pide el error y descomprímelo en `%USERPROFILE%\.cache\puppeteer\chrome\win64-<versión>\`.

## Uso diario

### Tablero

**Pendiente → Cargando → En Ruta → Entregado hoy**

| En la columna | Botón | Requisito |
|---|---|---|
| Pendiente | **Empezar a cargar ▶** | Elegir **chofer y camión** (se eligen por separado: no siempre va el mismo chofer en el mismo camión) |
| Cargando | **Enviar a ruta ▶** | Confirmar en la ventana "¿Enviar a ruta?" |
| En Ruta | **Marcar entregado ✔** | — |

- **Arrastrar** una tarjeta a otra columna hace lo mismo que los botones. Se marcan con línea punteada las columnas permitidas (un paso adelante o atrás). En celular se usan los botones.
- **↩ Regresar** (todas menos Pendiente) deshace el último paso y queda en el historial.
- La **confirmación de salida a ruta** muestra folio, cliente, material, dirección y chofer, y tiene el campo **📱 WhatsApp del cliente** para escribir o corregir el teléfono (se guarda en el cliente). Si el número está mal escrito no deja confirmar. El botón seleccionado de inicio es *Cancelar*. El servidor rechaza (HTTP 428) cualquier paso a En Ruta sin `confirmado: true`.
- Al pasar a En Ruta, **el camioncito sale de la bodega** con el folio en un letrero. Se ve también en otros equipos con la Oficina abierta.
- Cada tarjeta muestra el teléfono del cliente y, después de salir a ruta, el estado del aviso: 💬 enviado, ⏳ pendiente, sin teléfono, número sin WhatsApp o ⚠️ falló.
- Chofer y camión se pueden cambiar en Pendiente y en Cargando. La flota (choferes y camiones) está en `src/db/seed.js`. Los choferes que ya no trabajan se desactivan (`activo = 0`), no se borran, para no perder el historial.
- La hora de cada tarjeta es la **hora de la venta** en el sistema de origen. Si no es de hoy, también muestra el día.
- Entregado muestra solo lo entregado hoy. La etiqueta **PS** (Pulpos) o **SC** (SICAR) indica de dónde vino la nota.
- **Notas PS:** el robot lee todas las ventas de Pulpos cada minuto y sube las que tienen "Envío a Domicilio" o un servicio de envío, aunque en Pulpos ya estén marcadas como entregadas. Las de mostrador se ignoran.
- **Renglones de Pulpos:** se lee cualquier renglón que termine en un importe (`6`, `0.5 metro.`, `1 lata.`, `1/2`). Lo leído se compara con el Subtotal de la venta; si no cuadra, la tarjeta dice **⚠️ REVISAR EN PULPOS** y la insignia se pone en rojo. Si no se lee nada, la nota entra igual con "VER EN PULPOS". Cada venta queda en `data/logs/pulpos-auditoria.log`, con el texto de Pulpos y lo leído. Las ventas devueltas o canceladas en Pulpos no entran; si ya estaban en el tablero, la insignia avisa.
- **Rescate con Sulema:** en su chat, "rescata la nota N946" o "por qué no tienes la N946" la trae de Pulpos a Pendiente; "qué notas de Pulpos no tienes" las lista. Una nota sin dirección lleva **⚠️ Sin Dirección** y **📍 Completar dirección** (también en el panel de Sulema), y no puede salir a ruta hasta tenerla. Sulema sólo agrega notas: no borra, no cambia otras, ni le escribe al cliente.
- **Aviso al cliente:** al salir **En Ruta** recibe "va en camino" con todos sus materiales, una sola vez por nota. Usa el teléfono de la nota o, si no trae, el del cliente. Al cargar o al recoger en almacén no se le manda nada.
- **Nueva cotización:** cliente, WhatsApp, un renglón por artículo y colonia. **Generar y Enviar** arma la cotización con sus precios para revisarla; sale hasta dar **Aceptar y Enviar**. Pedido en bolsas no toma el precio por m³: lo pide.
- **Etiqueta SC / SALIDA:** una nota capturada a mano con folio de N001 a N1000 muestra **SALIDA** (roja); las demás, **SC**. Un clic en la etiqueta la cambia y queda guardada.
- **B y CB:** al capturar o editar, `10 b polvo cb` queda como **10 BOLSAS POLVO CON BOLSA**. En la hoja de reparto se sigue anotando corto: `10 B POLVO C/B`. "bulto" es otra unidad. Los nombres que trae Pulpos no se cambian.
- **ALMACÉN** en la lista de choferes: el cliente recoge en bodega. No pide camión, pasa de Cargando a Entregado sin En Ruta, no manda el WhatsApp de "va en camino" y no se registra en la hoja de reparto.
- **Imagen del ticket en Nueva nota** (panel de Sulema): pégala con Ctrl + V o arrástrala. Tesseract la lee en el navegador, sin internet ni costo, y llena sólo los campos que encuentra; nada se guarda sin revisarlo. El PDF de SICAR se lee completo: artículos, cliente, celular, dirección y total (sumado de los importes; si no cuadran, avisa y no lo llena). De la foto del ticket impreso sólo llena folio, hora y lo que lea de dirección y cliente: artículos y total van a mano, porque ahí se pierden renglones y cambian cantidades. No sirve para letra a mano. Compara siempre contra el ticket. La imagen no se guarda. Reglas de lectura en `public/js/leer-ticket.js`.
- **✂ Envío parcial** (tarjeta en Pendiente o Cargando): escribes lo que va en este viaje. La nota se queda sólo con eso, y es lo que dice el WhatsApp y la hoja de reparto. Lo que falta pasa a **Saldos Pendientes** con los datos del cliente y el folio original más `-S1`, `-S2`…, porque la hoja ubica cada renglón por folio y día. Con 0 en todo, la nota entera pasa a Saldos. El total se queda en la nota original. Si esa nota ya tiene saldo, la ventana lo muestra: al subir la cantidad se resta de la tarjeta de Saldos, al bajarla se le suma, y si el viaje se lleva todo la tarjeta se cierra. El tope es lo del viaje más lo del saldo.
- **Re-programar en Pendientes 🚚** regresa el saldo a Pendiente, sin chofer ni camión, para repartirlo como cualquier nota. Las notas de Saldos no cuentan como Pendiente y sobreviven al Cierre de Jornada.
- **Inventario:** la Oficina no lleva existencias; están en Pulpos y SICAR, que sólo se leen. El envío parcial no cambia el stock de esos sistemas.
- **🌙 Cierre de Jornada** (barra superior) pasa lo entregado al historial; Saldos, Pendiente, Cargando y En Ruta se quedan igual. **📚 Historial** está en la ventana de Notas Pendientes y muestra las últimas 200 entregadas.
- **✎ Editar** en la tarjeta cambia cualquier dato en cualquier columna: folio, cliente, teléfono, artículos (agregar, quitar, fracciones), dirección, zona, total, chofer y camión. En una nota entregada no se actualiza el renglón que ya está en la hoja de reparto.

### Agentes de la oficina

- **El Chasis**: notas por despachar. Se pone en **alerta** si un conector falla (por ejemplo, la sesión de Pulpos se cerró).
- **El Rutas**: notas cargando y viajes en ruta. Se pone en **alerta** si WhatsApp está desconectado o si hay notas pendientes sin chofer.
- **El Inspector**: clientes y entregas del día.
- En la barra superior, **Pulpos**, **SICAR** y **WhatsApp** (✓/✗/–) muestran el estado de cada conector. El detalle aparece al pasar el mouse; la de WhatsApp lleva a la página de vinculación.

### Capturar una nota de SICAR

En la caja **"✍ Escríbele a El Chasis una nota de SICAR"** escribe una línea separada por comas:

```
33219, Luis Roman, 7 m3 polvo + 10 bultos cemento, Calle 5 #20 Centro, $3,500, 10:25
```

- **Obligatorio y en orden:** folio, cliente, productos, dirección. La dirección puede llevar comas.
- **Opcional, al final y en cualquier orden:** total con `$`, hora de la venta (`HH:MM`) y teléfono del cliente (`tel 981 196 5122`; también se detecta si va dentro de la dirección). Sin hora se usa la hora actual.
- **Varios productos** se separan con `+`.
- **Unidades:** `m3`, `metros cúbicos`, `pz`, `bultos`, `viajes`, `kg`, `ton`. Sin unidad, los materiales a granel (polvo, grava, piedra, arena, escombro, tepetate…) quedan en m³ y lo demás en piezas.
- **Revisar** muestra una vista previa. Nada se guarda hasta presionar **Guardar en Pendiente**. No se puede repetir un folio que ya está en el tablero.

La cantidad acepta fracciones y texto libre (`1/2 m3 grava`, `1 1/2 bultos cal`, `media carga grava`). Antes de guardar, la vista previa deja corregir cantidad, unidad y descripción de cada producto.

### Cotizar con El Inspector

En **"🧮 Pídele a El Inspector una cotización"** escribe:

```
Construcomer, 7 m3 polvo + 10 cemento maya + 2 armex castillo, Pensiones, tel 981 118 3096
```

- **Orden:** cliente, productos (separados con `+`), colonia. Opcional: teléfono (para mandarla por WhatsApp). "col." o "colonia de" se quitan del nombre.
- Los productos se buscan en la **lista de precios** por palabras completas ("cal" no es "calle"; "cemento maya" gana sobre "maya"). Escríbelos como en la lista. "Cemento" solo no basta: di cuál.
- Sale la tabla editable con la pregunta **"🧐 ¿Está correcta esta cotización?"**. Lo que no conoce (producto nuevo o colonia sin flete) aparece **en amarillo**, y "Sí, aprobar" se activa hasta que todo tiene precio.
- **Aprende al aprobar:** los productos nuevos se agregan a la lista, el flete de la colonia se guarda y, con la casilla "Guardar precios nuevos o corregidos" marcada, los precios cambiados se actualizan. La Oficina dice qué aprendió ("🧠 Aprendí: …").
- **Imagen tipo Excel** (sin nombre ni logo): folio C-0001…, fecha, cliente, colonia, partidas y total. Se descarga o, con la casilla "Mandársela por WhatsApp", se envía al cliente. "Últimas cotizaciones" lista las 10 más recientes.
- **Flete opcional:** sin precio o en $0 no aparece en la cotización ni en su imagen. En las notas de Pulpos tampoco se anota el envío en $0.
- **Bienvenida automática por WhatsApp** (`src/integraciones/inspector/solicitudes.js`, texto en `whatsapp/mensajes.js`): al primer mensaje o pregunta suelta en un chat privado de texto saluda con "buenos días", "buenas tardes" (desde las 12) o "buenas noches" (desde las 19) y pide material, colonia/poblado y método de pago. **Nunca lleva precios.** Máximo una cada 24 horas por número. No se manda a choferes registrados, ni a quien recibió de nosotros una cotización, recordatorio o aviso de ruta en las últimas 24 horas, ni a mensajes atrasados más de 5 minutos.
- **Cotizaciones por autorizar (tarjetas en el Pizarrón):** los mensajes de cada número se juntan (tabla `conversaciones_whatsapp`) y Claude Haiku saca productos, cantidades, colonia, pago y nombre, si el texto menciona material o si ya se le pidieron los datos. Con los tres datos, o con productos cuando ya hablamos con él en las últimas 24 horas, sale una tarjeta con el borrador calculado (tabla `solicitudes_whatsapp`); si manda más datos, se actualiza la misma tarjeta, sin pisar lo que ya editaste. Todo se puede cambiar ahí mismo. **[Aceptar y Enviar]** guarda y manda la imagen; se activa cuando todo tiene cantidad y precio, y si WhatsApp está desconectado no se envía nada y la tarjeta se queda. **El precio solo sale con ese clic.**
- **Seguimiento a las 24 horas** (`inspector/seguimiento.js`, revisa cada minuto): al salir la cotización se guarda `enviada_en` y `seguimiento_para`. Si sigue sin marcarse, manda "Buenas tardes, ¿qué le pareció la cotización? ¿Algo más en lo que podamos ayudarle?". En "Últimas cotizaciones", **💰 Pagada** o **🚫 Cerrar** cancelan el recordatorio y **↩ Deshacer** lo reactiva. Si la PC estaba apagada, sale al volver a conectar.
- **Cuándo atiende Chatito:** sólo si el cliente escribe "necesito material", "requiero material", "cotización", "cotizar", "cotiza", "cotízame" o "presupuesto" (sin importar mayúsculas ni acentos), por texto o en el pie de una foto. Lo demás queda para la atención manual. Quien ya pidió cotización puede seguir contestando sin repetir la palabra. Si manda la lista o una foto y en menos de 2 minutos escribe la palabra, se junta todo; esos mensajes esperan sólo en memoria, y se pierden si la Oficina se reinicia en ese momento. Las palabras están en `DISPARADORES` de `solicitudes.js`.
- **Fotos:** si el cliente manda por WhatsApp la foto de una lista o nota de materiales, la IA la transcribe (también fracciones) y sale una tarjeta por autorizar con la foto al lado; un clic la amplía y otro la pone a tamaño real. **Pasar a Notas** la manda a Pendiente con folio `WA-n` y sin avisarle nada al cliente. Las fotos que no son pedidos se ignoran. Se guardan en `data/fotos/`.
- **Reporte:** pregúntale a El Inspector en su chat, por ejemplo "¿cuántas cotizaciones se hicieron ventas hoy y de cuánto fue el total?". Cuenta las marcadas como Pagadas el día de `pagada_en`.
- Lista inicial: Polvo y Grava $550/m³ · Cemento Maya $150 · Cemento Apasco y Holcim $130 (bulto 25 kg) · Cal $110 · Armex de castillo y de cadena $195.

### La oficina: áreas, agentes y Pizarrón

> **Nombres:** en pantalla, El Chasis ahora es **Sulema**, El Inspector es **Chatito Waspat** y El Rutas es **Gerente de Logística**. En el código y la base siguen los ids `chasis`, `inspector` y `rutas`.
>
> **Pantalla principal:** solo la maqueta 3D, en tonos cálidos. Al dar clic: **Sulema** abre la captura de SICAR, **Chatito Waspat** las cotizaciones por autorizar y el cotizador, **Gerente de Logística** un botón a Notas Pendientes; todos con su chat. **Notas Pendientes** abre el tablero de notas, **Pendientes del Día** los avisos y tareas del equipo, y **Asistencias** la lista. Alarma sobre la cabeza: Sulema (notas nuevas o conector caído), Gerente de Logística (notas sin chofer o camión, WhatsApp caído), Chatito Waspat (cotizaciones por autorizar). De lunes a sábado desde las 10:00, mientras falte alguien por marcar, sale un aviso emergente y un globo en la Pizarra de Asistencias (`src/integraciones/recordatorio-lista.js`, `asistencia_pendiente` en `/api/resumen`).


- **Maqueta 3D isométrica** (three.js, `public/js/escena3d.js`, servido local desde `node_modules` sin internet): caseta de oficina con muros, ventanal y los 3 escritorios (**Ventas · Mostrador**: El Chasis; **Logística · Fletes**: El Rutas; **Cotizaciones**: El Inspector), y al lado el **patio de materiales** con bodega, montones y la flota en 3D. Cada camión muestra su estado (En patio / Cargando / En ruta, según sus notas) y, al salir una nota a ruta, su camión arranca y sale del patio. Las etiquetas flotantes son HTML (CSS2DRenderer) y al dar clic en ellas o en el monito se abre su panel. Para mover lugares o colores: `PUESTOS`, `ESTACIONAMIENTO` y `ROPA` en `escena3d.js`.
- **Estado de cada agente:** 🟢 **Disponible**, 🟡 **Procesando** (tiene trabajo o te está contestando) y 🔴 **En espera** (necesita a un humano: conector caído, WhatsApp sin conexión, notas sin chofer o camión).
- **Pizarrón de la Oficina:** pendientes del equipo humano (tabla `chalkboard`). Se anotan con nombre (lo recuerda cada navegador) y se marcan como listos con la palomita. **Borrar pide dos clics:** el primero convierte la × en un botón rojo "¿Borrar?" que se desarma solo a los 3 s; el segundo borra. Los completados se ven el mismo día y desaparecen al siguiente.
- **Tiempo real:** `GET /api/eventos` (Server-Sent Events) avisa a todas las pantallas abiertas cuando cambian notas, asignaciones, cotizaciones o el Pizarrón, y se actualizan al instante. Queda un refresco de respaldo cada 60 s.

### Preguntarle a un agente (IA)

**Da clic en un agente** y se abre su panel con su rol, su estado, lo que está haciendo y un chat ("Escríbele a El Rutas…"). Pregunta en español: "¿qué camión llevó la N923?", "¿cuánto vendimos hoy en Pulpos?", "¿cuánto cuesta el armex de castillo?". Enter envía; Shift+Enter hace salto de línea. La conversación se guarda en la base (`agentes_chat`), así que sigue ahí al cerrar el panel o recargar, y es la misma en todas las PCs.

- **Modelo:** Claude Haiku 5.5 (`claude-haiku-5-5`, effort `low`). Necesita `ANTHROPIC_API_KEY` en `.env`.
- **Solo lectura:** cada agente consulta la base con una conexión de solo lectura y únicamente las tablas de su área (`src/integraciones/agentes/agentes.js`, `AGENTES`). Se rechazan escrituras, varias consultas juntas y tablas de otra área. Si la pregunta no es de su área, dice a qué agente le toca.
- **Memoria:** "recuerda que…" se guarda en `agentes_memoria` y se le da al agente en cada pregunta. Para borrar un recuerdo, por ahora se borra en esa tabla.
- **Privacidad:** la pregunta y los datos que consulta el agente se envían a Anthropic para responder.

## Pulpos (robot)

Pulpos no tiene API ni webhooks, así que un navegador oculto (puppeteer) hace lo mismo que harías tú en la página:

1. Cada `PULPOS_INTERVALO_MIN` minutos abre **Ventas → No Entregadas** (`app.pulpos.com/sales?st=DELIVERY_PENDING`).
2. Por cada folio nuevo abre el detalle y lee productos, forma de entrega, dirección ("Enviar a:"), cliente y total.
3. Importa solo ventas con **Envío a Domicilio** (`PULPOS_SOLO_ENVIOS=true`). Las de recoger en tienda se marcan como omitidas.
4. Solo importa ventas **desde el día en que se activó el robot**. La fecha se guarda en la tabla `ajustes` (`pulpos_importar_desde`); así no entran los cientos de pendientes históricos.
5. Cada folio entra una sola vez (tabla `integracion_vistos`).

**Si se cierra la sesión de Pulpos:** El Chasis se pone en alerta. Corre `npm run oficina:detener` y después `npm run pulpos:login`. Inicia sesión, cierra la ventana y vuelve a arrancar con doble clic en `scripts/iniciar-oficina.vbs`. El robot y el login usan el mismo perfil (`data/pulpos-perfil/`), así que no pueden correr a la vez.

**Si Pulpos cambia el diseño de su página,** el robot puede dejar de leerla. El Chasis avisa con el error. El lector está en `src/integraciones/pulpos/parser.js` y se guía por etiquetas visibles ("Forma de Entrega", "Enviar a:"), no por clases CSS.

**Teléfono:** en Pulpos el equipo lo anota dentro de la dirección de envío ("C. PABLO GARCIA 981 196 5122…"). El robot lo toma de ahí (`src/lib/telefono.js`). Al arrancar, los clientes sin teléfono se completan con lo que traigan sus direcciones.

## WhatsApp

Al pasar una nota a **En Ruta**, se manda al cliente un mensaje de "tu pedido va en camino" desde el **número del negocio**, conectado como dispositivo vinculado (como WhatsApp Web) con `whatsapp-web.js`.

- **Vincular (una vez):** con `WHATSAPP_ACTIVO=true`, abre `http://localhost:3000/whatsapp.html` y escanea el QR desde el celular del negocio (Configuración → Dispositivos vinculados → Vincular un dispositivo). La sesión queda en `data/whatsapp-sesion/` y sobrevive a reinicios.
- **Tu celular y tu WhatsApp Web siguen funcionando.** Los avisos aparecen ahí como enviados por ti y las respuestas de los clientes te llegan normal. La Oficina no lee ni contesta mensajes.
- **Nunca dos veces:** cada aviso queda en `whatsapp_envios` (único por nota). Si la nota regresa de En Ruta y vuelve a salir, no se manda otro.
- **Si WhatsApp está desconectado,** el aviso queda ⏳ pendiente y se manda al reconectar, si la nota sigue En Ruta y es de las últimas 6 horas.
- **Texto del mensaje:** `src/integraciones/whatsapp/mensajes.js` (reinicia la Oficina después de editarlo).
- **Para desvincular:** en el celular, Dispositivos vinculados → cerrar sesión de ese dispositivo.
- La librería se presenta como el Chrome real (148, Windows). Con la identidad por defecto (Chrome 101 de Mac), WhatsApp rechazaba la vinculación.
- **Envío de imágenes (cotizaciones):** whatsapp-web.js 1.34.7 falla con "Data passed to getter must include an id property" ([issue #201922](https://github.com/wwebjs/whatsapp-web.js/issues/201922)). El arreglo oficial ([PR #201923](https://github.com/wwebjs/whatsapp-web.js/pull/201923)) aún no está publicado. `cliente.js` lo aplica **en memoria** en cada conexión (vuelve no enumerable `__x_id`), sin modificar archivos de `node_modules`. Al actualizar la librería a una versión con el arreglo, `corregirEnvioDeImagenes()` se puede quitar.
- **Riesgo:** no es una API oficial de WhatsApp. Con pocos avisos transaccionales el riesgo es bajo, pero WhatsApp puede bloquear números que usan automatización.

## Google Sheets: FORMATO DE REPARTO

Al marcar una nota como **Entregado** se anota un renglón en el archivo de Google **"FORMATO DE REPARTO"**, con el mismo formato que la hoja de reparto de siempre:

- **Una pestaña por mes** ("OCTUBRE 26"), que se crea sola con título azul y encabezados **CHOFER · NOTA · CLIENTE · MATERIAL**.
- **Una franja azul por día** con la fecha ("29/10/26"). El renglón va en el primer espacio vacío de ese día; si el día está lleno, se inserta uno antes de la siguiente franja. No se mueve nada de lo escrito a mano.
- **Materiales en forma corta** (`src/integraciones/sheets/abreviar.js`): cemento en la **D** ("8 MAYA"), lo demás desde la **E** ("1M POLVO", ".5M GRAVA", "5 B POLVO", "10 B 10" = block, "10 V 3/8" = varilla). El servicio de envío no se anota. Lo que no sabe abreviar va con su nombre.
- **Chofer en mayúsculas,** como se anotaba ("MOISES SOSA" → "SOSA"; ajustable en `CHOFER_EN_HOJA` de `registro.js`).
- **Sincronizada con el panel:** cancelar una nota entregada o regresarla borra su renglón; volver a entregarla lo escribe de nuevo; editarla lo actualiza; pasarla a ALMACÉN lo borra. Lo pendiente nunca se escribe. Los cambios esperan en `sheets_cambios` si no hay internet. Lo que se edite en la hoja no regresa al panel.
- **Una sola vez por nota:** el script busca el folio antes de escribir, así que un reintento no duplica. Si falla o no hay internet, se reintenta cada 5 minutos durante 7 días. Al configurar Sheets por primera vez se anotan las entregas pendientes de los últimos 7 días.
- **La tarjeta muestra "📊 Registrada en Sheets"** y arriba aparece la insignia **Sheets** ✓/✗.

**Cómo está conectado:** el archivo tiene un Apps Script (`scripts/google-sheets/Codigo.gs`) publicado como aplicación web. La Oficina le manda cada renglón con `SHEETS_TOKEN`, y sin ese token el script no escribe nada (responde "token incorrecto"). La URL va en `SHEETS_URL`. Si cambias el script, en Apps Script usa **Implementar → Gestionar implementaciones → editar → Nueva versión**: así la URL se mantiene.

> Ya no anoten a mano en la hoja las entregas que pasan por la Oficina; se duplicarían.

## Seguridad y respaldos

**Respaldos:** en `data/respaldos/` queda `backup-AAAA-MM-DD.db` y una copia de las fotos. Se hace al arrancar si hoy no hay, a las 18:00 (`RESPALDO_HORA`) y en cada Cierre de Jornada; también con `npm run respaldo`. Se conservan las últimas 60 y la insignia **Respaldo** avisa si falla. **Están en el mismo disco:** copia esa carpeta seguido a una USB o a la nube.

**Para restaurar:** `npm run oficina:detener`, copia el respaldo sobre `data/database.sqlite`, borra `data/database.sqlite-wal` y `-shm`, y vuelve a iniciar.

**Conexiones (`src/lib/seguridad.js`):** sólo responde a esta PC y a la red local; un túnel o un dominio de internet recibe 403. Lo que cambia datos sólo se acepta desde la propia Oficina, y el QR de WhatsApp sólo se muestra en esta PC. No hay webhooks ni túneles: WhatsApp, Pulpos y Sheets salen desde aquí hacia afuera.

**PIN (`src/lib/pin.js`):** la Oficina pide PIN en todas las PCs. Se crea la primera vez en esta PC, abriendo `http://localhost:3000`. Cada navegador recuerda la sesión 30 días; **🔒 Salir** la cierra. Con 5 errores esa dirección espera 5 minutos. **Si lo olvidas:** `npm run pin:borrar` en esta PC y crea otro. La red local va sin cifrar (HTTP): quien controle esa red podría interceptar el PIN.

## SICAR

**Hoy:** las notas de SICAR se capturan por texto (ver arriba).

**Automático (pendiente):** SICAR guarda sus ventas en MySQL en la PC **MOSTRADOR** (`192.168.1.67:3306`). Para leerlas hace falta un usuario de **solo lectura**. Soporte de SICAR pide INE y una carta responsiva, así que la alternativa es crearlo al cierre del día con `init-file` de MySQL (sin la contraseña de root). Ya está preparado:

- `src/integraciones/sicar/conector.js`: conexión y revisión periódica.
- `npm run sicar:explorar`: muestra tablas y columnas (no datos de clientes) para mapear las ventas.
- `src/integraciones/sicar/consultas.js`: **falta** escribir la consulta, después de explorar. Mientras devuelva `null`, la oficina muestra "falta mapear tablas".
- Las notas capturadas a mano no se duplican cuando el conector se active: el importador revisa si el folio ya está en el tablero.

Probado y descartado: manejar la pantalla de SICAR con un robot. SICAR ignora clics y teclas que no vienen del mouse o teclado físicos.

## Configuración (`.env`)

| Variable | Default | Uso |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | `0.0.0.0` permite entrar desde la red local |
| `DB_PATH` | `./data/database.sqlite` | Archivo de la base de datos |
| `PULPOS_ACTIVO` | `false` | `true` para encender el robot |
| `PULPOS_INTERVALO_MIN` | `3` | Cada cuántos minutos revisa Pulpos |
| `PULPOS_SOLO_ENVIOS` | `true` | Solo ventas con Envío a Domicilio |
| `WHATSAPP_ACTIVO` | `false` | `true` para los avisos por WhatsApp |
| `WHATSAPP_NEGOCIO` | `Materiales El Güero` | Nombre que aparece en el mensaje |
| `SHEETS_URL` / `SHEETS_TOKEN` | — | URL de la aplicación web de "FORMATO DE REPARTO" y su contraseña |
| `SICAR_ACTIVO` | `false` | `true` para el conector automático |
| `SICAR_INTERVALO_MIN` | `2` | Cada cuántos minutos revisa SICAR |
| `SICAR_DB_HOST` / `_PORT` / `_NAME` | `192.168.1.67` / `3306` / `sicar` | Servidor MySQL de SICAR |
| `SICAR_DB_USER` / `_PASSWORD` | — | Usuario de solo lectura (lo escribe el dueño, nunca se comparte) |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run inicio:instalar` / `inicio:quitar` | Pone o quita el arranque automático |
| `npm run oficina:detener` | Detiene el vigilante, el servidor y el navegador del robot |
| `npm start` | Inicia la Oficina Virtual en primer plano, sin vigilante |
| `npm run dev` | Igual, reiniciando al editar código |
| `npm test` | Pruebas: lector de Pulpos, texto de SICAR, teléfonos, mensajes de WhatsApp, cotizador y formato corto de la hoja |
| `npm run seed:choferes` | Carga choferes en una base vacía |
| `npm run seed` | Choferes + notas de **demostración** (no usar con datos reales) |
| `npm run pulpos:login` | Abre la ventana para iniciar sesión en Pulpos |
| `npm run sicar:explorar` | Muestra la estructura de la base de SICAR |

## Estructura

```
oficina-virtual/
├── package.json · .env.example · README.md
├── data/                          # (ignorado por git)
│   ├── database.sqlite            # base de datos
│   ├── pulpos-perfil/             # sesión del navegador del robot
│   ├── whatsapp-sesion/           # vinculación de WhatsApp (+ whatsapp-cache/)
│   ├── logs/oficina.log           # registro del arranque automático
│   └── respaldos/                 # copias antes de migraciones
├── scripts/                       # arranque automático (Windows) y google-sheets/Codigo.gs (Apps Script)
│   ├── iniciar-oficina.vbs · iniciar-oficina.ps1 (vigilante)
│   └── detener-oficina.ps1 · inicio-automatico.ps1
├── src/
│   ├── server.js                  # Express, API, arranque y cierre de conectores
│   ├── config.js                  # lee .env
│   ├── db/
│   │   ├── schema.sql             # tablas (idempotente)
│   │   ├── migraciones.js         # cambios sobre bases existentes
│   │   ├── connection.js          # better-sqlite3 (WAL, llaves foráneas)
│   │   └── seed.js
│   ├── repositories/              # todo el SQL
│   │   ├── notas.repo.js          # tablero, avanzar/regresar, resumen
│   │   ├── choferes.repo.js
│   │   └── clientes.repo.js
│   ├── routes/  notas.routes.js · clientes.routes.js · cotizaciones.routes.js
│   ├── events/bus.js              # eventos nota:creada / nota:estado
│   ├── lib/  errors.js · telefono.js
│   └── integraciones/
│       ├── importador.js          # alta común de notas externas + deduplicación
│       ├── estado.js              # estado de cada conector para la oficina
│       ├── pulpos/  robot.js · parser.js · login.js
│       ├── sicar/   texto.js · conector.js · consultas.js · explorar.js
│       ├── whatsapp/  cliente.js (conexión, QR, imágenes) · avisos.js (envío sin duplicados) · mensajes.js (textos)
│       ├── inspector/  cotizador.js (interpretar, buscar precios, calcular) · imagen.js (PNG tipo Excel)
│       └── sheets/  registro.js (envío sin duplicados y reintentos) · abreviar.js (formato corto de materiales)
├── public/                        # sin build: HTML + CSS + ES modules
│   ├── index.html · whatsapp.html · css/styles.css
│   └── js/  app.js · api.js · kanban.js · oficina.js · captura.js · inspector.js · telefono.js · sprites.js
└── test/  pulpos-parser · sicar-texto · telefono · whatsapp-mensajes · inspector-cotizador (.test.js)
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Prueba de vida |
| GET | `/api/notas` | Notas activas y entregadas hoy |
| POST | `/api/notas` | Crear nota: `{ origen: "manual"\|"sicar", folio, cliente \| cliente_id, telefono?, material, cantidad, unidad?, detalle?, total?, direccion, hora?, chofer_id? }` |
| POST | `/api/notas/interpretar` | `{ texto }` → vista previa de una nota SICAR escrita en texto (no guarda) |
| PATCH | `/api/notas/:id/estado` | `{ estado }`, un paso hacia adelante. Para `en_ruta` exige `confirmado: true` |
| PATCH | `/api/notas/:id/regresar` | Regresa un paso |
| GET | `/api/notas/:id/renglones` | Renglones de la nota para el envío parcial |
| POST | `/api/notas/:id/parcial` | `{ enviar: [...] }`, lo que va por renglón, con el saldo de esa nota como reserva. Devuelve `{ saldo }`, null si se cerró |
| POST | `/api/notas/:id/reprogramar` | Regresa un saldo a Pendiente |
| PATCH | `/api/notas/:id/chofer` · `/api/notas/:id/camion` | `{ chofer_id }` · `{ camion_id }`, en Pendiente o Cargando |
| GET | `/api/choferes` · `/api/camiones` · `/api/clientes` | Catálogos |
| PATCH | `/api/clientes/:id/telefono` | `{ telefono }` (10 dígitos; vacío lo quita). Se guarda como `52XXXXXXXXXX` |
| GET | `/api/whatsapp` | Estado de WhatsApp y, si falta vincular, el QR en SVG |
| GET | `/api/eventos` | Tiempo real (SSE): eventos `tablero` y `pizarron` |
| GET · POST | `/api/pizarron` | Notas del Pizarrón · `{ texto, creado_por? }` |
| PATCH · DELETE | `/api/pizarron/:id` | `{ estado: "pendiente" \| "completado" }` · borrar |
| POST | `/api/agentes/:id/preguntar` | `{ pregunta }` → `{ respuesta }` (`rutas`, `chasis`, `inspector`) |
| POST | `/api/cotizaciones/borrador` | `{ texto }` → borrador con partidas (precio `null` = falta) |
| POST | `/api/cotizaciones` | Aprueba: `{ cliente, telefono?, colonia, solicitud, partidas, actualizarPrecios?, enviar? }`. Recalcula importes, guarda, aprende y (si `enviar`) manda la imagen |
| GET | `/api/cotizaciones` · `/api/cotizaciones/precios` | Últimas 10 · lista de precios y fletes |
| GET · PUT | `/api/asistencias` | Pizarra de asistencias: `?desde=&hasta=` · `{ trabajador_id, fecha, estado: "asistio" \| "falta" \| null }`. Plantilla en la tabla `trabajadores` |
| DELETE | `/api/notas/:id` | Cancela la nota (✕ de la tarjeta): la borra con su historial; Pulpos no la vuelve a traer |
| GET | `/api/cotizaciones/solicitudes` | Solicitudes de WhatsApp pendientes (con su borrador) |
| POST | `/api/cotizaciones/solicitudes/:id/descartar` | Quita la tarjeta del Pizarrón |
| POST | `/api/cotizaciones/:id/estado` | `{ estado: "pagada" \| "cerrada" \| "aprobada" }`: las dos primeras cancelan el recordatorio; "aprobada" deshace |
| GET | `/api/cotizaciones/:id/imagen` | PNG tipo Excel (`?descargar=1` para bajarla) |
| POST | `/api/cotizaciones/:id/enviar` | Reenvía la imagen por WhatsApp |
| GET | `/api/resumen` | Conteos por estado, `sin_chofer`, `clientes` y `integraciones` (estado de cada conector) |

## Base de datos

- **Tablas:** `notas`, `clientes`, `choferes`, `camiones`, `historial_estados` (cada avance o regreso), `integracion_vistos` (folios ya revisados por los conectores), `whatsapp_envios` (un aviso por nota), `sheets_registros` (un renglón por entrega), `precios`, `fletes`, `cotizaciones` + `cotizacion_partidas`, `solicitudes_whatsapp`, `conversaciones_whatsapp` y `ajustes`.
- **Una nota es única por `(origen, folio)`:** un folio de Pulpos y uno de SICAR pueden repetirse entre sí.
- **Antes de cualquier cambio de esquema,** detén el servidor y copia `data/database.sqlite*` a `data/respaldos/`. Las migraciones de `src/db/migraciones.js` corren al arrancar y revisan si ya se aplicaron.

## Decisiones técnicas

- **better-sqlite3:** síncrono, rápido y con transacciones simples. Es el estándar para SQLite en un solo proceso.
- **Sin framework ni build en el frontend:** carga rápido en el Ryzen 3. El Kanban usa CSS Grid (4 columnas, 2×2 en pantallas medianas, 1 en celular).
- **Pixel art en SVG** generado desde mapas de caracteres (`sprites.js`): sin imágenes que mantener.
- **Bus de eventos:** WhatsApp y Sheets (Paso 2) solo se suscriben a `nota:estado`. Los regresos llevan `retroceso: true` para no disparar avisos.
- **Conectores con un importador común:** Pulpos, SICAR automático y la captura manual comparten la deduplicación y el registro.

## Pendientes

- **Pantalla para administrar choferes y camiones** (hoy se cambian en `seed.js` o directo en la base).
- **SICAR automático:** usuario de solo lectura en MOSTRADOR, luego `sicar:explorar` y escribir `consultas.js`.
- **Pantalla para ver y editar la lista de precios y fletes** (hoy crece al aprobar cotizaciones).
- **IA de los agentes, siguiente nivel:** conversación con varias preguntas seguidas (hoy cada pregunta es independiente) y pantalla para ver o borrar recuerdos.
- **Control de versiones (git).**

> **Seguridad:** no tiene inicio de sesión. Está pensado solo para la red Wi-Fi privada del negocio; no lo expongas a Internet. `.env`, la base de datos y la sesión de Pulpos están en `.gitignore`.
