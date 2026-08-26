// ---------------------------------------------------------------------------
// Datos de los mapas, compartidos entre cliente (Three.js) y servidor (Node).
// Sin dependencias: solo objetos planos.
// ---------------------------------------------------------------------------

export const TOTAL_SLOTS = 10; // jugadores + bots suman esto como máximo
export const MAX_BOTS = 5;     // tope de bots aunque haya pocos jugadores
export const JUMP_PAD_TRIGGER_RADIUS_SQ = 1.3;
export const JUMP_PAD_TRIGGER_HEIGHT = 0.8;

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

const finitePadPoint = (point) => !!point && Number.isFinite(point.x) &&
  Number.isFinite(point.y) && Number.isFinite(point.z);

export function jumpPadContainsPoint(point, pad) {
  if (!finitePadPoint(point) || !finitePadPoint(pad)) return false;
  const dx = point.x - pad.x, dz = point.z - pad.z;
  return dx * dx + dz * dz < JUMP_PAD_TRIGGER_RADIUS_SQ &&
    Math.abs(point.y - pad.y) < JUMP_PAD_TRIGGER_HEIGHT;
}

export function applyJumpPadImpulse(velocity, pad) {
  if (!velocity || !finitePadPoint(pad)) return false;
  const power = Number(pad.power);
  if (!Number.isFinite(power) || power <= 0) return false;
  velocity.x = Number.isFinite(Number(velocity.x)) ? Number(velocity.x) : 0;
  velocity.y = Math.max(Number.isFinite(Number(velocity.y)) ? Number(velocity.y) : 0, power);
  velocity.z = Number.isFinite(Number(velocity.z)) ? Number(velocity.z) : 0;

  const directionX = Number(pad.direction?.x);
  const directionZ = Number(pad.direction?.z);
  const directionLength = Math.hypot(directionX, directionZ);
  const minimumSpeed = Math.max(0, Number(pad.minHorizontalSpeed) || 0);
  if (directionLength > 0 && minimumSpeed > 0) {
    const nx = directionX / directionLength;
    const nz = directionZ / directionLength;
    const forwardSpeed = velocity.x * nx + velocity.z * nz;
    if (forwardSpeed < minimumSpeed) {
      const boost = minimumSpeed - forwardSpeed;
      velocity.x += nx * boost;
      velocity.z += nz * boost;
    }
  }
  return true;
}

// El servidor recibe posiciones discretas. Esta prueba analítica confirma que
// el segmento entre ambas cruzó el mismo cilindro que usa el cliente, sin
// ampliar de forma invisible el área que autoriza un salto vertical.
export function jumpPadIntersectsSegment(start, end, pad) {
  if (!finitePadPoint(start) || !finitePadPoint(end) || !finitePadPoint(pad)) return false;
  const dx = end.x - start.x, dz = end.z - start.z;
  const fx = start.x - pad.x, fz = start.z - pad.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - JUMP_PAD_TRIGGER_RADIUS_SQ;
  let horizontalMin = 0, horizontalMax = 1;

  if (a <= 1e-9) {
    if (c >= 0) return false;
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant <= 0) return false;
    const root = Math.sqrt(discriminant);
    horizontalMin = Math.max(0, (-b - root) / (2 * a));
    horizontalMax = Math.min(1, (-b + root) / (2 * a));
    if (horizontalMin >= horizontalMax) return false;
  }

  const dy = end.y - start.y;
  const fy = start.y - pad.y;
  let verticalMin = 0, verticalMax = 1;
  if (Math.abs(dy) <= 1e-9) {
    if (Math.abs(fy) >= JUMP_PAD_TRIGGER_HEIGHT) return false;
  } else {
    const first = (-JUMP_PAD_TRIGGER_HEIGHT - fy) / dy;
    const second = (JUMP_PAD_TRIGGER_HEIGHT - fy) / dy;
    verticalMin = Math.max(0, Math.min(first, second));
    verticalMax = Math.min(1, Math.max(first, second));
    if (verticalMin >= verticalMax) return false;
  }
  return Math.max(horizontalMin, verticalMin) < Math.min(horizontalMax, verticalMax);
}

