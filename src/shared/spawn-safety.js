// ---------------------------------------------------------------------------
// Spawn seguro compartido por cliente y servidor.
//
// Las posiciones representan los PIES de la entidad. Un punto solo es válido
// si el cuerpo completo cabe, tiene una superficie de apoyo y conserva el
// margen pedido frente a toda la geometría, incluidas las cajas destruibles.
// ---------------------------------------------------------------------------

export const PLAYER_BODY = Object.freeze({ halfX: 0.38, halfZ: 0.38, height: 1.8 });
export const BOT_BODY = Object.freeze({ halfX: 0.35, halfZ: 0.35, height: 1.8 });

const DEFAULT_SUPPORT_TOLERANCE = 0.16;
const POSITION_EPSILON = 0.001;
const SAME_SPAWN_HORIZONTAL_EPSILON = 0.02;
const SAME_SPAWN_VERTICAL_EPSILON = 0.2;

function finitePoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function finiteCollider(collider) {
  return !!collider &&
    Number.isFinite(collider.minX) && Number.isFinite(collider.maxX) &&
    Number.isFinite(collider.minY) && Number.isFinite(collider.maxY) &&
    Number.isFinite(collider.minZ) && Number.isFinite(collider.maxZ);
}

function bodyShape(body, margin = 0, headroom = 0) {
  const halfX = Math.max(0, Number(body?.halfX) || 0) + Math.max(0, Number(margin) || 0);
  const halfZ = Math.max(0, Number(body?.halfZ) || 0) + Math.max(0, Number(margin) || 0);
  const height = Math.max(0, Number(body?.height) || 0) + Math.max(0, Number(headroom) || 0);
  return { halfX, halfZ, height };
}

export function bodyOverlapsCollider(point, collider, body = PLAYER_BODY, margin = 0, headroom = 0) {
  if (!finitePoint(point) || !finiteCollider(collider)) return false;
  const shape = bodyShape(body, margin, headroom);
  return (
    point.x - shape.halfX < collider.maxX && point.x + shape.halfX > collider.minX &&
    point.y < collider.maxY && point.y + shape.height > collider.minY &&
    point.z - shape.halfZ < collider.maxZ && point.z + shape.halfZ > collider.minZ
  );
}

// La física mantiene 0.001 m de separación, pero una posición recibida por red
// puede perder unas milésimas por serialización. Ignora únicamente un contacto
// superficial por la cara más cercana; atravesar una pared o techo sigue dando
// una profundidad mayor y se rechaza.
export function bodyPenetratesCollider(
  point,
  collider,
  body = PLAYER_BODY,
  contactTolerance = 0.004,
) {
  if (!bodyOverlapsCollider(point, collider, body)) return false;
  const tolerance = Math.max(0, Number(contactTolerance) || 0);
  const shape = bodyShape(body);
  const overlapDepth = Math.min(
    point.x + shape.halfX - collider.minX,
    collider.maxX - (point.x - shape.halfX),
    point.y + shape.height - collider.minY,
    collider.maxY - point.y,
    point.z + shape.halfZ - collider.minZ,
    collider.maxZ - (point.z - shape.halfZ),
  );
  return overlapDepth > tolerance;
}

// Comprueba todo el trayecto del cuerpo, no solo el destino. Así un paquete de
// red no puede "saltar" una pared fina. Los obstáculos bajos que la física del
// cliente puede subir se permiten durante la interpolación; el destino todavía
// debe validarse por separado.
function isBodySegmentClear(start, end, colliders, {
  body = PLAYER_BODY,
  sampleStep = 0.2,
  stepHeight = 0.56,
  contactTolerance = 0,
} = {}) {
  if (!finitePoint(start) || !finitePoint(end)) return false;
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const distance = Math.hypot(dx, dy, dz);
  const step = Math.max(0.05, Number(sampleStep) || 0.2);
  const steps = Math.max(1, Math.ceil(distance / step));
  const climb = Math.max(0, Number(stepHeight) || 0);
  const safeColliders = Array.isArray(colliders) ? colliders.filter(finiteCollider) : [];

  for (let index = 1; index <= steps; index++) {
    const ratio = index / steps;
    const point = {
      x: start.x + dx * ratio,
      y: start.y + dy * ratio,
      z: start.z + dz * ratio,
    };
    for (const collider of safeColliders) {
      const blocked = contactTolerance > 0
        ? bodyPenetratesCollider(point, collider, body, contactTolerance)
        : bodyOverlapsCollider(point, collider, body);
      if (!blocked) continue;
      const rise = collider.maxY - point.y;
      if (rise > 0 && rise <= climb + POSITION_EPSILON) continue;
      return false;
    }
  }
  return true;
}

