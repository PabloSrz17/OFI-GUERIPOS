// Modelos 3D de la flota real. El frente de cada vehículo mira hacia +x (por ahí sale del patio).
// Los colores van aquí: para cambiar el de una unidad basta con editar COLOR.
import * as THREE from 'three';

const COLOR = {
  frontier: 0xf4f4f0, // Nissan Frontier NP300 2017: blanca
  np300: 0xc8201f,    // Nissan NP300 2012: roja
  f450: 0x23406e,     // Ford F-450 2006: color por confirmar
  ram: 0xa9afb5,      // Dodge Ram 4000 2008: color por confirmar
  dina: 0xece8dc,     // Dina 4900 2001: color por confirmar
  franjaDina: 0xc8201f,
};
const VIDRIO = 0x2d4654;
const CROMO = 0xd8dde2;
const NEGRO = 0x24262a;
const PLANA = 0x3a3f45;
const MADERA = 0xa9743f;
const LLANTA = 0x1d1d20;
const FARO = 0xfff3c4;
const CALAVERA = 0xd9261c;

function caja(g, ancho, alto, fondo, color, x, y, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(ancho, alto, fondo), new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  m.receiveShadow = true;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// Silueta vista de lado [[x, y], …], con el grosor del vehículo: da la forma real de cofre y parabrisas.
function perfil(g, puntos, ancho, color) {
  const forma = new THREE.Shape(puntos.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometria = new THREE.ExtrudeGeometry(forma, { depth: ancho, bevelEnabled: false });
  geometria.translate(0, 0, -ancho / 2);
  const m = new THREE.Mesh(geometria, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function rueda(g, x, z, r) {
  const ancho = r * 0.72;
  const llanta = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ancho, 16), new THREE.MeshLambertMaterial({ color: LLANTA }));
  const rin = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, ancho + 0.02, 12), new THREE.MeshLambertMaterial({ color: CROMO }));
  for (const m of [llanta, rin]) {
    m.rotation.x = Math.PI / 2;
    m.position.set(x, r, z);
    g.add(m);
  }
  llanta.castShadow = true;
}

// Un eje: sencillo, o "dually" con dos llantas por lado.
function eje(g, x, z, r, doble = false) {
  for (const lado of [-1, 1]) {
    rueda(g, x, lado * z, r);
    if (doble) rueda(g, x, lado * (z + r * 0.78), r);
  }
}

function espejos(g, x, y, z) {
  for (const lado of [-1, 1]) caja(g, 0.06, 0.18, 0.12, NEGRO, x, y, lado * z);
}

function faros(g, x, y, z, ancho = 0.05, alto = 0.14, fondo = 0.24) {
  for (const lado of [-1, 1]) caja(g, ancho, alto, fondo, FARO, x, y, lado * z);
}

// Plataforma con estacas: los postes de madera o acero con sus largueros, que distinguen a estas unidades.
function estacas(g, x0, x1, y, ancho, alto, color, postes = 6) {
  const largo = x1 - x0;
  const centro = (x0 + x1) / 2;
  caja(g, largo, 0.09, ancho, color === MADERA ? 0x7d5530 : PLANA, centro, y, 0);
  for (const lado of [-1, 1]) {
    for (let i = 0; i < postes; i++) caja(g, 0.05, alto, 0.05, color, x0 + 0.03 + (i * (largo - 0.06)) / (postes - 1), y + alto / 2, lado * (ancho / 2 - 0.03));
    for (const h of [0.4, 0.72, 0.98]) caja(g, largo, 0.045, 0.03, color, centro, y + alto * h, lado * (ancho / 2 - 0.03));
  }
  for (let i = 1; i < 4; i++) caja(g, 0.05, alto, 0.05, color, x0 + 0.03, y + alto / 2, -ancho / 2 + (i * ancho) / 4);
  for (const h of [0.4, 0.72, 0.98]) caja(g, 0.03, 0.045, ancho, color, x0 + 0.03, y + alto * h, 0);
  for (const h of [0.4, 0.72, 0.98]) caja(g, 0.03, 0.045, ancho, color, x1 - 0.03, y + alto * h, 0);
}