// -------------------------------------------------------------------------
// Constructores de mapa. Cada uno devuelve:
//   boxes: [{x,y,z,w,h,d,color,collide,crate?}]  (crate = id de caja destruible)
//   playerSpawns / botSpawns / waypoints: [{x,y,z}]
//   jumpPads: [{x,y,z,power}]  (saltadores)
// -------------------------------------------------------------------------

function makeBuilder() {
  const boxes = [];
  const navigationRoutes = [];
  const navigationRoute = (points) => {
    const routeId = navigationRoutes.length;
    const route = points.map((point, navigationOrder) => ({
      ...point,
      navigationRoute: routeId,
      navigationOrder,
    }));
    navigationRoutes.push(route);
    return route;
  };
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
    const route = [{
      x: x - dirX * stepD,
      y: 0.001,
      z: z - dirZ * stepD,
    }];
    for (let i = 0; i < n; i++) {
      const h = stepH * (i + 1);
      const stepX = x + dirX * stepD * i;
      const stepZ = z + dirZ * stepD * i;
      box(stepX, h / 2, stepZ,
        dirX !== 0 ? stepD : width, h, dirZ !== 0 ? stepD : width, color);
      route.push({ x: stepX, y: h + 0.001, z: stepZ });
    }
    return navigationRoute(route);
  };
  return { boxes, box, crate, stairs, navigationRoutes, navigationRoute };
}

