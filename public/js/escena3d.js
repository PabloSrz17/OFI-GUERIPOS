// Maqueta isométrica 3D (three.js): caseta de oficina con los 3 escritorios y, al lado, el patio de
// materiales con bodega, montones y la flota. Las etiquetas (agentes, camiones, áreas) son HTML
// encima de la escena (CSS2DRenderer), así se les puede dar clic y leer con lector de pantalla.
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { modeloDeFlota } from './flota3d.js';

const C = {
  piso: 0xd7a56f, losetas: 0xbd8a55, muro: 0xfbeed8, muroBorde: 0xe8c9a0, patio: 0xdcbf91,
  madera: 0x8b5a2b, mesa: 0xc9874a, metal: 0x5a4a3e, pantalla: 0x69d8e0, piel: 0xf2c79a,
  bodega: 0xc8593f, techo: 0x7a2f22, puerta: 0x3f6f73, llanta: 0x2b2320, cabina: 0xe2502f,
  hoja: 0x4fa84f, hojaClara: 0x7cc35a, maceta: 0xc8643c, raya: 0xf2c14e,
};
const ROPA = {
  chasis: { torso: 0x2f9e5b, pierna: 0x2d3a5c, gorra: 0x3b2417, casco: false },
  rutas: { torso: 0xf26b1d, pierna: 0x33406b, gorra: 0xf2b516, casco: true },
  inspector: { torso: 0x2f6fd1, pierna: 0x2b2b38, gorra: 0x8a8f99, casco: false },
};
const COLOR_ESTADO = { disponible: 0x3fbf6b, procesando: 0xf2a516, espera: 0xff5a4f };
const CAJAS_CAMION = [0xe8a33d, 0xd9d4c7, 0x6fa8dc, 0xc0392b, 0xf2d33a, 0x9b59b6];

// Lugares en la maqueta (x, z). La oficina va de x -17 a 1 y de z -8 a 8; el patio de x 1 a 13.
// Muy separados en diagonal para que sus etiquetas no se encimen en la vista isométrica.
const PUESTOS = { chasis: [-13.5, 4], rutas: [-3.5, 4], inspector: [-8.5, -4] };
const AREAS = { chasis: 'VENTAS · MOSTRADOR', rutas: 'LOGÍSTICA · FLETES', inspector: 'COTIZACIONES' };
const ESTACIONAMIENTO = [[3.4, 5.0], [7.2, 5.0], [11.0, 5.0], [5.3, 1.4], [9.1, 1.4], [3.4, -2.2]];
// A dónde se levanta cada agente de vez en cuando (por piso libre) antes de volver a su escritorio.
const VISITAS = {
  chasis: [[-13.5, 1.6], [-15.4, -3]],
  rutas: [[-3.5, 1.6], [-3, -6.6]],
  inspector: [[-6, -6.4], [-11.5, -6.4]],
};
const VELOCIDAD = 1.8;
const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;

let escena, camara, render, etiquetas, contenedor;
const agentes = {};   // id -> { grupo, anillo, estado, casa, camino, siguiente, pausa }
const pizarras = [];  // grupos 3D a los que se les puede dar clic
const camiones = {};  // nombre -> { grupo, etiqueta, x, z, saliendo }
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

// ---- Construcción de la maqueta ----

