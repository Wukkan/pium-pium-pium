// ---------------------------------------------------------------------------
// Datos de los mapas, compartidos entre cliente (Three.js) y servidor (Node).
// Sin dependencias: solo objetos planos.
// ---------------------------------------------------------------------------

export const TOTAL_SLOTS = 10; // jugadores + bots suman esto como máximo
export const MAX_BOTS = 5;     // tope de bots aunque haya pocos jugadores

export const MAPS = { arena: 'ARENA', ciudad: 'CIUDAD' };

export const COLORS = {
  ground: 0xcfc3a0,
  wall: 0xb5ab8c,
  building1: 0xe8e4da,
  building2: 0xd8b09a,
  building3: 0xa8c8d8,
  roof: 0xc95b4d,
  crate: 0xc09858,
  barrier: 0x8fae72,
  platform: 0xbfb59a,
  accent: 0x5b87a8,
  street: 0x9a9a98,
  pad: 0xffd24d,
};

// -------------------------------------------------------------------------
// Constructores de mapa. Cada uno devuelve:
//   boxes: [{x,y,z,w,h,d,color,collide,crate?}]  (crate = id de caja destruible)
//   playerSpawns / botSpawns / waypoints: [{x,y,z}]
//   jumpPads: [{x,y,z,power}]  (saltadores)
// -------------------------------------------------------------------------

function makeBuilder() {
  const boxes = [];
  let crateSerial = 0;
  const box = (x, y, z, w, h, d, color, collide = true) => {
    boxes.push({ x, y, z, w, h, d, color, collide });
    return boxes[boxes.length - 1];
  };
  // caja destruible (80 pv, reaparece)
  const crate = (x, z, level = 1, s = 1.7) => {
    const b = box(x, s / 2 + (level - 1) * s, z, s, s, s, COLORS.crate);
    b.crate = 'c' + crateSerial++;
    return b;
  };
  const stairs = (x, z, dirX, dirZ, width, totalH, color) => {
    const stepH = 0.5, stepD = 0.9;
    const n = Math.ceil(totalH / stepH);
    for (let i = 0; i < n; i++) {
      const h = stepH * (i + 1);
      box(x + dirX * stepD * i, h / 2, z + dirZ * stepD * i,
        dirX !== 0 ? stepD : width, h, dirZ !== 0 ? stepD : width, color);
    }
  };
  return { boxes, box, crate, stairs };
}

