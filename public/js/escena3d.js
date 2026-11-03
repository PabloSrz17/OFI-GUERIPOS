// Maqueta 3D (three.js): oficina de madera con el Tablero Central en el muro del fondo, 4 escritorios y,
// al lado, el patio de materiales con bodega, cajones de material y la flota. Las pantallas del muro
// muestran datos reales. Las etiquetas (agentes, camiones, áreas) son HTML encima de la escena
// (CSS2DRenderer), así se les puede dar clic y leer con lector de pantalla.
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { modeloDeFlota } from './flota3d.js';

const C = {
  piso: 0xb9804a, muro: 0xf3e3c8, muroBorde: 0x8b5a2b, patio: 0x5b5753,
  madera: 0x6f4426, metal: 0x5a4a3e, pantalla: 0x69d8e0, piel: 0xf2c79a, crema: 0xe6dcc4,
  bodega: 0xb5533a, techo: 0x9c3b28, llanta: 0x2b2320, cabina: 0xe2502f,
  hoja: 0x4fa84f, hojaClara: 0x7cc35a, maceta: 0xc8643c, raya: 0xf2c14e, corcho: 0xc99a63,
};
// Cada puesto: color de su mueble y de su alfombra, y el nombre en su escritorio.
const MUEBLE = {
  chasis: { mesa: 0xa8703c, alfombra: 0x2f7f78, borde: 0x8fd0c0, placa: 'Sulema' },
  inspector: { mesa: 0x3b4a6b, alfombra: 0x3d6f8f, borde: 0xa9cdf2, placa: 'Chatito' },
  octavio: { mesa: 0xd9773a, alfombra: 0xd9813c, borde: 0xf8c58f, placa: 'Octavio' },
  rutas: { mesa: 0xc9b89a, alfombra: 0xcfc7b8, borde: 0x8f8778, placa: 'Logística' },
};
// Pantallas del Tablero Central: fondo, tinta y el brillo que dejan en el muro.
const PANTALLAS = {
  chatito: { fondo: '#c9f7b5', tinta: '#123d12', brillo: 0x7dff6a, vacio: 'Sin datos' },
  ordenes: { fondo: '#1f2f45', tinta: '#e8f1ff', brillo: 0x6fb2ff, vacio: 'Sin órdenes ni entradas' },
  notas: { fondo: '#f8fbff', tinta: '#16263a', brillo: 0xbfe0ff, vacio: 'Sin notas activas' },
};
const ROPA = {
  chasis: { torso: 0x2f9e5b, pierna: 0x2d3a5c, gorra: 0x3b2417, casco: false },
  rutas: { torso: 0xf26b1d, pierna: 0x33406b, gorra: 0xf2b516, casco: true },
  inspector: { torso: 0x2f6fd1, pierna: 0x2b2b38, gorra: 0x8a8f99, casco: false },
  octavio: { torso: 0x8e5bc7, pierna: 0x2d2a3f, gorra: 0x2b2320, casco: false },
};
const COLOR_ESTADO = { disponible: 0x3fbf6b, procesando: 0xf2a516, espera: 0xff5a4f };
const CAJAS_CAMION = [0xe8a33d, 0xd9d4c7, 0x6fa8dc, 0xc0392b, 0xf2d33a, 0x9b59b6];

// Lugares en la maqueta (x, z). La oficina va de x -17 a 1 y de z -8 a 8; el patio de x 1 a 13.
// Tres puestos en fila frente al Tablero Central y el mostrador adelante, a la izquierda.
const PUESTOS = { chasis: [-12.5, 3], inspector: [-10.4, -3.9], octavio: [-5.9, -3.9], rutas: [-1.5, -3.9] };
const AREAS = { chasis: 'VENTAS · MOSTRADOR', rutas: 'LOGÍSTICA · FLETES', inspector: 'COTIZACIONES', octavio: 'ÓRDENES · ALMACÉN' };
const ESTACIONAMIENTO = [[3.4, 5.0], [7.2, 5.0], [11.0, 5.0], [5.3, 1.4], [9.1, 1.4], [3.4, -2.2]];
// A dónde se levanta cada agente de vez en cuando (por piso libre) antes de volver a su escritorio.
const VISITAS = {
  chasis: [[-12.5, 0.8], [-15, -2.5]],
  rutas: [[-1.5, -6.8], [0.1, -5.6]],
  inspector: [[-10.4, -6.8], [-12.2, -6.4]],
  octavio: [[-5.9, -6.8], [-4.3, -6.2]],
};
const VELOCIDAD = 1.8;
// Holgura: el plano se arma con las medidas de arriba y luego se estira ESPACIO veces en x y z
// (muros, piso y patio crecen; muebles, monitos y camiones conservan su tamaño y sólo se separan).
const ESPACIO = 1.3;
const separado = ([x, z]) => [x * ESPACIO, z * ESPACIO];
const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;

let escena, camara, render, etiquetas, contenedor, maqueta;
const agentes = {};   // id -> { grupo, anillo, estado, casa, camino, siguiente, pausa }
const pizarras = [];  // grupos 3D a los que se les puede dar clic
const camiones = {};  // nombre -> { grupo, etiqueta, x, z, saliendo }
const pantallas = {}; // id -> { lienzo, textura, config }
const reloj = new THREE.Clock();