function pisoYMuros() {
  const piso = caja(18, 0.2, 16, C.piso, { sombra: false });
  escena.add(en(piso, -8, -0.1, 0));
  // Losetas: cuadrícula sutil para dar escala.
  const rejilla = new THREE.GridHelper(18, 18, C.losetas, C.losetas);
  rejilla.scale.z = 16 / 18;
  escena.add(en(rejilla, -8, 0.01, 0));

  const patio = caja(12, 0.18, 16, C.patio, { sombra: false });
  escena.add(en(patio, 7, -0.11, 0));

  // Muros en "corte" de maqueta: fondo e izquierda altos, frente bajo con entrada, lado del patio con ventanal.
  escena.add(en(caja(18, 2.4, 0.3, C.muro), -8, 1.2, -8));
  escena.add(en(caja(0.3, 2.4, 16, C.muro), -17, 1.2, 0));
  escena.add(en(caja(8, 0.6, 0.3, C.muroBorde), -13, 0.3, 8));
  escena.add(en(caja(8, 0.6, 0.3, C.muroBorde), -3, 0.3, 8));
  escena.add(en(caja(0.3, 0.6, 16, C.muroBorde), 1, 0.3, 0));
  // Rodapié oscuro en los muros altos.
  escena.add(en(caja(18, 0.12, 0.32, C.madera, { sombra: false }), -8, 0.06, -8));
  escena.add(en(caja(0.32, 0.12, 16, C.madera, { sombra: false }), -17, 0.06, 0));

  // Franja de color en los muros y ventana que da luz.
  escena.add(en(caja(17.7, 0.5, 0.05, 0xe9825a, { sombra: false }), -8, 0.42, -7.83));
  escena.add(en(caja(0.05, 0.5, 15.7, 0xe9825a, { sombra: false }), -16.83, 0.42, 0));
  escena.add(en(caja(0.08, 1.4, 3.2, C.madera, { sombra: false }), -16.82, 1.5, 4));
  escena.add(en(caja(0.06, 1.2, 3, 0xbfeaf5, { sombra: false }), -16.78, 1.5, 4));
  // Ventanal hacia el patio (vidrio en el muro bajo).
  escena.add(en(caja(0.1, 1.2, 10, 0xa7e3ee, { sombra: false }), 1, 1.2, 0));
  escena.add(en(caja(0.16, 0.1, 10.1, C.madera, { sombra: false }), 1, 1.82, 0));
  // Alfombras que marcan cada área.
  escena.add(en(caja(6, 0.02, 4.4, 0x58b89a, { sombra: false }), PUESTOS.chasis[0], 0.02, PUESTOS.chasis[1] + 0.6));
  escena.add(en(caja(6, 0.02, 4.4, 0xf08a5d, { sombra: false }), PUESTOS.rutas[0], 0.02, PUESTOS.rutas[1] + 0.6));
  escena.add(en(caja(6, 0.02, 4.4, 0x6fa8dc, { sombra: false }), PUESTOS.inspector[0], 0.02, PUESTOS.inspector[1] + 0.6));
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

function decoracion() {
  // Plantas de la oficina y arbolitos del patio.
  [[-16.2, -7.2], [0.3, -7.2], [-16.2, 7.2], [-9.5, 7.2], [0.3, 7.2], [-8.5, 1.2]].forEach(([x, z]) => planta(x, z));
  [[12.4, -7.2], [1.9, -6.6]].forEach(([x, z]) => planta(x, z, true));
  // Librero con carpetas de colores en el muro del fondo.
  const librero = new THREE.Group();
  librero.add(en(caja(2, 2, 0.45, C.madera), 0, 1, 0));
  const COLORES = [0xe9825a, 0xf2c14e, 0x58b89a, 0x6fa8dc, 0xc76bb0, 0xe2502f];
  for (const y of [0.55, 1.25]) {
    librero.add(en(caja(1.8, 0.06, 0.1, 0xf6d9ae, { sombra: false }), 0, y - 0.2, 0.24));
    for (let i = 0; i < 9; i++) {
      librero.add(en(caja(0.16, 0.44, 0.08, COLORES[(i + Math.round(y * 3)) % COLORES.length], { sombra: false }), -0.76 + i * 0.19, y + 0.04, 0.25));
    }
  }
  escena.add(en(librero, -9, 0, -7.6));
  // Rayas amarillas de los cajones de estacionamiento.
  for (const [x, z] of ESTACIONAMIENTO) {
    for (const lado of [-1, 1]) escena.add(en(caja(3.2, 0.02, 0.09, C.raya, { sombra: false }), x, 0.0, z + lado * 0.95));
  }
}

// Pizarra colgada en el muro. Se le da clic al modelo o a su etiqueta. rotacion: de cara a +z o a +x.
// trazos: colores de los renglones (gis, tinta) o, con papelitos, de las notas pegadas.
function pizarra(id, x, z, rotacion, colorFondo, trazos, html, papelitos = false) {
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
  g.position.set(x, 1.5, z);
  g.rotation.y = rotacion;
  g.traverse((o) => { o.userData.objeto = id; });
  escena.add(g);
  pizarras.push(g);
  const e = etiqueta(html, 'objeto3d__ancla');
  e.position.set(0, 1.25, 0);
  g.add(e);
}

// Escritorio con monitor(es) y silla; el agente queda parado detrás, mirando al frente (+z).
function escritorio(x, z, largo, monitores) {
  const g = new THREE.Group();
  g.add(en(caja(largo, 0.12, 1.1, C.mesa), 0, 0.85, 0.5));
  g.add(en(caja(largo, 0.8, 0.12, C.madera), 0, 0.4, 1.0));            // frente del mueble
  for (const lado of [-1, 1]) g.add(en(caja(0.1, 0.8, 1, C.madera), lado * (largo / 2 - 0.05), 0.4, 0.5));
  // Detalles: taza y papeles.
  const taza = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.14, 10), new THREE.MeshLambertMaterial({ color: 0xe9825a }));
  g.add(en(taza, largo / 2 - 0.3, 0.98, 0.75));
  g.add(en(caja(0.34, 0.03, 0.44, 0xfff8ea, { sombra: false }), -largo / 2 + 0.35, 0.93, 0.7));
  monitores.forEach((mx) => {
    g.add(en(caja(0.9, 0.55, 0.06, C.metal), mx, 1.3, 0.25));
    const pantalla = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.47, 0.01), new THREE.MeshBasicMaterial({ color: C.pantalla })); // brilla sola
    g.add(en(pantalla, mx, 1.3, 0.29));
    g.add(en(caja(0.12, 0.3, 0.12, C.metal), mx, 1.0, 0.25));
  });
  g.add(en(caja(0.6, 0.08, 0.6, 0xe9825a), 0, 0.5, -0.45));             // silla
  g.add(en(caja(0.6, 0.6, 0.08, 0xe9825a), 0, 0.8, -0.75));
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
  const [x, z] = PUESTOS[id];
  escritorio(x, z, id === 'chasis' ? 3.6 : 2.6, id === 'chasis' ? [-0.8, 0.8] : [0]);
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
  g.add(en(caja(5, 3, 3.6, C.bodega), 0, 1.5, 0));
  const techo = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 2.9, 1.2, 4, 1), new THREE.MeshLambertMaterial({ color: C.techo }));
  techo.rotation.y = Math.PI / 4;
  techo.scale.set(1.25, 1, 0.9);
  techo.castShadow = true;
  g.add(en(techo, 0, 3.6, 0));
  g.add(en(caja(2.4, 2, 0.08, C.puerta, { sombra: false }), 0, 1, 1.82));
  g.position.set(7.2, 0, -3.6);
  escena.add(g);
  const cartel = etiqueta('BODEGA', 'area3d');
  cartel.position.set(7.2, 4.6, -3.6);
  escena.add(cartel);
}