// --- MAPA 1: ARENA (el clásico) ---
function buildArena() {
  const C = COLORS;
  const SIZE = 76;
  const { boxes, box, crate, stairs } = makeBuilder();

  box(0, -0.5, 0, SIZE, 1, SIZE, C.ground);

  const H = 7, T = 2;
  box(0, H / 2, -SIZE / 2 - T / 2, SIZE + T * 2, H, T, C.wall);
  box(0, H / 2, SIZE / 2 + T / 2, SIZE + T * 2, H, T, C.wall);
  box(-SIZE / 2 - T / 2, H / 2, 0, T, H, SIZE, C.wall);
  box(SIZE / 2 + T / 2, H / 2, 0, T, H, SIZE, C.wall);

  // plataforma central con torre
  box(0, 1.5, 0, 16, 3, 16, C.platform);
  box(0, 3.75, -6.5, 16, 1.5, 3, C.accent);
  box(-5, 4.25, 3, 3, 2.5, 3, C.building3);
  box(5, 4.25, 3, 3, 2.5, 3, C.building3);
  stairs(0, 12, 0, -1, 6, 3, C.platform);
  stairs(0, -12, 0, 1, 6, 3, C.platform);

  // edificios de esquina
  box(24, 2.5, -24, 12, 5, 10, C.building1);
  box(24, 5.4, -24, 13, 0.8, 11, C.roof);
  stairs(24, -15.5, 0, -1, 4, 5, C.building1);

  box(-24, 2.5, 24, 12, 5, 10, C.building2);
  box(-24, 5.4, 24, 13, 0.8, 11, C.roof);
  stairs(-24, 15.5, 0, 1, 4, 5, C.building2);

  box(-25, 2, -25, 10, 4, 10, C.building3);
  box(-25, 4.7, -25, 11, 1, 11, C.roof);
  box(-27.5, 5.7, -27.5, 5, 1, 5, C.building3);
  stairs(-25, -16.5, 0, -1, 4, 4, C.building3);

  box(25, 1.25, 25, 12, 2.5, 12, C.building1);
  box(25, 3, 19.5, 12, 1, 1, C.barrier);
  box(19.5, 3, 25, 1, 1, 12, C.barrier);

  // cajas (las de nivel 1 son destruibles)
  crate(12, 6); crate(13.7, 6); crate(12.85, 6, 2);
  crate(-12, -6); crate(-12, -7.7);
  crate(8, -18); crate(9.7, -18); crate(8.85, -18, 2);
  crate(-8, 18); crate(-18, 2); crate(-18, 3.7);
  crate(18, 14); crate(30, -5); crate(30, -6.7); crate(30, -5.85, 2);
  crate(-30, -8); crate(-5, -22); crate(-6.7, -22);
  crate(22, -8); crate(-15, -15); crate(15, 22); crate(16.7, 22);

  // barreras bajas
  box(0, 0.6, 22, 8, 1.2, 1, C.barrier);
  box(0, 0.6, -22, 8, 1.2, 1, C.barrier);
  box(22, 0.6, 0, 1, 1.2, 8, C.barrier);
  box(-22, 0.6, 0, 1, 1.2, 8, C.barrier);
  box(11, 0.75, -11, 1, 1.5, 6, C.wall);
  box(-11, 0.75, 11, 1, 1.5, 6, C.wall);

  box(16, 2, 16, 0.5, 4, 0.5, C.accent);
  box(-16, 2, -16, 0.5, 4, 0.5, C.accent);

  // torre de vigilancia (muro este)
  box(35, 3.25, 6, 1.6, 6.5, 1.6, C.accent);
  box(35, 6.25, 6, 5.5, 0.5, 6, C.platform);
  box(35, 6.9, 8.8, 5.5, 0.8, 0.4, C.barrier);
  box(35, 6.9, 3.2, 5.5, 0.8, 0.4, C.barrier);
  box(37.55, 6.9, 6, 0.4, 0.8, 6, C.barrier);
  box(35, 8.9, 6, 0.3, 3, 0.3, C.roof);
  stairs(24, 6, 1, 0, 3, 6.5, C.platform);

  // pasaje cubierto (muro oeste): galería con techo sobre pilares
  for (let i = 0; i < 5; i++) {
    box(-33, 1.5, -16 + i * 8, 0.8, 3, 0.8, C.accent);
    box(-29.5, 1.5, -16 + i * 8, 0.8, 3, 0.8, C.accent);
  }
  box(-31.25, 3.4, 0, 6.5, 0.8, 34, C.roof);

  // saltadores: te lanzan a la plataforma central y al tejado NE
  const jumpPads = [
    { x: 12, y: 0, z: 0, power: 13 },
    { x: 24, y: 0, z: -13, power: 15 },
  ];
  for (const p of jumpPads) box(p.x, 0.1, p.z, 1.6, 0.2, 1.6, C.pad);

  return {
    boxes,
    jumpPads,
    playerSpawns: [
      { x: 0, y: 0.1, z: 30 }, { x: 0, y: 0.1, z: -30 },
      { x: 30, y: 0.1, z: 0 }, { x: -30, y: 0.1, z: 0 },
      { x: 30, y: 0.1, z: 30 }, { x: -30, y: 0.1, z: -30 },
    ],
    botSpawns: [
      { x: 24, y: 5.9, z: -24 }, { x: -24, y: 5.9, z: 24 },
      { x: 18, y: 0.1, z: 18 }, { x: -18, y: 0.1, z: -18 },
      { x: 0, y: 3.1, z: 0 }, { x: -30, y: 0.1, z: 15 },
      { x: 30, y: 0.1, z: -15 }, { x: 0, y: 0.1, z: -32 },
      { x: 15, y: 0.1, z: 28 }, { x: -28, y: 0.1, z: -5 },
    ],
    waypoints: [
      { x: 0, y: 3.1, z: 0 }, { x: 0, y: 0.1, z: 20 },
      { x: 0, y: 0.1, z: -20 }, { x: 20, y: 0.1, z: 0 },
      { x: -20, y: 0.1, z: 0 }, { x: 18, y: 0.1, z: 18 },
      { x: -18, y: 0.1, z: -18 }, { x: 18, y: 0.1, z: -18 },
      { x: -18, y: 0.1, z: 18 }, { x: 30, y: 0.1, z: 30 },
      { x: -30, y: 0.1, z: -30 }, { x: 30, y: 0.1, z: -30 },
      { x: -30, y: 0.1, z: 30 }, { x: 10, y: 0.1, z: -25 },
      { x: -31, y: 0.1, z: 0 }, { x: 25, y: 2.6, z: 25 },
      { x: 35, y: 6.6, z: 6 },
    ],
  };
}

