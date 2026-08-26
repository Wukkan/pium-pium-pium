import { BOT_BODY, isDirectBodyPathClear } from './spawn-safety.js';
import { moveBody } from './physics.js';

const MINIMUM_WAYPOINT_DISTANCE = 0.45;
const ROUTE_EPSILON = 1e-6;
const MAX_PLANAR_EDGE = 48;
const PLANAR_NEIGHBORS = 20;
const BOT_SPEED = 5.2;
const GRAVITY = 24;
const PATH_DT = 1 / 15;

const finitePoint = (point) => !!point && Number.isFinite(point.x) &&
  Number.isFinite(point.y) && Number.isFinite(point.z);

const pointDistance = (left, right) => Math.hypot(
  left.x - right.x,
  left.y - right.y,
  left.z - right.z,
);

// Los mapas no cambian de geometria durante una ronda salvo por las cajas
// destruibles. La matriz guarda de forma perezosa las pruebas caras entre
// puntos; al cambiar el conjunto de colliders se invalida automaticamente.
// Asi A* puede usarse por muchos zombis a 15 Hz sin reconstruir el grafo.
// Cada sala mantiene su propio array de colliders y puede destruir/reaparecer
// cajas de forma independiente. La identidad del array es la primera clave;
// así dos salas con la misma geometría visible nunca comparten una referencia
// mutable ni contaminan las aristas calculadas de la otra.
const graphCache = new WeakMap();

function colliderSignature(colliders) {
  if (!Array.isArray(colliders)) return '0';
  let signature = `${colliders.length}:`;
  for (const collider of colliders) {
    signature += `${collider?.minX},${collider?.minY},${collider?.minZ},` +
      `${collider?.maxX},${collider?.maxY},${collider?.maxZ},${collider?.crate || ''};`;
  }
  return signature;
}

function pointSignature(points) {
  let signature = `${points.length}:`;
  for (const point of points) {
    signature += `${point.x},${point.y},${point.z},` +
      `${point.navigationRoute ?? ''},${point.navigationOrder ?? ''};`;
  }
  return signature;
}

function bodySignature(body) {
  return `${body?.halfX || 0}:${body?.halfZ || 0}:${body?.height || 0}`;
}

function routeNeighbors(points, fromIndex) {
  const from = points[fromIndex];
  const explicit = [];
  const planar = [];
  for (let index = 0; index < points.length; index++) {
    if (index === fromIndex) continue;
    const candidate = points[index];
    const distance = pointDistance(from, candidate);
    if (from.navigationRoute !== undefined &&
        from.navigationRoute === candidate.navigationRoute &&
        Math.abs(from.navigationOrder - candidate.navigationOrder) === 1) {
      explicit.push(index);
    } else if (Math.abs(from.y - candidate.y) <= 0.8 && distance <= MAX_PLANAR_EDGE) {
      planar.push({ index, distance });
    }
  }
  planar.sort((left, right) => left.distance - right.distance || left.index - right.index);
  return [...new Set([...explicit, ...planar.slice(0, PLANAR_NEIGHBORS).map(({ index }) => index)])];
}

// Ejecuta el mismo controlador y moveBody que el servidor a su cadencia real.
// El barrido AABB por si solo permite falsas aristas entre dos azoteas con
// aire debajo; esta simulacion dirigida exige suelo, progreso y llegada.
export function isWalkableBotPath(start, end, colliders, body = BOT_BODY) {
  if (!finitePoint(start) || !finitePoint(end)) return false;
  const horizontalDistance = Math.hypot(end.x - start.x, end.z - start.z);
  if (horizontalDistance <= MINIMUM_WAYPOINT_DISTANCE) {
    return Math.abs(end.y - start.y) <= 0.25;
  }
  if (!isDirectBodyPathClear(start, end, colliders, { body })) return false;

  const pos = { x: start.x, y: start.y, z: start.z };
  const vel = { x: 0, y: 0, z: 0 };
  const tickLimit = Math.ceil(horizontalDistance / BOT_SPEED / PATH_DT) + 24;
  let stationaryTicks = 0;
  const minimumAllowedY = Math.min(start.y, end.y) - 1.25;

  for (let tick = 0; tick < tickLimit; tick++) {
    const dx = end.x - pos.x;
    const dz = end.z - pos.z;
    const remaining = Math.hypot(dx, dz);
    if (remaining < 0.68 && Math.abs(pos.y - end.y) < 0.85) return true;
    const moveX = remaining > 1e-6 ? dx / remaining : 0;
    const moveZ = remaining > 1e-6 ? dz / remaining : 0;
    const k = Math.min(1, PATH_DT * 8);
    vel.x += (moveX * BOT_SPEED - vel.x) * k;
    vel.z += (moveZ * BOT_SPEED - vel.z) * k;
    vel.y -= GRAVITY * PATH_DT;
    const previousX = pos.x;
    const previousZ = pos.z;
    moveBody(pos, vel, PATH_DT, body.halfX, body.halfZ, body.height, colliders);
    if (!finitePoint(pos) || pos.y < minimumAllowedY) return false;
    const moved = Math.hypot(pos.x - previousX, pos.z - previousZ);
    stationaryTicks = moved < 0.01 ? stationaryTicks + 1 : 0;
    if (stationaryTicks > 9) return false;
  }
  return Math.hypot(end.x - pos.x, end.z - pos.z) < 0.68 &&
    Math.abs(pos.y - end.y) < 0.85;
}