// Plana materialista: piso de acero, costados bajos de lámina y protector tras la cabina.
function planaMaterialista(g, x0, x1, y, ancho) {
  const largo = x1 - x0;
  const centro = (x0 + x1) / 2;
  caja(g, largo, 0.11, ancho, PLANA, centro, y, 0);
  const alto = 0.26;
  for (const lado of [-1, 1]) {
    caja(g, largo, alto, 0.05, PLANA, centro, y + alto / 2, lado * (ancho / 2 - 0.025));
    for (let i = 0; i < 5; i++) caja(g, 0.05, alto + 0.03, 0.07, NEGRO, x0 + 0.05 + (i * (largo - 0.1)) / 4, y + alto / 2, lado * (ancho / 2 - 0.02));
  }
  caja(g, 0.05, alto, ancho, PLANA, x0 + 0.025, y + alto / 2, 0);
  // Protector de cabina (cabecera de tubo).
  for (const z of [-0.5, 0, 0.5]) caja(g, 0.05, 0.62, 0.05, NEGRO, x1 - 0.03, y + 0.31, z * ancho * 0.9);
  caja(g, 0.05, 0.05, ancho, NEGRO, x1 - 0.03, y + 0.62, 0);
  caja(g, 0.05, 0.05, ancho, NEGRO, x1 - 0.03, y + 0.36, 0);
  for (const lado of [-1, 1]) caja(g, 0.04, 0.14, 0.1, CALAVERA, x0 - 0.02, y - 0.02, lado * (ancho / 2 - 0.1));
}

// Salpicaderas anchas de los duallys.
function salpicaderas(g, x, y, z, color) {
  for (const lado of [-1, 1]) caja(g, 0.82, 0.08, 0.34, color, x, y, lado * z);
}

// Nissan Frontier NP300 2017, blanca: líneas modernas, cofre inclinado y parrilla en V.
function frontier() {
  const g = new THREE.Group();
  const c = COLOR.frontier;
  caja(g, 3.05, 0.13, 0.7, NEGRO, -0.05, 0.42);
  perfil(g, [[0.06, 0.46], [1.5, 0.46], [1.56, 0.68], [1.48, 0.9], [1.02, 1.03], [0.78, 1.08], [0.06, 1.08]], 1.14, c);
  perfil(g, [[0.12, 1.08], [0.84, 1.08], [0.52, 1.52], [0.16, 1.52]], 1.02, VIDRIO);
  perfil(g, [[0.08, 1.5], [0.56, 1.5], [0.5, 1.58], [0.12, 1.58]], 1.08, c);
  for (const lado of [-1, 1]) caja(g, 0.07, 0.42, 0.05, c, 0.15, 1.3, lado * 0.52);
  caja(g, 0.04, 0.2, 0.62, NEGRO, 1.51, 0.76);
  for (const lado of [-1, 1]) { // la "V" cromada de Nissan
    const v = caja(g, 0.05, 0.03, 0.42, CROMO, 1.53, 0.79, lado * 0.19);
    v.rotation.x = lado * 0.32;
  }
  faros(g, 1.47, 0.84, 0.44, 0.1, 0.09, 0.28);
  caja(g, 0.12, 0.13, 1.16, NEGRO, 1.54, 0.5);
  caja(g, 0.86, 0.07, 0.1, NEGRO, 0.58, 0.47, 0.56);
  caja(g, 0.86, 0.07, 0.1, NEGRO, 0.58, 0.47, -0.56);
  espejos(g, 0.76, 1.14, 0.64);
  estacas(g, -1.56, -0.02, 0.76, 1.22, 0.56, NEGRO, 6);
  for (const lado of [-1, 1]) caja(g, 0.04, 0.1, 0.1, CALAVERA, -1.58, 0.72, lado * 0.5);
  eje(g, 1.08, 0.56, 0.29);
  eje(g, -0.86, 0.56, 0.29);
  return { grupo: g, altura: 2.05 };
}