function caja(ancho, alto, fondo, color, { sombra = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(ancho, alto, fondo), new THREE.MeshLambertMaterial({ color }));
  m.castShadow = sombra;
  m.receiveShadow = true;
  return m;
}

function en(objeto, x, y, z) {
  objeto.position.set(x, y, z);
  return objeto;
}

// contenido: texto/HTML o un elemento ya creado (las etiquetas de los agentes las crea oficina.js).
function etiqueta(contenido, clase) {
  const div = document.createElement('div');
  div.className = clase;
  if (contenido instanceof Element) div.append(contenido);
  else div.innerHTML = contenido;
  return new CSS2DObject(div);
}

// ---- Texturas dibujadas aquí mismo: no hay imágenes que bajar ----

function textura(ancho, alto, dibujar, repetirX = 1, repetirY = 1) {
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  dibujar(lienzo.getContext('2d'), ancho, alto);
  const t = new THREE.CanvasTexture(lienzo);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repetirX, repetirY);
  return t;
}

// Tablas de madera: siempre las mismas vetas (azar con semilla), para que no cambien al recargar.
function tablas(base, oscuro, cuantas) {
  let semilla = 7;
  const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
  return (ctx, ancho, alto) => {
    const grueso = alto / cuantas;
    for (let i = 0; i < cuantas; i++) {
      ctx.fillStyle = base;
      ctx.fillRect(0, i * grueso, ancho, grueso);
      ctx.fillStyle = `rgb(0 0 0 / ${0.03 + azar() * 0.13})`;
      ctx.fillRect(0, i * grueso, ancho, grueso);
      ctx.fillStyle = oscuro;
      ctx.fillRect(0, i * grueso, ancho, 2);
      ctx.fillRect(azar() * ancho, i * grueso, 2, grueso); // unión entre tablas
    }
  };
}

function ladrillos(ctx, ancho, alto) {
  ctx.fillStyle = '#d8c2a8';
  ctx.fillRect(0, 0, ancho, alto);
  const [largo, grueso] = [ancho / 8, alto / 16];
  let semilla = 11;
  for (let fila = 0; fila < 16; fila++) {
    for (let i = -1; i < 9; i++) {
      semilla = (semilla * 16807) % 2147483647;
      ctx.fillStyle = `hsl(13 ${48 + semilla % 12}% ${40 + semilla % 8}%)`;
      ctx.fillRect(i * largo + (fila % 2 ? largo / 2 : 0) + 1, fila * grueso + 1, largo - 2, grueso - 2);
    }
  }
}

function persiana(ctx, ancho, alto) {
  for (let y = 0; y < alto; y += 16) {
    ctx.fillStyle = y % 32 ? '#a7abad' : '#c4c8ca';
    ctx.fillRect(0, y, ancho, 16);
  }
}

function plano(ancho, alto, material) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto), material);
  m.receiveShadow = true;
  return m;
}

