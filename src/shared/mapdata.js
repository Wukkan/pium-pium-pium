// ---------------------------------------------------------------------------
// Datos del mapa, compartidos entre cliente (Three.js) y servidor (Node).
// Sin dependencias: solo objetos planos.
// ---------------------------------------------------------------------------

export const TOTAL_SLOTS = 10; // jugadores + bots suman esto como máximo
export const MAX_BOTS = 5;     // tope de bots aunque haya pocos jugadores

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
};

export const MAP_SIZE = 76;

// genera las cajas del mapa: {x,y,z,w,h,d,color,collide}
export function buildMapBoxes() {
  const C = COLORS;
  const SIZE = MAP_SIZE;
  const boxes = [];

  const box = (x, y, z, w, h, d, color, collide = true) => {
    boxes.push({ x, y, z, w, h, d, color, collide });
  };

  const stairs = (x, z, dirX, dirZ, width, totalH, color) => {
    const stepH = 0.5, stepD = 0.9;
    const n = Math.ceil(totalH / stepH);
    for (let i = 0; i < n; i++) {
      const h = stepH * (i + 1);
      const px = x + dirX * stepD * i;
      const pz = z + dirZ * stepD * i;
      const w = dirX !== 0 ? stepD : width;
      const d = dirZ !== 0 ? stepD : width;
      box(px, h / 2, pz, w, h, d, color);
    }
  };

  // suelo
  box(0, -0.5, 0, SIZE, 1, SIZE, C.ground);

  // muros perimetrales
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

  // cajas
  const crates = [
    [12, 6, 1], [13.7, 6, 1], [12.85, 6, 2],
    [-12, -6, 1], [-12, -7.7, 1],
    [8, -18, 1], [9.7, -18, 1], [8.85, -18, 2],
    [-8, 18, 1], [-18, 2, 1], [-18, 3.7, 1],
    [18, 14, 1], [30, 5, 1], [30, 6.7, 1], [30, 5.85, 2],
    [-30, -8, 1], [-5, -22, 1], [-6.7, -22, 1],
    [22, -8, 1], [-15, -15, 1], [15, 22, 1], [16.7, 22, 1],
  ];
  for (const [cx, cz, level] of crates) {
    const s = 1.7;
    box(cx, s / 2 + (level - 1) * s, cz, s, s, s, C.crate);
  }

  // barreras bajas
  box(0, 0.6, 22, 8, 1.2, 1, C.barrier);
  box(0, 0.6, -22, 8, 1.2, 1, C.barrier);
  box(22, 0.6, 0, 1, 1.2, 8, C.barrier);
  box(-22, 0.6, 0, 1, 1.2, 8, C.barrier);
  box(11, 0.75, -11, 1, 1.5, 6, C.wall);
  box(-11, 0.75, 11, 1, 1.5, 6, C.wall);

  // postes decorativos
  box(16, 2, 16, 0.5, 4, 0.5, C.accent);
  box(-16, 2, -16, 0.5, 4, 0.5, C.accent);

  return boxes;
}

// colliders AABB planos a partir de las cajas
export function buildColliders(boxes) {
  const list = [];
  for (const b of boxes) {
    if (!b.collide) continue;
    list.push({
      minX: b.x - b.w / 2, minY: b.y - b.h / 2, minZ: b.z - b.d / 2,
      maxX: b.x + b.w / 2, maxY: b.y + b.h / 2, maxZ: b.z + b.d / 2,
    });
  }
  return list;
}

export const PLAYER_SPAWNS = [
  { x: 0, y: 0.1, z: 30 }, { x: 0, y: 0.1, z: -30 },
  { x: 30, y: 0.1, z: 0 }, { x: -30, y: 0.1, z: 0 },
  { x: 30, y: 0.1, z: 30 }, { x: -30, y: 0.1, z: -30 },
];

export const BOT_SPAWNS = [
  { x: 24, y: 5.9, z: -24 }, { x: -24, y: 5.9, z: 24 },
  { x: 18, y: 0.1, z: 18 }, { x: -18, y: 0.1, z: -18 },
  { x: 0, y: 3.1, z: 0 }, { x: -30, y: 0.1, z: 15 },
  { x: 30, y: 0.1, z: -15 }, { x: 0, y: 0.1, z: -32 },
  { x: 15, y: 0.1, z: 28 }, { x: -28, y: 0.1, z: -5 },
];

export const WAYPOINTS = [
  { x: 0, y: 3.1, z: 0 }, { x: 0, y: 0.1, z: 20 },
  { x: 0, y: 0.1, z: -20 }, { x: 20, y: 0.1, z: 0 },
  { x: -20, y: 0.1, z: 0 }, { x: 18, y: 0.1, z: 18 },
  { x: -18, y: 0.1, z: -18 }, { x: 18, y: 0.1, z: -18 },
  { x: -18, y: 0.1, z: 18 }, { x: 30, y: 0.1, z: 30 },
  { x: -30, y: 0.1, z: -30 }, { x: 30, y: 0.1, z: -30 },
  { x: -30, y: 0.1, z: 30 }, { x: 10, y: 0.1, z: -25 },
  { x: -10, y: 0.1, z: 25 }, { x: 25, y: 2.6, z: 25 },
];

export const BOT_NAMES = ['Sgt_Bloq', 'xX_Pixel_Xx', 'NoScopez', 'Guest_4821', 'KritzKrieg', 'ElTrikito', 'Guest_1337', 'SlideGod', 'CampeonDeLag', 'TurboAbuela'];
export const BOT_COLORS = [0xe05252, 0x5278e0, 0x52b86a, 0xc27ad0, 0xe0a052, 0x52c2c2, 0xd0d052, 0xe07ab0, 0x9a8adf, 0x7fbf6a];