// Nissan NP300 2012, roja: la clásica cuadrada, con parrilla y defensa cromadas.
function np300() {
  const g = new THREE.Group();
  const c = COLOR.np300;
  caja(g, 3.0, 0.13, 0.7, NEGRO, -0.05, 0.4);
  perfil(g, [[0.06, 0.44], [1.48, 0.44], [1.5, 0.94], [1.42, 0.98], [0.82, 1.02], [0.06, 1.02]], 1.12, c);
  perfil(g, [[0.12, 1.02], [0.76, 1.02], [0.6, 1.44], [0.14, 1.44]], 1.0, VIDRIO);
  caja(g, 0.56, 0.06, 1.06, c, 0.37, 1.47);
  for (const lado of [-1, 1]) caja(g, 0.07, 0.42, 0.05, c, 0.15, 1.24, lado * 0.51);
  caja(g, 0.04, 0.22, 0.66, CROMO, 1.5, 0.76);
  for (const y of [0.71, 0.76, 0.81]) caja(g, 0.05, 0.02, 0.64, NEGRO, 1.51, y);
  faros(g, 1.49, 0.76, 0.45, 0.05, 0.17, 0.2);
  caja(g, 0.1, 0.11, 1.18, CROMO, 1.53, 0.5);
  espejos(g, 0.72, 1.08, 0.62);
  estacas(g, -1.54, -0.02, 0.74, 1.2, 0.56, MADERA, 6);
  for (const lado of [-1, 1]) caja(g, 0.04, 0.1, 0.1, CALAVERA, -1.56, 0.7, lado * 0.5);
  eje(g, 1.02, 0.55, 0.28);
  eje(g, -0.86, 0.55, 0.28);
  return { grupo: g, altura: 1.95 };
}

// Ford F-450 2006 Dually: Super Duty alta y cuadrada, gran parrilla cromada, faros altos, plana materialista.
function f450() {
  const g = new THREE.Group();
  const c = COLOR.f450;
  caja(g, 3.35, 0.16, 0.74, NEGRO, -0.08, 0.56);
  perfil(g, [[0.02, 0.6], [1.6, 0.6], [1.64, 1.22], [1.56, 1.3], [0.84, 1.36], [0.02, 1.36]], 1.28, c);
  perfil(g, [[0.08, 1.36], [0.78, 1.36], [0.54, 1.82], [0.1, 1.82]], 1.16, VIDRIO);
  caja(g, 0.52, 0.07, 1.22, c, 0.33, 1.85);
  for (const lado of [-1, 1]) caja(g, 0.07, 0.46, 0.05, c, 0.13, 1.58, lado * 0.59);
  caja(g, 0.05, 0.38, 0.78, CROMO, 1.64, 1.02);
  for (const y of [0.92, 1.02, 1.12]) caja(g, 0.06, 0.05, 0.72, NEGRO, 1.65, y);
  caja(g, 0.06, 0.05, 0.2, 0x1f4f9c, 1.67, 1.02); // el óvalo
  faros(g, 1.62, 1.04, 0.54, 0.05, 0.34, 0.22);
  caja(g, 0.13, 0.17, 1.32, CROMO, 1.67, 0.66);
  espejos(g, 0.74, 1.46, 0.74);
  for (const lado of [-1, 1]) caja(g, 0.9, 0.07, 0.1, CROMO, 0.5, 0.6, lado * 0.68); // estribos
  planaMaterialista(g, -1.78, -0.02, 0.92, 1.72);
  salpicaderas(g, -0.92, 0.85, 0.82, c);
  eje(g, 1.14, 0.62, 0.34);
  eje(g, -0.92, 0.58, 0.34, true);
  return { grupo: g, altura: 2.3 };
}