// --- MAPA 2: CIUDAD (calles en cruz y azoteas) ---
function buildCiudad() {
  const C = COLORS;
  const SIZE = 72;
  const { boxes, box, crate, stairs } = makeBuilder();

  box(0, -0.5, 0, SIZE, 1, SIZE, C.street);

  const H = 8, T = 2;
  box(0, H / 2, -SIZE / 2 - T / 2, SIZE + T * 2, H, T, C.wall);
  box(0, H / 2, SIZE / 2 + T / 2, SIZE + T * 2, H, T, C.wall);
  box(-SIZE / 2 - T / 2, H / 2, 0, T, H, SIZE, C.wall);
  box(SIZE / 2 + T / 2, H / 2, 0, T, H, SIZE, C.wall);

  // manzanas de edificios en los 4 cuadrantes (calles en cruz de 10 de ancho)
  // cuadrante NE
  box(19, 2.5, -19, 14, 5, 12, C.building1);
  box(19, 5.3, -19, 15, 0.6, 13, C.roof);
  stairs(19, -11.5, 0, -1, 4, 5, C.building1);
  box(30, 3.5, -28, 8, 7, 8, C.building3);

  // cuadrante NO
  box(-19, 3, -20, 12, 6, 14, C.building2);
  box(-19, 6.3, -20, 13, 0.6, 15, C.roof);
  stairs(-24.5, -11.5, 0, -1, 4, 6, C.building2);
  box(-30, 2, -8, 6, 4, 6, C.building1);
  box(-30, 4.3, -8, 7, 0.6, 7, C.roof);

  // cuadrante SO
  box(-20, 2.5, 19, 14, 5, 12, C.building3);
  box(-20, 5.3, 19, 15, 0.6, 13, C.roof);
  stairs(-20, 11.5, 0, 1, 4, 5, C.building3);
  box(-30, 3.5, 29, 8, 7, 8, C.building2);

  // cuadrante SE
  box(19, 3, 20, 12, 6, 14, C.building1);
  box(19, 6.3, 20, 13, 0.6, 15, C.roof);
  stairs(24.5, 11.5, 0, 1, 4, 6, C.building1);
  box(30, 2, 8, 6, 4, 6, C.building2);
  box(30, 4.3, 8, 7, 0.6, 7, C.roof);

  // plaza central: fuente y coberturas
  box(0, 0.5, 0, 4, 1, 4, C.accent);
  box(0, 1.2, 0, 2.5, 0.5, 2.5, C.building3);
  box(8, 0.6, 8, 5, 1.2, 1, C.barrier);
  box(-8, 0.6, -8, 5, 1.2, 1, C.barrier);
  box(8, 0.6, -8, 1, 1.2, 5, C.barrier);
  box(-8, 0.6, 8, 1, 1.2, 5, C.barrier);

  // puente entre azoteas NE y SE (cruza la calle este)
  box(19, 5.9, 0, 4, 0.4, 26, C.platform);
  box(21.2, 6.5, 0, 0.4, 0.8, 26, C.barrier);
  box(16.8, 6.5, 0, 0.4, 0.8, 26, C.barrier);

  // cajas por las calles (destruibles)
  crate(6, -14); crate(7.7, -14); crate(6.85, -14, 2);
  crate(-6, 14); crate(-7.7, 14);
  crate(-14, -6); crate(14, 6); crate(15.7, 6);
  crate(5, -26); crate(-5, 26); crate(-26, 5); crate(26, -5);
  crate(6.7, -26); crate(-6.7, 26);

  // callejón cubierto al sur (túnel urbano)
  for (let i = 0; i < 4; i++) {
    box(-12 + i * 8, 1.5, 31, 0.8, 3, 0.8, C.accent);
  }
  box(0, 3.4, 31, 28, 0.8, 5, C.roof);

  // saltadores a las azoteas
  const jumpPads = [
    { x: 12, y: 0, z: -12, power: 14 },
    { x: -12, y: 0, z: 12, power: 14 },
    { x: 0, y: 0, z: -6, power: 12 },
  ];
  for (const p of jumpPads) box(p.x, 0.1, p.z, 1.6, 0.2, 1.6, C.pad);

  return {
    boxes,
    jumpPads,
    playerSpawns: [
      { x: 0, y: 0.1, z: 30 }, { x: 0, y: 0.1, z: -30 },
      { x: 30, y: 0.1, z: 0 }, { x: -30, y: 0.1, z: 0 },
      { x: 30, y: 0.1, z: 30 }, { x: -30, y: 0.1, z: -30 },
    ],
    botSpawns: [
      { x: 19, y: 5.7, z: -19 }, { x: -20, y: 5.7, z: 19 },
      { x: 0, y: 0.1, z: -20 }, { x: 0, y: 0.1, z: 20 },
      { x: 26, y: 0.1, z: -4 }, { x: -26, y: 0.1, z: 4 },
      { x: 4, y: 0.1, z: 0 }, { x: 19, y: 6.2, z: 0 },
      { x: -30, y: 0.1, z: 20 }, { x: 30, y: 0.1, z: -20 },
    ],
    waypoints: [
      { x: 0, y: 0.1, z: 0 }, { x: 0, y: 0.1, z: 24 },
      { x: 0, y: 0.1, z: -24 }, { x: 24, y: 0.1, z: 0 },
      { x: -24, y: 0.1, z: 0 }, { x: 19, y: 5.7, z: -19 },
      { x: -20, y: 5.7, z: 19 }, { x: 19, y: 6.2, z: 0 },
      { x: 28, y: 0.1, z: 28 }, { x: -28, y: 0.1, z: -28 },
      { x: 28, y: 0.1, z: -28 }, { x: -28, y: 0.1, z: 28 },
      { x: 0, y: 0.1, z: 31 }, { x: -30, y: 0.1, z: -8 },
    ],
  };
}