// --- MAPA 1: ARENA (el clásico) ---
function buildArena() {
  const C = COLORS;
  const SIZE = 76;
  const { boxes, box, crate, stairs, navigationRoutes, navigationRoute } = makeBuilder();

  const H = 7, T = 2;
  // El suelo continúa bajo los muros; no se limita a tocar su borde interior.
  box(0, -0.5, 0, SIZE + T * 2, 1, SIZE + T * 2, C.ground);

  box(0, H / 2, -SIZE / 2 - T / 2, SIZE + T * 2, H, T, C.wall);
  box(0, H / 2, SIZE / 2 + T / 2, SIZE + T * 2, H, T, C.wall);
  box(-SIZE / 2 - T / 2, H / 2, 0, T, H, SIZE, C.wall);
  box(SIZE / 2 + T / 2, H / 2, 0, T, H, SIZE, C.wall);

  // plataforma central con torre
  box(0, 1.5, 0, 16, 3, 16, C.platform);
  // El parapeto norte conserva cobertura a ambos lados, pero deja un vano
  // real frente a la escalera. El bloque único anterior cerraba el rellano.
  box(-5.5, 3.75, -6.5, 5, 1.5, 3, C.accent);
  box(5.5, 3.75, -6.5, 5, 1.5, 3, C.accent);
  box(-5, 4.25, 3, 3, 2.5, 3, C.building3);
  box(5, 4.25, 3, 3, 2.5, 3, C.building3);
  // Los últimos peldaños terminan justo en la fachada. No deben penetrar el
  // AABB macizo de la plataforma o el jugador queda atrapado bajo el rellano.
  stairs(0, 12.95, 0, -1, 6, 3, C.platform);
  stairs(0, -12.95, 0, 1, 6, 3, C.platform);

  // edificios de esquina
  box(24, 2.5, -24, 12, 5, 10, C.building1);
  box(24, 5.4, -24, 13, 0.8, 11, C.roof);
  stairs(24, -9.05, 0, -1, 4, 5.5, C.building1);

  box(-24, 2.5, 24, 12, 5, 10, C.building2);
  box(-24, 5.4, 24, 13, 0.8, 11, C.roof);
  stairs(-24, 9.05, 0, 1, 4, 5.5, C.building2);

  box(-25, 2, -25, 10, 4, 10, C.building3);
  // El alero solapa exactamente base y torre: no queda una franja flotante.
  box(-25, 4.6, -25, 11, 1.2, 11, C.roof);
  box(-27.5, 5.7, -27.5, 5, 1, 5, C.building3);
  stairs(-25, -10.95, 0, -1, 4, 5, C.building3);

  box(25, 1.25, 25, 12, 2.5, 12, C.building1);
  box(25, 3, 19.5, 12, 1, 1, C.barrier);
  box(19.5, 3, 25, 1, 1, 12, C.barrier);

  // cajas (las de nivel 1 son destruibles)
  crate(12, 6); crate(13.7, 6); crate(12.85, 6, 2);
  crate(-12, -6); crate(-12, -7.7);
  crate(8, -18); crate(9.7, -18); crate(8.85, -18, 2);
  crate(-8, 18); crate(-18, 2); crate(-18, 3.7);
  crate(18, 14); crate(30, -5); crate(30, -6.7); crate(30, -5.85, 2);
  // Fuera del pilar de la galería: destruirla ya no cambia una colisión
  // compuesta e impredecible.
  crate(-27, -8); crate(-5, -22); crate(-6.7, -22);
  // Mantiene libre todo el ancho del acceso NE.
  crate(18, -8); crate(-14, -15); crate(15, 22); crate(16.7, 22);

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
  // Mástil continuo desde la plataforma, sin el hueco vertical anterior.
  box(35, 8.45, 6, 0.3, 3.9, 0.3, C.roof);
  // Doce peldaños y un último step-up de 0.5 mantienen el acceso continuo sin
  // añadir geometría innecesaria al presupuesto del mapa.
  stairs(21.9, 6, 1, 0, 3, 6, C.platform);

  // pasaje cubierto (muro oeste): galería con techo sobre pilares
  for (let i = 0; i < 5; i++) {
    box(-33, 1.5, -16 + i * 8, 0.8, 3, 0.8, C.accent);
    box(-29.5, 1.5, -16 + i * 8, 0.8, 3, 0.8, C.accent);
  }
  box(-31.25, 3.4, 0, 6.5, 0.8, 34, C.roof);

  // saltadores: te lanzan a la plataforma central y al tejado NE
  const jumpPads = [
    { x: 12, y: 0, z: 0, power: 13, direction: { x: -1, z: 0 }, minHorizontalSpeed: 6 },
    // Separado de la escalera NE y con altura útil para alcanzar la azotea.
    { x: 18, y: 0, z: -13, power: 18, direction: { x: 0, z: -1 }, minHorizontalSpeed: 6 },
  ];
  // 1.6 × 1.6 queda completamente dentro del trigger circular (incluidas las
  // cuatro esquinas), así toda la superficie amarilla es funcional.
  for (const p of jumpPads) box(p.x, 0.1, p.z, 1.6, 0.2, 1.6, C.pad);

  const waypoints = [
    { x: 0, y: 3.1, z: 0 }, { x: 0, y: 0.1, z: 20 },
    { x: 0, y: 0.1, z: -20 }, { x: 20, y: 0.1, z: 0 },
    { x: -20, y: 0.1, z: 0 }, { x: 18, y: 0.1, z: 18 },
    { x: -18, y: 0.1, z: -18 }, { x: 18, y: 0.1, z: -18 },
    { x: -18, y: 0.1, z: 18 }, { x: 34, y: 0.1, z: 32 },
    { x: -34, y: 0.1, z: -33 }, { x: 30, y: 0.1, z: -30 },
    { x: -30, y: 0.1, z: 30 }, { x: 10, y: 0.1, z: -25 },
    { x: -31, y: 0.1, z: 0 },
    // La plataforma SE no tiene una subida fisica; no se publica como nodo
    // para evitar spawns/rutas zombis aislados sobre ella.
    { x: 34, y: 6.6, z: 6 }, { x: 30, y: 0.1, z: -10 },
  ];
  // Circuito exterior continuo. Las estructuras de Arena separan algunos
  // waypoints visualmente cercanos (en especial la escalera NE y la galería
  // oeste); esta cadena ofrece una salida terrestre determinista sin usar
  // falsas diagonales a través de edificios o huecos.
  navigationRoute([
    { x: 32, y: 0.1, z: -34 }, { x: 32, y: 0.1, z: -12 },
    { x: 32, y: 0.1, z: 0 }, { x: 32, y: 0.1, z: 16 },
    { x: 32, y: 0.1, z: 34 }, { x: 0, y: 0.1, z: 34 },
    { x: -20, y: 0.1, z: 34 }, { x: -35, y: 0.1, z: 34 },
    { x: -35, y: 0.1, z: 20 }, { x: -35, y: 0.1, z: 0 },
    { x: -35, y: 0.1, z: -20 }, { x: -35, y: 0.1, z: -34 },
    { x: -18, y: 0.1, z: -34 }, { x: 0, y: 0.1, z: -34 },
    { x: 18, y: 0.1, z: -34 }, { x: 32, y: 0.1, z: -34 },
  ]);
  const navigationPoints = [
    ...waypoints,
    ...navigationRoutes.flat(),
    // Rellano explícito del alero suroeste; evita que la torre del tejado
    // invalide el enlace largo desde el último peldaño.
    { x: -25, y: 5.201, z: -20 },
  ];

  return {
    boxes,
    jumpPads,
    playerSpawns: [
      { x: 0, y: 0.1, z: 30 }, { x: 0, y: 0.1, z: -30 },
      { x: 30, y: 0.1, z: 0 }, { x: -26, y: 0.1, z: 0 },
      { x: 34, y: 0.1, z: 32 }, { x: -34, y: 0.1, z: -33 },
      { x: 33.5, y: 0.1, z: -33.5 }, { x: -33, y: 0.1, z: 33 },
      { x: 32, y: 0.1, z: 13 }, { x: -20, y: 0.1, z: -13 },
    ],
    botSpawns: [
      { x: 24, y: 5.9, z: -24 }, { x: -24, y: 5.9, z: 24 },
      { x: 18, y: 0.1, z: 18 }, { x: -18, y: 0.1, z: -18 },
      { x: 0, y: 3.1, z: 0 }, { x: -30, y: 0.1, z: 15 },
      { x: 30, y: 0.1, z: -15 }, { x: 0, y: 0.1, z: -32 },
      { x: 15, y: 0.1, z: 28 }, { x: -28, y: 0.1, z: -5 },
    ],
    waypoints,
    navigationPoints,
  };
}