// Dodge Ram 4000 2008 Dually: cofre alto con salpicaderas caídas y parrilla en cruz, plana materialista.
function ram() {
  const g = new THREE.Group();
  const c = COLOR.ram;
  caja(g, 3.35, 0.16, 0.74, NEGRO, -0.08, 0.56);
  perfil(g, [[0.02, 0.6], [1.58, 0.6], [1.6, 1.12], [1.5, 1.18], [0.84, 1.24], [0.02, 1.34]], 1.28, c);
  perfil(g, [[0.84, 1.2], [1.6, 1.12], [1.62, 1.28], [1.52, 1.36], [0.84, 1.42]], 0.84, c); // cofre elevado
  perfil(g, [[0.08, 1.32], [0.82, 1.4], [0.54, 1.84], [0.1, 1.84]], 1.16, VIDRIO);
  caja(g, 0.52, 0.07, 1.22, c, 0.33, 1.87);
  for (const lado of [-1, 1]) caja(g, 0.07, 0.48, 0.05, c, 0.13, 1.58, lado * 0.59);
  caja(g, 0.05, 0.42, 0.76, NEGRO, 1.62, 1.03);
  caja(g, 0.06, 0.07, 0.8, CROMO, 1.64, 1.03); // la cruz de Ram
  caja(g, 0.06, 0.44, 0.08, CROMO, 1.64, 1.03);
  caja(g, 0.06, 0.04, 0.8, CROMO, 1.64, 1.25);
  caja(g, 0.06, 0.04, 0.8, CROMO, 1.64, 0.81);
  faros(g, 1.59, 1.0, 0.53, 0.05, 0.2, 0.24);
  caja(g, 0.13, 0.17, 1.32, CROMO, 1.65, 0.66);
  espejos(g, 0.76, 1.46, 0.74);
  planaMaterialista(g, -1.78, -0.02, 0.92, 1.72);
  salpicaderas(g, -0.92, 0.85, 0.82, c);
  eje(g, 1.12, 0.62, 0.34);
  eje(g, -0.92, 0.58, 0.34, true);
  return { grupo: g, altura: 2.3 };
}

// Dina 4900 2001, torton: camión pesado de trompa corta y cabina alta, doble eje trasero y redilas.
function dina() {
  const g = new THREE.Group();
  const c = COLOR.dina;
  caja(g, 3.95, 0.2, 0.8, NEGRO, 0.02, 0.72);
  perfil(g, [[0.2, 0.8], [1.3, 0.8], [1.3, 1.62], [1.14, 1.66], [0.2, 1.66]], 1.36, c); // cabina
  perfil(g, [[1.28, 0.8], [1.98, 0.8], [2.0, 1.42], [1.88, 1.48], [1.28, 1.56]], 1.04, c); // trompa
  perfil(g, [[0.26, 1.66], [1.14, 1.66], [1.04, 2.14], [0.3, 2.14]], 1.24, VIDRIO);
  caja(g, 0.8, 0.08, 1.32, c, 0.67, 2.18);
  for (const lado of [-1, 1]) caja(g, 0.08, 0.48, 0.05, c, 0.68, 1.9, lado * 0.63);
  caja(g, 1.12, 0.12, 1.38, COLOR.franjaDina, 0.74, 1.32); // franja de la cabina
  caja(g, 0.05, 0.44, 0.74, NEGRO, 2.0, 1.1);
  for (const y of [0.96, 1.05, 1.14, 1.23]) caja(g, 0.06, 0.03, 0.72, CROMO, 2.01, y);
  for (const lado of [-1, 1]) { // faros redondos
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), new THREE.MeshLambertMaterial({ color: FARO }));
    f.rotation.z = Math.PI / 2;
    f.position.set(2.01, 1.1, lado * 0.42);
    g.add(f);
    caja(g, 0.7, 0.07, 0.3, NEGRO, 1.62, 1.04, lado * 0.58); // salpicaderas delanteras
  }
  caja(g, 0.14, 0.2, 1.36, NEGRO, 2.05, 0.74);
  espejos(g, 1.1, 1.92, 0.82);
  estacas(g, -1.95, 0.12, 1.02, 1.56, 0.92, MADERA, 7);
  for (const lado of [-1, 1]) caja(g, 0.04, 0.12, 0.14, CALAVERA, -1.97, 0.92, lado * 0.62);
  eje(g, 1.62, 0.66, 0.38);
  eje(g, -0.62, 0.56, 0.38, true);
  eje(g, -1.42, 0.56, 0.38, true); // tandem del torton
  return { grupo: g, altura: 2.6 };
}

// Cada unidad se reconoce por su nombre en la Oficina (Nissan Roja / Nissan Blanca; antes Estaquitas
// Roja / Estaquitas). El orden importa: la roja antes que la blanca.
const MODELOS = [
  [/(nissan|estaquitas).*roja/i, np300],
  [/nissan|estaquitas/i, frontier],
  [/f-?\s?450/i, f450],
  [/\bram\b/i, ram],
  [/torton|dina/i, dina],
];

// { grupo, altura } de una unidad conocida; null si no es de la flota (se usa el modelo genérico).
export function modeloDeFlota(nombre) {
  return MODELOS.find(([re]) => re.test(nombre))?.[1]() ?? null;
}