const BUILDERS = { arena: buildArena, ciudad: buildCiudad };

export function buildMap(mapId) {
  return (BUILDERS[mapId] || buildArena)();
}

// colliders AABB planos (los de cajas destruibles llevan su id)
export function buildColliders(boxes) {
  const list = [];
  for (const b of boxes) {
    if (!b.collide) continue;
    const col = {
      minX: b.x - b.w / 2, minY: b.y - b.h / 2, minZ: b.z - b.d / 2,
      maxX: b.x + b.w / 2, maxY: b.y + b.h / 2, maxZ: b.z + b.d / 2,
    };
    if (b.crate) col.crate = b.crate;
    list.push(col);
  }
  return list;
}

export const BOT_NAMES = ['Sgt_Bloq', 'xX_Pixel_Xx', 'NoScopez', 'Guest_4821', 'KritzKrieg', 'ElTrikito', 'Guest_1337', 'SlideGod', 'CampeonDeLag', 'TurboAbuela'];
export const BOT_COLORS = [0xe05252, 0x5278e0, 0x52b86a, 0xc27ad0, 0xe0a052, 0x52c2c2, 0xd0d052, 0xe07ab0, 0x9a8adf, 0x7fbf6a];

// niveles de cuenta según bajas totales del ranking mundial
export const LEVELS = [
  { min: 500, badge: '👑', name: 'LEYENDA' },
  { min: 150, badge: '🥇', name: 'MAESTRO' },
  { min: 50, badge: '🥈', name: 'VETERANO' },
  { min: 10, badge: '🥉', name: 'SOLDADO' },
  { min: 0, badge: '', name: 'NOVATO' },
];

export function badgeFor(totalKills) {
  for (const l of LEVELS) if (totalKills >= l.min) return l.badge;
  return '';
}

// sombreros comprables (id → precio)
export const HATS = {
  none: { name: 'Sin sombrero', price: 0 },
  cap: { name: 'Gorra', price: 200 },
  top: { name: 'Chistera', price: 500 },
  crown: { name: 'Corona', price: 1500 },
};

// mensajes del chat rápido (tecla C + 1..6)
export const QUICK_CHAT = ['¡Hola!', '¡Buen tiro!', '¡Ayuda aquí!', 'jajajaja', '¡GG!', 'PIUM PIUM PIUM 🔫'];