// Letrero con texto, pegado a un mueble o muro (mira hacia +z).
function placa(texto, ancho, alto, { fondo = '#2b2320', tinta = '#fff4dc', borde = '#c99a63' } = {}) {
  const t = textura(512, Math.round((512 * alto) / ancho), (ctx, a, h) => {
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, a, h);
    ctx.strokeStyle = borde;
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, a - 12, h - 12);
    ctx.fillStyle = tinta;
    ctx.font = `800 ${Math.round(h * 0.52)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, a / 2, h / 2 + 2, a - 40);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto), new THREE.MeshBasicMaterial({ map: t }));
}

// ---- Construcción de la maqueta ----

const ALTO_MURO = 5.1;

function alfombra(x, z, ancho, fondo, { alfombra: color, borde }) {
  maqueta.add(en(caja(ancho, 0.02, fondo, borde, { sombra: false }), x, 0.025, z));
  maqueta.add(en(caja(ancho - 0.3, 0.02, fondo - 0.3, color, { sombra: false }), x, 0.035, z));
}

function pisoYMuros() {
  maqueta = new THREE.Group();
  maqueta.scale.set(ESPACIO, 1, ESPACIO);
  escena.add(maqueta);
  maqueta.add(en(caja(18, 0.2, 16, C.madera, { sombra: false }), -8, -0.1, 0));
  // Duela: tablas a lo largo del salón.
  const duela = plano(18, 16, new THREE.MeshLambertMaterial({ map: textura(512, 512, tablas('#c58a50', '#7c5026', 10), 2, 2.5) }));
  duela.rotation.x = -Math.PI / 2;
  maqueta.add(en(duela, -8, 0.005, 0));

  // Patio de asfalto, con banqueta entre él y la oficina.
  maqueta.add(en(caja(12, 0.18, 16, C.patio, { sombra: false }), 7, -0.11, 0));
  maqueta.add(en(caja(0.7, 0.06, 16, 0xb9b1a4, { sombra: false }), 1.5, 0.0, 0));

  // Muro del fondo con lambrín de madera: ahí vive el Tablero Central.
  maqueta.add(en(caja(18, ALTO_MURO, 0.3, C.madera), -8, ALTO_MURO / 2, -8));
  const lambrin = plano(17.7, ALTO_MURO - 0.1, new THREE.MeshLambertMaterial({ map: textura(512, 512, (ctx, a, h) => {
    ctx.translate(a, 0);
    ctx.rotate(Math.PI / 2); // tablas verticales
    tablas('#8a5a30', '#5a3719', 24)(ctx, h, a);
  }) }));
  maqueta.add(en(lambrin, -8, ALTO_MURO / 2, -7.84));
  maqueta.add(en(caja(18, 0.18, 0.36, 0x4a2c15), -8, ALTO_MURO, -8));
  maqueta.add(en(caja(17.7, 0.22, 0.06, 0x4a2c15, { sombra: false }), -8, 0.11, -7.82));
  // Letrero principal.
  escena.add(en(caja(6.3, 0.72, 0.1, 0x4a2c15), -7, 4.53, -7.78));
  escena.add(en(placa('TABLERO CENTRAL', 6, 0.56, { fondo: '#c99a63', tinta: '#2b1608', borde: '#6f4426' }), -7, 4.53, -7.72));

  // Muro izquierdo en corte de maqueta: alto al fondo, bajo al frente.
  const perfil = new THREE.Shape();
  perfil.moveTo(-8, 0);
  perfil.lineTo(8, 0);
  perfil.lineTo(8, 1.1);
  perfil.lineTo(-8, ALTO_MURO);
  perfil.closePath();
  const izquierdo = new THREE.Mesh(new THREE.ExtrudeGeometry(perfil, { depth: 0.3, bevelEnabled: false }), new THREE.MeshLambertMaterial({ color: C.muro }));
  izquierdo.rotation.y = -Math.PI / 2; // el perfil corre a lo largo de z
  izquierdo.castShadow = true;
  izquierdo.receiveShadow = true;
  maqueta.add(en(izquierdo, -16.85, 0, 0));
  maqueta.add(en(caja(0.05, 0.5, 15.7, C.muroBorde, { sombra: false }), -16.83, 0.25, 0));
  // Ventana y mapa de la zona de reparto.
  maqueta.add(en(caja(0.08, 1.5, 3.2, C.madera, { sombra: false }), -16.82, 1.55, 1.4));
  maqueta.add(en(caja(0.06, 1.3, 3, 0xbfeaf5, { sombra: false }), -16.78, 1.55, 1.4));
  maqueta.add(en(caja(0.04, 1.3, 0.08, C.madera, { sombra: false }), -16.75, 1.55, 1.4));
  maqueta.add(en(caja(0.08, 1.7, 2.5, C.madera, { sombra: false }), -16.82, 2.5, -3));
  maqueta.add(en(caja(0.06, 1.5, 2.3, 0xe9d9ae, { sombra: false }), -16.78, 2.5, -3));
  for (const [y, z, alto, fondo] of [[2.7, -3.6, 0.6, 0.7], [2.2, -2.5, 0.5, 0.9], [2.85, -2.3, 0.3, 0.5]]) {
    maqueta.add(en(caja(0.02, alto, fondo, 0xa8b878, { sombra: false }), -16.74, y, z));
  }

  // Frente y lado del patio bajos, para ver adentro; ventanal hacia el patio.
  maqueta.add(en(caja(18, 0.6, 0.3, C.muroBorde), -8, 0.3, 8));
  maqueta.add(en(caja(0.3, 0.6, 16, C.muroBorde), 1, 0.3, 0));
  maqueta.add(en(caja(0.1, 1.2, 10, 0xa7e3ee, { sombra: false }), 1, 1.2, -2));
  maqueta.add(en(caja(0.16, 0.1, 10.1, C.madera, { sombra: false }), 1, 1.82, -2));
  // Mampara que aparta a Logística, y cerca de madera al fondo del patio.
  maqueta.add(en(caja(0.14, 1.7, 5.3, C.madera), -3.7, 0.85, -5.2));
  maqueta.add(en(caja(0.22, 0.1, 5.4, 0x4a2c15, { sombra: false }), -3.7, 1.72, -5.2));
  maqueta.add(en(caja(12, 1, 0.12, C.madera), 7, 0.5, -7.95));
  maqueta.add(en(caja(0.12, 1, 16, C.madera), 13, 0.5, 0));

  // Alfombras que marcan cada área.
  for (const id of Object.keys(PUESTOS)) {
    const [x, z] = PUESTOS[id];
    alfombra(x, z + 0.6, id === 'chasis' ? 6.6 : 4.2, id === 'chasis' ? 5 : 4.6, MUEBLE[id]);
  }
}

// Planta en maceta. grande: arbolito para el patio.
function planta(x, z, grande = false) {
  const g = new THREE.Group();
  const escala = grande ? 2 : 1;
  const maceta = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.42, 12), new THREE.MeshLambertMaterial({ color: C.maceta }));
  maceta.castShadow = true;
  g.add(en(maceta, 0, 0.21, 0));
  for (const [dx, y, dz, r, color] of [[0, 0.8, 0, 0.42, C.hoja], [0.2, 1.08, 0.1, 0.3, C.hojaClara], [-0.2, 1.02, -0.1, 0.28, C.hoja]]) {
    const hoja = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), new THREE.MeshLambertMaterial({ color, flatShading: true }));
    hoja.castShadow = true;
    g.add(en(hoja, dx, y, dz));
  }
  g.scale.setScalar(escala);
  escena.add(en(g, x, 0, z));
}

function silla(x, z, giro, color) {
  const g = new THREE.Group();
  g.add(en(caja(0.6, 0.08, 0.6, color), 0, 0.5, 0));
  g.add(en(caja(0.6, 0.6, 0.08, color), 0, 0.8, -0.3));
  for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) g.add(en(caja(0.06, 0.48, 0.06, 0x4a2c15), dx, 0.24, dz));
  g.rotation.y = giro;
  escena.add(en(g, x, 0, z));
}

function decoracion() {
  // Plantas de la oficina y arbolitos del patio.
  [[-16.1, -0.9], [-16.1, 6.9], [-8.15, -7.3], [0.2, -7.3], [0.2, 6.9], [-7.3, 3.6]].forEach(([x, z]) => planta(x, z));
  [[12.3, -7.2], [2.5, -6.8]].forEach(([x, z]) => planta(x, z, true));
  // Clientes en el mostrador de Sulema.
  for (const dx of [-0.9, 0.9]) silla(PUESTOS.chasis[0] + dx, PUESTOS.chasis[1] + 1.8, Math.PI, 0xa8703c);
  // Sala de espera: banca y garrafón.
  escena.add(en(caja(3, 0.14, 0.8, C.muroBorde), -3.2, 0.5, 7.1));
  escena.add(en(caja(3, 0.6, 0.12, C.muroBorde), -3.2, 0.85, 7.5));
  for (const dx of [-1.3, 1.3]) escena.add(en(caja(0.14, 0.45, 0.7, 0x4a2c15), -3.2 + dx, 0.22, 7.1));
  escena.add(en(caja(0.6, 1.05, 0.6, C.crema), -0.9, 0.52, 7.2));
  const garrafon = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 14), new THREE.MeshLambertMaterial({ color: 0x8fd3ee, transparent: true, opacity: 0.85 }));
  escena.add(en(garrafon, -0.9, 1.3, 7.2));
  // Librero con carpetas de colores en el muro izquierdo.
  const librero = new THREE.Group();
  librero.add(en(caja(2, 2, 0.45, C.madera), 0, 1, 0));
  const COLORES = [0xe9825a, 0xf2c14e, 0x58b89a, 0x6fa8dc, 0xc76bb0, 0xe2502f];
  for (const y of [0.55, 1.25]) {
    librero.add(en(caja(1.8, 0.06, 0.1, 0xf6d9ae, { sombra: false }), 0, y - 0.2, 0.24));
    for (let i = 0; i < 9; i++) {
      librero.add(en(caja(0.16, 0.44, 0.08, COLORES[(i + Math.round(y * 3)) % COLORES.length], { sombra: false }), -0.76 + i * 0.19, y + 0.04, 0.25));
    }
  }
  librero.rotation.y = Math.PI / 2;
  escena.add(en(librero, -16.45, 0, -6.4));
  // Rayas amarillas de los cajones de estacionamiento.
  for (const [x, z] of ESTACIONAMIENTO) {
    for (const lado of [-1, 1]) escena.add(en(caja(3.2, 0.02, 0.09, C.raya, { sombra: false }), x, 0.0, z + lado * 0.95));
  }
}

// Pizarra colgada en el muro. Se le da clic al modelo o a su etiqueta.
// trazos: colores de los renglones (gis, tinta) o, con papelitos, de las notas pegadas.
function pizarra(id, x, y, z, colorFondo, trazos, html, papelitos = false) {
  const g = new THREE.Group();
  g.add(en(caja(3.2, 1.7, 0.1, C.madera), 0, 0, 0));
  g.add(en(caja(3, 1.5, 0.04, colorFondo, { sombra: false }), 0, 0, 0.06));
  trazos.forEach((color, i) => {
    if (papelitos) {
      g.add(en(caja(0.72, 0.56, 0.01, color, { sombra: false }), -0.96 + (i % 3) * 0.96, 0.33 - Math.floor(i / 3) * 0.66, 0.09));
    } else {
      const largo = 2.4 - (i % 3) * 0.6;
      g.add(en(caja(largo, 0.07, 0.01, color, { sombra: false }), -1.2 + largo / 2, 0.5 - i * 0.33, 0.09));
    }
  });
  g.position.set(x, y, z);
  g.traverse((o) => { o.userData.objeto = id; });
  escena.add(g);
  pizarras.push(g);
  const e = etiqueta(html, 'objeto3d__ancla');
  e.position.set(0, 1.05, 0.2);
  g.add(e);
}

// Archivero metálico de 3 cajones junto a un escritorio; se abre con un clic, como las pizarras.
function archivero(id, x, z, color, html) {
  const g = new THREE.Group();
  g.add(en(caja(0.8, 1.35, 0.7, color), 0, 0.675, 0));
  for (let i = 0; i < 3; i++) {
    const y = 0.25 + i * 0.42;
    g.add(en(caja(0.7, 0.36, 0.04, 0xe9e4d8, { sombra: false }), 0, y, 0.36));
    g.add(en(caja(0.26, 0.05, 0.05, 0x3a3a3a, { sombra: false }), 0, y + 0.08, 0.39));
    g.add(en(caja(0.18, 0.08, 0.01, 0xffffff, { sombra: false }), 0, y - 0.06, 0.385)); // etiqueta del cajón
  }
  g.position.set(x, 0, z);
  g.traverse((o) => { o.userData.objeto = id; });
  escena.add(g);
  pizarras.push(g);
  const e = etiqueta(html, 'objeto3d__ancla');
  e.position.set(0, 1.75, 0);
  g.add(e);
}

// Pantalla del Tablero Central: renglones con datos reales (ver actualizarPantalla). Brilla sola.
function pantalla(id, x, z, html) {
  const config = PANTALLAS[id];
  const g = new THREE.Group();
  const halo = plano(4.7, 3.1, new THREE.MeshBasicMaterial({ color: config.brillo, transparent: true, opacity: 0.35 }));
  halo.receiveShadow = false;
  g.add(en(halo, 0, 0, -0.03));
  g.add(en(caja(4.2, 2.6, 0.12, 0x2b2320), 0, 0, 0));
  const t = textura(640, 368, (ctx, a, h) => { ctx.fillStyle = config.fondo; ctx.fillRect(0, 0, a, h); });
  const lienzo = t.image;
  g.add(en(new THREE.Mesh(new THREE.PlaneGeometry(3.96, 2.36), new THREE.MeshBasicMaterial({ map: t })), 0, 0, 0.07));
  g.position.set(x, 2.05, z);
  g.traverse((o) => { o.userData.objeto = id; });
  escena.add(g);
  pizarras.push(g);
  pantallas[id] = { lienzo, textura: t, config };
  dibujarPantalla(id, []);
  const e = etiqueta(html, 'objeto3d__ancla');
  e.position.set(0, 1.72, 0.2);
  g.add(e);
}

const RENGLONES_PANTALLA = 5;

function dibujarPantalla(id, filas) {
  const { lienzo, textura: t, config } = pantallas[id];
  const ctx = lienzo.getContext('2d');
  const alto = lienzo.height / RENGLONES_PANTALLA;
  ctx.fillStyle = config.fondo;
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.textBaseline = 'middle';
  ctx.font = '700 44px "Segoe UI", sans-serif';
  const lista = filas.length ? filas : [{ texto: config.vacio }];
  lista.slice(0, RENGLONES_PANTALLA).forEach(({ texto, color }, i) => {
    const y = alto * i + alto / 2;
    if (i) {
      ctx.fillStyle = 'rgb(128 128 128 / 0.35)';
      ctx.fillRect(16, alto * i - 1, lienzo.width - 32, 2);
    }
    ctx.fillStyle = color ?? config.tinta;
    ctx.beginPath();
    ctx.arc(34, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = config.tinta;
    ctx.fillText(recortar(ctx, texto, lienzo.width - 80), 62, y + 2);
  });
  t.needsUpdate = true;
}

function recortar(ctx, texto, ancho) {
  if (ctx.measureText(texto).width <= ancho) return texto;
  let corto = texto;
  while (corto.length && ctx.measureText(`${corto}…`).width > ancho) corto = corto.slice(0, -1);
  return `${corto}…`;
}

// Monitor de cinescopio. El grupo del escritorio lo coloca sobre la mesa.
function monitorViejo(g, x) {
  g.add(en(caja(0.95, 0.72, 0.62, C.crema), x, 1.32, 0.2));
  g.add(en(caja(0.84, 0.6, 0.02, 0x4a463f, { sombra: false }), x, 1.32, 0.52));
  const pantallita = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.01), new THREE.MeshBasicMaterial({ color: C.pantalla })); // brilla sola
  g.add(en(pantallita, x, 1.32, 0.535));
  g.add(en(caja(0.3, 0.06, 0.3, C.crema), x, 0.94, 0.3));
  g.add(en(caja(0.7, 0.04, 0.24, C.crema), x, 0.93, 0.72)); // teclado
}

// Escritorio con monitor(es) y silla; el agente queda parado detrás, mirando al frente (+z).
function escritorio(x, z, largo, monitores, { mesa, placa: nombre }) {
  const lados = new THREE.Color(mesa).multiplyScalar(0.72).getHex();
  const g = new THREE.Group();
  g.add(en(caja(largo, 0.12, 1.1, mesa), 0, 0.85, 0.5));
  g.add(en(caja(largo, 0.8, 0.12, lados), 0, 0.4, 1.0));               // frente del mueble
  for (const lado of [-1, 1]) g.add(en(caja(0.1, 0.8, 1, lados), lado * (largo / 2 - 0.05), 0.4, 0.5));
  g.add(en(placa(nombre, 1.2, 0.3), 0, 0.5, 1.07));
  // Detalles: taza y papeles.
  const taza = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.14, 10), new THREE.MeshLambertMaterial({ color: 0xe9825a }));
  g.add(en(taza, largo / 2 - 0.3, 0.98, 0.75));
  g.add(en(caja(0.34, 0.03, 0.44, 0xfff8ea, { sombra: false }), -largo / 2 + 0.35, 0.93, 0.7));
  monitores.forEach((mx) => monitorViejo(g, mx));
  g.add(en(caja(0.6, 0.08, 0.6, lados), 0, 0.5, -0.45));                // silla
  g.add(en(caja(0.6, 0.6, 0.08, lados), 0, 0.8, -0.75));
  g.position.set(x, 0, z);
  escena.add(g);
}

// Monito tipo figura de bloques. Devuelve el grupo para animarlo.
function monito(id) {
  const r = ROPA[id];
  const g = new THREE.Group();
  for (const lado of [-1, 1]) g.add(en(caja(0.24, 0.62, 0.3, r.pierna), lado * 0.14, 0.31, 0));
  g.add(en(caja(0.62, 0.62, 0.36, r.torso), 0, 0.93, 0));
  for (const lado of [-1, 1]) g.add(en(caja(0.18, 0.55, 0.22, r.torso), lado * 0.42, 0.95, 0.05));
  const cabeza = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.38, 16), new THREE.MeshLambertMaterial({ color: C.piel }));
  cabeza.castShadow = true;
  g.add(en(cabeza, 0, 1.45, 0));
  const sombrero = r.casco
    ? new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: r.gorra }))
    : new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 16), new THREE.MeshLambertMaterial({ color: r.gorra }));
  sombrero.castShadow = true;
  g.add(en(sombrero, 0, r.casco ? 1.62 : 1.68, 0));
  g.traverse((o) => { o.userData.agente = id; });
  return g;
}

function agente(id, html) {
  const [x, z] = separado(PUESTOS[id]);
  escritorio(x, z, id === 'chasis' ? 3.6 : 2.6, id === 'chasis' ? [-0.8, 0.8] : [0], MUEBLE[id]);
  const g = monito(id);
  g.position.set(x, 0, z - 0.2);
  escena.add(g);

  const anillo = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 32), new THREE.MeshBasicMaterial({ color: COLOR_ESTADO.disponible, transparent: true }));
  anillo.rotation.x = -Math.PI / 2;
  escena.add(en(anillo, x, 0.04, z - 0.2));

  const tarjeta = etiqueta(html, 'etiqueta3d');
  tarjeta.position.set(0, 2.05, 0);
  g.add(tarjeta);
  agentes[id] = {
    grupo: g, anillo, estado: 'disponible', base: g.position.y,
    piernas: [g.children[0], g.children[1]], brazos: [g.children[3], g.children[4]],
    casa: [x, z - 0.2], camino: null, pausa: 0, siguiente: 3 + Math.random() * 10,
  };
}

// Camina hacia el siguiente punto de su camino; devuelve true mientras va caminando.
function caminar(a, dt, t) {
  if (t < a.pausa) return false;
  const [x, z] = a.camino[0];
  const dx = x - a.grupo.position.x;
  const dz = z - a.grupo.position.z;
  const distancia = Math.hypot(dx, dz);
  if (distancia < 0.05) {
    a.camino.shift();
    if (a.camino.length) {
      a.pausa = t + 1.5; // se queda un momento y regresa
    } else {
      a.camino = null;
      a.grupo.rotation.y = 0;
      a.siguiente = t + 15 + Math.random() * 25;
    }
    return false;
  }
  const paso = Math.min(distancia, VELOCIDAD * dt);
  a.grupo.position.x += (dx / distancia) * paso;
  a.grupo.position.z += (dz / distancia) * paso;
  a.grupo.rotation.y = Math.atan2(dx, dz);
  return true;
}

function bodega() {
  const g = new THREE.Group();
  // Muros de ladrillo y frontón triangular; el techo corre de adelante hacia atrás.
  const ladrillo = new THREE.MeshLambertMaterial({ map: textura(256, 256, ladrillos, 2, 1.5), color: 0xffffff });
  const muros = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 3.6), ladrillo);
  muros.castShadow = true;
  muros.receiveShadow = true;
  g.add(en(muros, 0, 1.5, 0));
  const fronton = new THREE.Shape();
  fronton.moveTo(-2.5, 0);
  fronton.lineTo(2.5, 0);
  fronton.lineTo(0, 1.3);
  fronton.closePath();
  const pico = new THREE.Mesh(new THREE.ExtrudeGeometry(fronton, { depth: 3.6, bevelEnabled: false }), new THREE.MeshLambertMaterial({ color: C.bodega }));
  pico.castShadow = true;
  g.add(en(pico, 0, 3, -1.8));
  const inclinacion = Math.atan2(1.3, 2.5);
  for (const lado of [-1, 1]) {
    const faldon = caja(3.15, 0.16, 4.3, C.techo);
    faldon.rotation.z = -lado * inclinacion;
    g.add(en(faldon, lado * 1.3, 3.72, 0));
  }
  g.add(en(caja(0.2, 0.2, 4.4, 0x6d2719), 0, 4.34, 0));
  // Cortina metálica enrollable.
  g.add(en(caja(2.9, 2.35, 0.08, 0x3a3634, { sombra: false }), 0, 1.17, 1.82));
  g.add(en(plano(2.6, 2.1, new THREE.MeshLambertMaterial({ map: textura(64, 256, persiana) })), 0, 1.05, 1.87));
  g.position.set(7.6, 0, -4.6);
  escena.add(g);
  const cartel = etiqueta('BODEGA', 'area3d');
  cartel.position.set(7.6, 5.1, -4.6);
  escena.add(cartel);
}

// Cajones de madera con el material apilado adentro.
function montones() {
  [[11.6, -5.2, 0x8c7a66, 'Piedra'], [11.6, -2.7, C.crema, 'Polvo'], [11.6, -0.2, 0xa89a82, 'Grava']].forEach(([x, z, color, nombre]) => {
    const g = new THREE.Group();
    for (const lado of [-1, 1]) {
      g.add(en(caja(2.3, 0.65, 0.14, C.muroBorde), 0, 0.33, lado * 1.05));
      g.add(en(caja(0.14, 0.65, 2.2, C.muroBorde), lado * 1.08, 0.33, 0));
    }
    g.add(en(caja(2.1, 0.3, 2, color), 0, 0.15, 0));
    const cono = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.9, 10), new THREE.MeshLambertMaterial({ color, flatShading: true }));
    cono.castShadow = true;
    cono.receiveShadow = true;
    g.add(en(cono, 0, 0.75, 0));
    escena.add(en(g, x, 0, z));
    const e = etiqueta(nombre, 'material3d');
    e.position.set(x, 1.5, z);
    escena.add(e);
  });
}

function modeloCamion(colorCaja) {
  const g = new THREE.Group();
  g.add(en(caja(2.9, 0.35, 1.2, C.metal), 0, 0.55, 0));                 // chasis
  g.add(en(caja(0.95, 1.05, 1.15, C.cabina), 1.05, 1.15, 0));           // cabina
  g.add(en(caja(0.08, 0.45, 0.95, 0x9fd8f0, { sombra: false }), 1.54, 1.35, 0)); // parabrisas
  g.add(en(caja(1.85, 0.75, 1.25, colorCaja), -0.45, 1.1, 0));          // caja / estacas
  const rueda = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 14);
  const negro = new THREE.MeshLambertMaterial({ color: C.llanta });
  for (const x of [-1.0, 0.0, 1.05]) for (const z of [-0.62, 0.62]) {
    const r = new THREE.Mesh(rueda, negro);
    r.rotation.x = Math.PI / 2;
    r.castShadow = true;
    g.add(en(r, x, 0.3, z));
  }
  return g;
}

// ---- API pública ----

// agentesHtml, objetosHtml: { id: elemento de su etiqueta } (los arma oficina.js, que maneja los estados)
export function montarEscena(el, agentesHtml, objetosHtml, alClicAgente, alClicObjeto) {
  contenedor = el;
  escena = new THREE.Scene();
  escena.background = new THREE.Color(0xf7e3c6);

  camara = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const centro = new THREE.Vector3(-2 * ESPACIO, 1.2, 0); // centro visual de la maqueta (con etiquetas)
  camara.position.copy(centro).add(new THREE.Vector3(6, 17, 30)); // de frente al Tablero Central, un poco de lado
  camara.lookAt(centro);

  escena.add(new THREE.HemisphereLight(0xfff4e0, 0xb98a5a, 1.7));
  // Luz cálida sobre cada área.
  for (const [x, z] of Object.values(PUESTOS)) {
    const lampara = new THREE.PointLight(0xffcf96, 14, 11, 1.5);
    escena.add(en(lampara, x, 4.5, z));
  }
  const sol = new THREE.DirectionalLight(0xffe6c2, 1.7);
  sol.position.set(8, 18, 10);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  sol.shadow.mapSize.set(2048, 2048);
  Object.assign(sol.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34 });
  escena.add(sol);

  render = new THREE.WebGLRenderer({ antialias: true });
  render.setPixelRatio(Math.min(devicePixelRatio, 2));
  render.shadowMap.enabled = true;
  el.append(render.domElement);
  render.domElement.setAttribute('aria-hidden', 'true');

  etiquetas = new CSS2DRenderer();
  etiquetas.domElement.className = 'escena3d__etiquetas';
  el.append(etiquetas.domElement);

  pisoYMuros();
  // Tablero Central: tablero de corcho con Asistencias y Pendientes, y una pantalla por área.
  escena.add(en(caja(3.8, 3.85, 0.1, 0x4a2c15), -14.6, 2.25, -7.82));
  pizarra('asistencias', -14.6, 3.1, -7.72, 0xfaf7ee, [0x2f7fd1, 0xe2502f, 0x2f9e5b, 0x2f7fd1], objetosHtml.asistencias);
  pizarra('dia', -14.6, 1.25, -7.72, C.corcho, [0xf9e27a, 0xf7a8a0, 0xa8e0c8, 0xa9cdf2, 0xf9e27a, 0xf7a8a0], objetosHtml.dia, true);
  pantalla('chatito', -10.4, -7.74, objetosHtml.chatito);
  pantalla('ordenes', -5.9, -7.74, objetosHtml.ordenes);
  pantalla('notas', -1.5, -7.74, objetosHtml.notas);
  decoracion();
  bodega();
  montones();
  archivero('archivo_sulema', -8.6, 2.7, 0x2f7f78, objetosHtml.archivo_sulema);
  archivero('archivo_edgar', 0.2, -1.4, 0x8f8778, objetosHtml.archivo_edgar);
  const letreros = Object.entries(AREAS).map(([id, texto]) => [texto, PUESTOS[id][0], PUESTOS[id][1] + 2.6]);
  [...letreros, ['PATIO DE MATERIALES', 7, 8.4]]
    .forEach(([texto, x, z]) => { const e = etiqueta(texto, 'area3d'); e.position.set(x, 0.1, z); escena.add(e); });
  for (const o of escena.children) {
    if (o === maqueta) continue;
    o.position.x *= ESPACIO;
    o.position.z *= ESPACIO;
  }
  for (const [id, html] of Object.entries(agentesHtml)) agente(id, html);

  // Clic en el monito o la pizarra (además de su etiqueta, que es un botón).
  const rayo = new THREE.Raycaster();
  const tocar = (e) => {
    const r = render.domElement.getBoundingClientRect();
    rayo.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camara);
    return rayo.intersectObjects([...Object.values(agentes).map((a) => a.grupo), ...pizarras], true)[0]?.object.userData;
  };
  render.domElement.addEventListener('click', (e) => {
    const tocado = tocar(e);
    if (tocado?.agente) alClicAgente(tocado.agente);
    if (tocado?.objeto) alClicObjeto(tocado.objeto);
  });
  render.domElement.addEventListener('pointermove', (e) => {
    render.domElement.style.cursor = tocar(e) ? 'pointer' : '';
  });

  new ResizeObserver(ajustar).observe(el);
  ajustar();
  render.setAnimationLoop(cuadro);
}

function ajustar() {
  const { clientWidth: ancho, clientHeight: alto } = contenedor;
  const aspecto = ancho / alto;
  const vista = Math.max(19, 35 / aspecto) * ESPACIO * 1.08; // en pantallas angostas se aleja para que quepa todo; 1.08 deja orilla
  Object.assign(camara, { left: (-vista * aspecto) / 2, right: (vista * aspecto) / 2, top: vista / 2, bottom: -vista / 2 });
  camara.updateProjectionMatrix();
  render.setSize(ancho, alto);
  // Letreros a la medida de la maqueta: a ~30 px por metro van a tamaño normal; en pantallas más
  // chicas se achican (hasta 72 %) para no encimarse. El zoom va en la capa y se compensa su tamaño.
  const zoom = Math.min(1, Math.max(0.72, alto / vista / 30));
  etiquetas.domElement.style.zoom = zoom;
  etiquetas.setSize(ancho / zoom, alto / zoom);
}

function cuadro() {
  const dt = Math.min(reloj.getDelta(), 0.1);
  const t = reloj.elapsedTime;
  for (const [id, a] of Object.entries(agentes)) {
    // Con una alarma se queda en su escritorio; si no, de vez en cuando se levanta.
    if (!quieto && !a.camino && t > a.siguiente && a.estado !== 'espera') a.camino = [...VISITAS[id].map(separado), a.casa];
    const caminando = a.camino ? caminar(a, dt, t) : false;
    const zancada = caminando ? Math.sin(t * 11) * 0.6 : 0;
    a.piernas[0].rotation.x = zancada;
    a.piernas[1].rotation.x = -zancada;
    a.brazos[0].rotation.x = caminando ? -zancada : Math.sin(t * 14) * 0.12; // en su lugar: teclea
    a.brazos[1].rotation.x = caminando ? zancada : Math.sin(t * 14 + 1.5) * 0.12;
    a.anillo.position.x = a.grupo.position.x;
    a.anillo.position.z = a.grupo.position.z;

    const rapido = a.estado === 'procesando';
    a.grupo.position.y = caminando ? a.base : a.base + Math.abs(Math.sin(t * (rapido ? 9 : 2.5))) * (rapido ? 0.08 : 0.03);
    a.anillo.material.opacity = a.estado === 'disponible' ? 0.9 : 0.45 + 0.45 * Math.abs(Math.sin(t * (a.estado === 'espera' ? 6 : 3)));
  }
  for (const c of Object.values(camiones)) {
    if (!c.saliendo) continue;
    c.grupo.position.x += dt * 6;
    if (c.grupo.position.x > 20 * ESPACIO) { c.saliendo = false; c.grupo.visible = false; }
  }
  render.render(escena, camara);
  etiquetas.render(escena, camara);
}

// filas: [{ texto, color? }]. Sólo vuelve a dibujar si algo cambió.
export function actualizarPantalla(id, filas) {
  const p = pantallas[id];
  const firma = JSON.stringify(filas);
  if (!p || p.firma === firma) return;
  p.firma = firma;
  dibujarPantalla(id, filas);
}

export function estadoAgente(id, estado) {
  const a = agentes[id];
  if (!a) return;
  a.estado = estado;
  a.anillo.material.color.setHex(COLOR_ESTADO[estado]);
}

// camionesDatos: [{ nombre, estado: patio|cargando|en_ruta }]
export function actualizarCamiones(camionesDatos, textoEstado) {
  camionesDatos.forEach((c, i) => {
    let cam = camiones[c.nombre];
    if (!cam) {
      const [x, z] = separado(ESTACIONAMIENTO[i % ESTACIONAMIENTO.length]);
      const modelo = modeloDeFlota(c.nombre);
      const grupo = modelo?.grupo ?? modeloCamion(CAJAS_CAMION[i % CAJAS_CAMION.length]);
      grupo.position.set(x, 0, z);
      escena.add(grupo);
      const e = etiqueta('', 'camion3d');
      e.position.set(x, (modelo?.altura ?? 2.2) + 0.1, z);
      escena.add(e);
      cam = camiones[c.nombre] = { grupo, etiqueta: e, x, z, saliendo: false };
    }
    cam.etiqueta.element.dataset.estado = c.estado;
    cam.etiqueta.element.innerHTML = `<b>${c.nombre.replace(/[<>&]/g, '')}</b> <span>${textoEstado[c.estado]}</span>`;
    if (!cam.saliendo) {
      cam.grupo.visible = c.estado !== 'en_ruta';
      cam.grupo.position.x = cam.x;
    }
  });
}

// El camión de la nota sale del patio rumbo a la obra.
export function salirCamion(nombre) {
  const cam = camiones[nombre];
  if (!cam || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cam.grupo.visible = true;
  cam.grupo.position.x = cam.x;
  cam.saliendo = true;
}