// --- MAPA 2: CIUDAD (calles en cruz y azoteas) ---
function buildCiudad() {
  const C = COLORS;
  const SIZE = 72;
  const { boxes, box, crate, stairs, navigationRoutes, navigationRoute } = makeBuilder();

  const H = 8, T = 2;
  // La calle base continúa bajo los muros para formar una cubeta cerrada.
  box(0, -0.5, 0, SIZE + T * 2, 1, SIZE + T * 2, C.street);

  box(0, H / 2, -SIZE / 2 - T / 2, SIZE + T * 2, H, T, C.wall);
  box(0, H / 2, SIZE / 2 + T / 2, SIZE + T * 2, H, T, C.wall);
  box(-SIZE / 2 - T / 2, H / 2, 0, T, H, SIZE, C.wall);
  box(SIZE / 2 + T / 2, H / 2, 0, T, H, SIZE, C.wall);

  // manzanas de edificios en los 4 cuadrantes (calles en cruz de 10 de ancho)
  // cuadrante NE
  box(19, 2.5, -19, 14, 5, 12, C.building1);
  // La azotea alcanza la cara inferior del puente (y=5.7).
  box(19, 5.35, -19, 15, 0.7, 13, C.roof);
  // Fuera de la proyección del puente para conservar altura de cabeza.
  stairs(24, -3.05, 0, -1, 4, 5.5, C.building1);
  box(30, 3.5, -28, 8, 7, 8, C.building3);

  // cuadrante NO
  box(-19, 3, -20, 12, 6, 14, C.building2);
  box(-19, 6.3, -20, 13, 0.6, 15, C.roof);
  stairs(-23.5, -1.25, 0, -1, 4, 6.5, C.building2);
  box(-30, 2, -8, 6, 4, 6, C.building1);
  box(-30, 4.3, -8, 7, 0.6, 7, C.roof);

  // cuadrante SO
  box(-20, 2.5, 19, 14, 5, 12, C.building3);
  box(-20, 5.3, 19, 15, 0.6, 13, C.roof);
  stairs(-20, 3.05, 0, 1, 4, 5.5, C.building3);
  box(-30, 3.5, 29, 8, 7, 8, C.building2);

  // cuadrante SE
  box(19, 3, 20, 12, 6, 14, C.building1);
  box(19, 6.3, 20, 13, 0.6, 15, C.roof);
  // Medio metro hacia el este evita que el carril interior penetre 0.1 m en
  // el tablero del puente al alcanzar los últimos peldaños.
  stairs(24, 1.25, 0, 1, 4, 6.5, C.building1);
  box(30, 2, 8, 6, 4, 6, C.building2);
  box(30, 4.3, 8, 7, 0.6, 7, C.roof);

  // plaza central: fuente y coberturas
  box(0, 0.5, 0, 4, 1, 4, C.accent);
  box(0, 1.2, 0, 2.5, 0.5, 2.5, C.building3);
  box(8, 0.6, 8, 5, 1.2, 1, C.barrier);
  box(-8, 0.6, -8, 5, 1.2, 1, C.barrier);
  box(8, 0.6, -8, 1, 1.2, 5, C.barrier);
  box(-8, 0.6, 8, 1, 1.2, 5, C.barrier);

  // Puente entre azoteas NE y SE. Los tres tramos absorben la diferencia de
  // altura en pasos de 0.25 o menos. Las barandas se retiran de las juntas y
  // el tablero es más ancho para que sus carriles extremos sean transitables.
  box(19, 5.8, -11.75, 5.2, 0.2, 1.6, C.platform);
  box(19, 6, 0, 5.2, 0.2, 22.4, C.platform);
  box(19, 6.225, 11.75, 5.2, 0.25, 1.6, C.platform);
  box(21.45, 6.5, 0, 0.3, 0.8, 21.2, C.barrier);
  box(16.55, 6.5, 0, 0.3, 0.8, 21.2, C.barrier);

  // cajas por las calles (destruibles)
  crate(6, -14); crate(7.7, -14); crate(6.85, -14, 2);
  crate(-6, 14); crate(-7.7, 14);
  crate(-14, -6); crate(14, 6); crate(15.7, 6);
  crate(5, -26); crate(-5, 26); crate(-26, 5); crate(27, -2);
  crate(6.7, -26); crate(-6.7, 26);

  // callejón cubierto al sur (túnel urbano)
  for (let i = 0; i < 4; i++) {
    box(-12 + i * 8, 1.5, 31, 0.8, 3, 0.8, C.accent);
  }
  box(0, 3.4, 31, 28, 0.8, 5, C.roof);

  // saltadores a las azoteas
  const jumpPads = [
    // Con 4.5 m de aproximación horizontal se gana altura antes de cruzar el
    // alero; en z=±12 el jugador rápido golpeaba su cara inferior.
    { x: 13, y: 0, z: -8, power: 17.5, direction: { x: 0, z: -1 }, minHorizontalSpeed: 6 },
    { x: -13, y: 0, z: 8, power: 17.5, direction: { x: 0, z: 1 }, minHorizontalSpeed: 6 },
    { x: 0, y: 0, z: -6, power: 12 },
  ];
  for (const p of jumpPads) box(p.x, 0.1, p.z, 1.6, 0.2, 1.6, C.pad);

  const waypoints = [
    { x: 0, y: 0.1, z: 6 }, { x: 0, y: 0.1, z: 24 },
    { x: 0, y: 0.1, z: -24 }, { x: 24, y: 0.1, z: 0 },
    { x: -24, y: 0.1, z: 0 }, { x: 19, y: 5.7, z: -19 },
    { x: -20, y: 5.7, z: 19 }, { x: 19, y: 6.2, z: 0 },
    { x: 28, y: 0.1, z: 28 }, { x: -28, y: 0.1, z: -28 },
    { x: 30, y: 0.1, z: -20 }, { x: -30, y: 0.1, z: 20 },
    { x: 0, y: 0.1, z: 31 }, { x: -30, y: 0.1, z: -16 },
    { x: -34, y: 0.1, z: -34 }, { x: -34, y: 0.1, z: 34 },
    { x: 34, y: 0.1, z: -34 },
    { x: -6, y: 0.1, z: -2 },
  ];
  navigationRoute([
    { x: 19, y: 5.701, z: -13 },
    { x: 19, y: 5.901, z: -11.75 },
    { x: 19, y: 6.101, z: 0 },
    { x: 19, y: 6.351, z: 11.75 },
    { x: 19, y: 6.601, z: 13 },
    { x: 19, y: 6.601, z: 20 },
  ]);
  // Anillo exterior con giros físicos alrededor de las cuatro manzanas. Los
  // antiguos puntos de esquina estaban aislados por los edificios; esta ruta
  // permite alcanzar todos los spawns sin diagonales falsas sobre fachadas.
  navigationRoute([
    { x: 35, y: 0.1, z: -34 }, { x: 35, y: 0.1, z: -20 },
    { x: 35, y: 0.1, z: -4 }, { x: 35, y: 0.1, z: 4 },
    { x: 35, y: 0.1, z: 20 }, { x: 35, y: 0.1, z: 34 },
    { x: 0, y: 0.1, z: 34 }, { x: -35, y: 0.1, z: 34 },
    { x: -35, y: 0.1, z: 20 }, { x: -35, y: 0.1, z: 4 },
    { x: -35, y: 0.1, z: -4 }, { x: -35, y: 0.1, z: -20 },
    { x: -35, y: 0.1, z: -34 }, { x: 0, y: 0.1, z: -34 },
    { x: 35, y: 0.1, z: -34 },
  ]);
  const navigationPoints = [
    ...waypoints,
    ...navigationRoutes.flat(),
    // Corredores a ras de calle alrededor de las manzanas. Mantienen a los
    // zombis en su nivel cuando rodean una fachada, sin confundir una escalera
    // con un atajo hacia otro objetivo del suelo.
    { x: 0, y: 0.1, z: -4 }, { x: 26.5, y: 0.1, z: -4 },
    { x: 0, y: 0.1, z: 4 }, { x: 26.5, y: 0.1, z: 4 },
    { x: -26, y: 0.1, z: -4 }, { x: -24, y: 0.1, z: 4 },
  ];

  return {
    boxes,
    jumpPads,
    playerSpawns: [
      { x: 0, y: 0.1, z: 30 }, { x: 0, y: 0.1, z: -30 },
      { x: 30, y: 0.1, z: 0 }, { x: -30, y: 0.1, z: 0 },
      { x: 30, y: 0.1, z: 30 }, { x: -30, y: 0.1, z: -30 },
      { x: -30, y: 0.1, z: 20 }, { x: 30, y: 0.1, z: -20 },
      { x: 30, y: 0.1, z: 20 }, { x: -30, y: 0.1, z: -20 },
    ],
    botSpawns: [
      { x: 19, y: 5.7, z: -19 }, { x: -20, y: 5.7, z: 19 },
      { x: 0, y: 0.1, z: -20 }, { x: 0, y: 0.1, z: 20 },
      { x: 28, y: 0.1, z: -10 }, { x: -26, y: 0.1, z: 10 },
      { x: 4, y: 0.1, z: 0 }, { x: 19, y: 6.2, z: 0 },
      { x: -30, y: 0.1, z: 20 }, { x: 30, y: 0.1, z: -20 },
    ],
    waypoints,
    navigationPoints,
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