export function isDirectBodyPathClear(start, end, colliders, options = {}) {
  return isBodySegmentClear(start, end, colliders, options);
}

export function isBodyPathClear(start, end, colliders, options = {}) {
  if (!finitePoint(start) || !finitePoint(end)) return false;
  if (isBodySegmentClear(start, end, colliders, options)) return true;

  // moveBody resuelve cada frame por ejes (Y, después X y después Z). Una
  // diagonal recta puede cortar la esquina de un pilar aunque el movimiento
  // real X→Z sea completamente válido. Probamos ambas rutas ortogonales y
  // repartimos el cambio vertical según la distancia de cada tramo.
  const dx = Math.abs(end.x - start.x), dz = Math.abs(end.z - start.z);
  const horizontal = dx + dz;
  if (horizontal <= POSITION_EPSILON) return false;
  const dy = end.y - start.y;
  const xBend = {
    x: end.x,
    y: start.y + dy * (dx / horizontal),
    z: start.z,
  };
  const zBend = {
    x: start.x,
    y: start.y + dy * (dz / horizontal),
    z: end.z,
  };
  return (
    isBodySegmentClear(start, xBend, colliders, options) &&
    isBodySegmentClear(xBend, end, colliders, options)
  ) || (
    isBodySegmentClear(start, zBend, colliders, options) &&
    isBodySegmentClear(zBend, end, colliders, options)
  );
}

function supportingCollider(point, colliders, body, supportTolerance) {
  const tolerance = Math.max(POSITION_EPSILON, Number(supportTolerance) || DEFAULT_SUPPORT_TOLERANCE);
  let support = null;
  for (const collider of colliders) {
    if (!finiteCollider(collider)) continue;
    const drop = point.y - collider.maxY;
    if (drop < -POSITION_EPSILON || drop > tolerance) continue;
    if (
      point.x - body.halfX >= collider.minX - POSITION_EPSILON &&
      point.x + body.halfX <= collider.maxX + POSITION_EPSILON &&
      point.z - body.halfZ >= collider.minZ - POSITION_EPSILON &&
      point.z + body.halfZ <= collider.maxZ + POSITION_EPSILON &&
      (!support || collider.maxY > support.maxY)
    ) support = collider;
  }
  return support;
}

export function inspectSpawnPoint(point, colliders, {
  body = PLAYER_BODY,
  margin = 0,
  headroom = 0.12,
  supportTolerance = DEFAULT_SUPPORT_TOLERANCE,
} = {}) {
  const blockers = [];
  if (!finitePoint(point)) {
    return { ok: false, finite: false, supported: false, blockers };
  }
  const safeColliders = Array.isArray(colliders) ? colliders.filter(finiteCollider) : [];
  for (const collider of safeColliders) {
    if (bodyOverlapsCollider(point, collider, body, margin, headroom)) blockers.push(collider);
  }
  const support = supportingCollider(point, safeColliders, bodyShape(body), supportTolerance);
  return {
    ok: blockers.length === 0 && !!support,
    finite: true,
    supported: !!support,
    support,
    blockers,
  };
}

export function isSpawnPointSafe(point, colliders, options) {
  return inspectSpawnPoint(point, colliders, options).ok;
}

export function validateSpawnPoints(points, colliders, options) {
  const valid = [];
  const invalid = [];
  for (const [index, point] of (Array.isArray(points) ? points : []).entries()) {
    const result = inspectSpawnPoint(point, colliders, options);
    if (result.ok) valid.push({ x: point.x, y: point.y, z: point.z });
    else invalid.push({ index, point, ...result });
  }
  return { valid, invalid };
}