function navigationGraph(waypoints, colliders, body) {
  const points = waypoints.filter(finitePoint);
  const signature = `${pointSignature(points)}|${colliderSignature(colliders)}|${bodySignature(body)}`;
  let roomCache = graphCache.get(colliders);
  if (!roomCache) {
    roomCache = new Map();
    graphCache.set(colliders, roomCache);
  }
  const cached = roomCache.get(signature);
  if (cached) return cached;

  const graph = {
    colliders,
    signature,
    points,
    neighbors: points.map((_, index) => routeNeighbors(points, index)),
    // 0 = sin comprobar, 1 = transitable, -1 = bloqueado. Las rutas pueden
    // ser dirigidas: subir un escalon y bajarlo no son exactamente la misma
    // prueba para el cuerpo barrido.
    edges: new Int8Array(points.length * points.length),
  };
  roomCache.set(signature, graph);
  if (roomCache.size > 4) roomCache.delete(roomCache.keys().next().value);
  return graph;
}

function graphEdgeClear(graph, fromIndex, toIndex, body) {
  if (fromIndex === toIndex) return false;
  const key = fromIndex * graph.points.length + toIndex;
  const known = graph.edges[key];
  if (known !== 0) return known > 0;
  const clear = isWalkableBotPath(
    graph.points[fromIndex],
    graph.points[toIndex],
    graph.colliders,
    body,
  );
  graph.edges[key] = clear ? 1 : -1;
  return clear;
}

function reconstructRoute(parent, goalIndex, points) {
  const routeIndices = [];
  let current = goalIndex;
  while (current >= 0) {
    if (current < points.length) routeIndices.push(current);
    current = parent[current];
  }
  routeIndices.reverse();
  return routeIndices.map((index) => ({ ...points[index] }));
}