function montones() {
  [[11.4, -1.4, 0xe6dcc4, 'Polvo'], [11.6, 1.6, 0xa89a82, 'Grava'], [3.2, -4.6, 0x8c7a66, 'Piedra']].forEach(([x, z, color, nombre]) => {
    const cono = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 10), new THREE.MeshLambertMaterial({ color, flatShading: true }));
    cono.castShadow = true;
    cono.receiveShadow = true;
    escena.add(en(cono, x, 0.6, z));
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
  const centro = new THREE.Vector3(-3, 0, -2); // centro visual de la maqueta (con etiquetas)
  camara.position.copy(centro).add(new THREE.Vector3(22, 20, 22)); // diagonal desde arriba: vista isométrica
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
  Object.assign(sol.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26 });
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
  pizarra('notas', -3.5, -7.8, 0, 0x2f6b4f, [0xf4f1e3, 0xf4f1e3, 0xf2c14e, 0xf4f1e3], objetosHtml.notas);
  pizarra('dia', -13.5, -7.8, 0, 0xc99a63, [0xf9e27a, 0xf7a8a0, 0xa8e0c8, 0xa9cdf2, 0xf9e27a, 0xf7a8a0], objetosHtml.dia, true);
  pizarra('asistencias', -16.8, -3, Math.PI / 2, 0xfaf7ee, [0x2f7fd1, 0xe2502f, 0x2f9e5b, 0x2f7fd1], objetosHtml.asistencias);
  decoracion();
  bodega();
  montones();
  for (const [id, html] of Object.entries(agentesHtml)) agente(id, html);
  const letreros = Object.entries(AREAS).map(([id, texto]) => [texto, PUESTOS[id][0], PUESTOS[id][1] + 2.6]);
  [...letreros, ['PATIO DE MATERIALES', 7, 8.4]]
    .forEach(([texto, x, z]) => { const e = etiqueta(texto, 'area3d'); e.position.set(x, 0.1, z); escena.add(e); });

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
  const vista = Math.max(23, 37 / aspecto); // en pantallas angostas se aleja para que quepa todo
  Object.assign(camara, { left: (-vista * aspecto) / 2, right: (vista * aspecto) / 2, top: vista / 2, bottom: -vista / 2 });
  camara.updateProjectionMatrix();
  render.setSize(ancho, alto);
  etiquetas.setSize(ancho, alto);
}

function cuadro() {
  const dt = Math.min(reloj.getDelta(), 0.1);
  const t = reloj.elapsedTime;
  for (const [id, a] of Object.entries(agentes)) {
    // Con una alarma se queda en su escritorio; si no, de vez en cuando se levanta.
    if (!quieto && !a.camino && t > a.siguiente && a.estado !== 'espera') a.camino = [...VISITAS[id], a.casa];
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
    if (c.grupo.position.x > 20) { c.saliendo = false; c.grupo.visible = false; }
  }
  render.render(escena, camara);
  etiquetas.render(escena, camara);
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
      const [x, z] = ESTACIONAMIENTO[i % ESTACIONAMIENTO.length];
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