export function requireSafeSpawnPoints(points, colliders, options = {}) {
  const { label = 'spawn', ...inspectionOptions } = options;
  const result = validateSpawnPoints(points, colliders, inspectionOptions);
  if (result.invalid.length > 0 || result.valid.length === 0) {
    const indices = result.invalid.map(({ index }) => index).join(', ') || 'sin puntos';
    throw new Error(`${label}: puntos de aparición inválidos (${indices})`);
  }
  return result.valid;
}

function entityPoint(entity) {
  if (!entity || entity.dead === true || entity.alive === false) return null;
  const point = finitePoint(entity.pos) ? entity.pos : entity;
  return finitePoint(point) ? point : null;
}

function samePoint(a, b) {
  return finitePoint(a) && finitePoint(b) &&
    Math.abs(a.x - b.x) < SAME_SPAWN_HORIZONTAL_EPSILON &&
    Math.abs(a.y - b.y) < SAME_SPAWN_VERTICAL_EPSILON &&
    Math.abs(a.z - b.z) < SAME_SPAWN_HORIZONTAL_EPSILON;
}

function distanceSquared(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// Escoge siempre entre puntos fijos ya validados. Prioriza el punto cuya
// amenaza viva más cercana esté más lejos y evita repetir el último punto.
export function selectSafeSpawn({
  points,
  colliders,
  occupants = [],
  body = PLAYER_BODY,
  margin = 0,
  headroom = 0.12,
  previous = null,
  minOccupantDistance = 3,
  random = Math.random,
} = {}) {
  const safe = validateSpawnPoints(points, colliders, { body, margin, headroom }).valid;
  if (safe.length === 0) return null;
  const occupiedPoints = (Array.isArray(occupants) ? occupants : [])
    .map(entityPoint)
    .filter(Boolean);

  if (occupiedPoints.length === 0) {
    const alternatives = safe.length > 1 && finitePoint(previous)
      ? safe.filter((point) => !samePoint(point, previous))
      : safe;
    const candidates = alternatives.length > 0 ? alternatives : safe;
    const sample = Number(typeof random === 'function' ? random() : 0);
    const normalized = Number.isFinite(sample) ? Math.min(0.999999, Math.max(0, sample)) : 0;
    const chosen = candidates[Math.floor(normalized * candidates.length)];
    return { ...chosen };
  }

  const scored = safe.map((point) => {
    let nearest = Infinity;
    for (const occupied of occupiedPoints) nearest = Math.min(nearest, distanceSquared(point, occupied));
    return { point, nearest };
  });
  const separation = Math.max(0, Number(minOccupantDistance) || 0);
  const separated = scored.filter(({ nearest }) => nearest >= separation * separation);
  let candidates = separated.length > 0 ? separated : scored;

  // Evitar repetición solo cuando queda otra alternativa que conserva la
  // separación mínima. Nunca se cambia un punto libre por uno ocupado.
  if (separated.length > 1 && finitePoint(previous)) {
    const fresh = candidates.filter(({ point }) => !samePoint(point, previous));
    if (fresh.length > 0) candidates = fresh;
  }

  let bestDistance = -1;
  const best = [];
  for (const { point, nearest } of candidates) {
    if (nearest > bestDistance + POSITION_EPSILON) {
      bestDistance = nearest;
      best.length = 0;
      best.push(point);
    } else if (Math.abs(nearest - bestDistance) <= POSITION_EPSILON) {
      best.push(point);
    }
  }
  const sample = Number(typeof random === 'function' ? random() : 0);
  const normalized = Number.isFinite(sample) ? Math.min(0.999999, Math.max(0, sample)) : 0;
  return { ...best[Math.floor(normalized * best.length)] };
}

export function colliderOccupied(collider, entities, body = PLAYER_BODY, margin = 0.05) {
  if (!finiteCollider(collider)) return false;
  for (const entity of Array.isArray(entities) ? entities : []) {
    const point = entityPoint(entity);
    if (point && bodyOverlapsCollider(point, collider, body, margin)) return true;
  }
  return false;
}