// Construye una ruta completa sobre un grafo de visibilidad. A diferencia de
// escoger el waypoint aparentemente mas cercano al objetivo, A* conserva la
// cadena de escaleras/calles completa y no oscila en minimos locales.
// Devuelve solo los waypoints intermedios: al agotar la cadena el bot vuelve a
// probar el trayecto directo hacia la posicion viva del objetivo.
export function findBotNavigationRoute(position, waypoints, colliders, {
  body = BOT_BODY,
  goal = null,
  exclude = [],
  allowPartial = true,
} = {}) {
  if (!finitePoint(position) || !finitePoint(goal) || !Array.isArray(waypoints)) return [];
  if (isWalkableBotPath(position, goal, colliders, body)) return [];

  const graph = navigationGraph(waypoints, colliders, body);
  const { points } = graph;
  const count = points.length;
  if (count === 0) return [];

  const startIndex = count;
  const goalIndex = count + 1;
  const total = count + 2;
  const distance = new Float64Array(total);
  const estimate = new Float64Array(total);
  const parent = new Int32Array(total);
  const closed = new Uint8Array(total);
  distance.fill(Infinity);
  estimate.fill(Infinity);
  parent.fill(-1);
  distance[startIndex] = 0;
  estimate[startIndex] = pointDistance(position, goal);

  const excluded = (Array.isArray(exclude) ? exclude : [exclude]).filter(finitePoint);
  const exclusionPenalty = (candidate) => excluded.some((point) =>
    pointDistance(candidate, point) <= 0.35) ? 6 : 0;

  let bestPartial = -1;
  let bestPartialGoalDistance = Infinity;
  let bestPartialCost = Infinity;

  for (let iteration = 0; iteration < total; iteration++) {
    let current = -1;
    for (let index = 0; index < total; index++) {
      if (closed[index]) continue;
      if (current < 0 || estimate[index] < estimate[current] - ROUTE_EPSILON ||
          (Math.abs(estimate[index] - estimate[current]) <= ROUTE_EPSILON && index < current)) {
        current = index;
      }
    }
    if (current < 0 || !Number.isFinite(estimate[current])) break;
    if (current === goalIndex) return reconstructRoute(parent, goalIndex, points);
    closed[current] = 1;

    const currentPoint = current === startIndex ? position : points[current];
    if (current < count) {
      const goalDistance = pointDistance(currentPoint, goal);
      if (goalDistance < bestPartialGoalDistance - ROUTE_EPSILON ||
          (Math.abs(goalDistance - bestPartialGoalDistance) <= ROUTE_EPSILON &&
           distance[current] < bestPartialCost - ROUTE_EPSILON)) {
        bestPartial = current;
        bestPartialGoalDistance = goalDistance;
        bestPartialCost = distance[current];
      }
      if (goalDistance <= MAX_PLANAR_EDGE && Math.abs(currentPoint.y - goal.y) <= 0.85 &&
          isWalkableBotPath(currentPoint, goal, colliders, body)) {
        const nextDistance = distance[current] + goalDistance;
        if (nextDistance < distance[goalIndex]) {
          distance[goalIndex] = nextDistance;
          estimate[goalIndex] = nextDistance;
          parent[goalIndex] = current;
        }
      }
    }

    const nextCandidates = current === startIndex
      ? points
        .map((candidate, index) => ({
          index,
          distance: pointDistance(position, candidate),
          sameLevel: Math.abs(position.y - candidate.y) <= 0.85,
        }))
        .filter(({ distance: travel, sameLevel }) => sameLevel && travel <= MAX_PLANAR_EDGE)
        .sort((left, right) => left.distance - right.distance || left.index - right.index)
        .slice(0, PLANAR_NEIGHBORS)
        .map(({ index }) => index)
      : graph.neighbors[current];
    for (const next of nextCandidates) {
      if (closed[next] || next === current) continue;
      const candidate = points[next];
      const travel = pointDistance(currentPoint, candidate);
      if (travel <= MINIMUM_WAYPOINT_DISTANCE) continue;
      const clear = current === startIndex
        ? isWalkableBotPath(position, candidate, colliders, body)
        : graphEdgeClear(graph, current, next, body);
      if (!clear) continue;
      const nextDistance = distance[current] + travel + exclusionPenalty(candidate);
      if (nextDistance < distance[next] - ROUTE_EPSILON) {
        distance[next] = nextDistance;
        estimate[next] = nextDistance + pointDistance(candidate, goal);
        parent[next] = current;
      }
    }
  }

  const startingGoalDistance = pointDistance(position, goal);
  return allowPartial && bestPartial >= 0 &&
    bestPartialGoalDistance < startingGoalDistance - MINIMUM_WAYPOINT_DISTANCE
    ? reconstructRoute(parent, bestPartial, points)
    : [];
}

export function reachableBotWaypoints(position, waypoints, colliders, {
  body = BOT_BODY,
  minimumDistance = MINIMUM_WAYPOINT_DISTANCE,
} = {}) {
  if (!finitePoint(position) || !Array.isArray(waypoints)) return [];
  const minimumSq = Math.max(0, Number(minimumDistance) || 0) ** 2;
  return waypoints.filter((candidate) => {
    if (!finitePoint(candidate)) return false;
    const dx = candidate.x - position.x;
    const dy = candidate.y - position.y;
    const dz = candidate.z - position.z;
    if (dx * dx + dy * dy + dz * dz <= minimumSq) return false;
    return isWalkableBotPath(position, candidate, colliders, body);
  });
}

// Conserva la API usada por la patrulla y el cliente local. Con un objetivo,
// el primer punto procede ahora de una ruta completa determinista.
export function selectReachableBotWaypoint(position, waypoints, colliders, {
  body = BOT_BODY,
  exclude = [],
  goal = null,
  random = Math.random,
} = {}) {
  if (!finitePoint(position) || !Array.isArray(waypoints)) return null;
  if (finitePoint(goal)) {
    return findBotNavigationRoute(position, waypoints, colliders, {
      body,
      exclude,
      goal,
    })[0] || null;
  }

  const excluded = (Array.isArray(exclude) ? exclude : [exclude]).filter(finitePoint);
  const candidates = waypoints.filter((candidate) => finitePoint(candidate) &&
    pointDistance(candidate, position) > MINIMUM_WAYPOINT_DISTANCE &&
    excluded.every((point) => pointDistance(candidate, point) > 0.35));
  if (candidates.length === 0) return null;
  const roll = typeof random === 'function' ? Number(random()) : 0;
  const normalized = Number.isFinite(roll) ? Math.max(0, Math.min(0.999999, roll)) : 0;
  const start = Math.floor(normalized * candidates.length);
  for (let offset = 0; offset < candidates.length; offset++) {
    const candidate = candidates[(start + offset) % candidates.length];
    if (isWalkableBotPath(position, candidate, colliders, body)) return candidate;
  }
  return null;
}

export function botWaypointReachable(position, waypoint, colliders, body = BOT_BODY) {
  return finitePoint(position) && finitePoint(waypoint) &&
    isWalkableBotPath(position, waypoint, colliders, body);
}
