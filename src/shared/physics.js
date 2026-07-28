// ---------------------------------------------------------------------------
// Física compartida cliente/servidor: colisión AABB con step-up y test de
// línea de visión. Trabaja sobre objetos planos {x,y,z} (compatible con
// THREE.Vector3, que también expone .x/.y/.z).
// ---------------------------------------------------------------------------

const STEP_UP = 0.55;
const EPS = 0.001;

function overlaps(pos, halfX, halfZ, height, c) {
  return (
    pos.x - halfX < c.maxX && pos.x + halfX > c.minX &&
    pos.y < c.maxY && pos.y + height > c.minY &&
    pos.z - halfZ < c.maxZ && pos.z + halfZ > c.minZ
  );
}

function freeAt(x, y, z, halfX, halfZ, height, colliders) {
  for (const c of colliders) {
    if (
      x - halfX < c.maxX && x + halfX > c.minX &&
      y < c.maxY && y + height > c.minY &&
      z - halfZ < c.maxZ && z + halfZ > c.minZ
    ) return false;
  }
  return true;
}

// Mueve un cuerpo (pos = pies) contra los colliders. Muta pos y vel.
export function moveBody(pos, vel, dt, halfX, halfZ, height, colliders) {
  let onGround = false;

  // eje Y
  pos.y += vel.y * dt;
  for (const c of colliders) {
    if (!overlaps(pos, halfX, halfZ, height, c)) continue;
    if (vel.y <= 0 && pos.y < c.maxY && pos.y > c.maxY - 1.2) {
      pos.y = c.maxY + EPS;
      vel.y = 0;
      onGround = true;
    } else if (vel.y > 0) {
      pos.y = c.minY - height - EPS;
      vel.y = 0;
    }
  }

  // eje X (con step-up)
  pos.x += vel.x * dt;
  for (const c of colliders) {
    if (!overlaps(pos, halfX, halfZ, height, c)) continue;
    const rise = c.maxY - pos.y;
    if (rise > 0 && rise <= STEP_UP &&
        freeAt(pos.x, c.maxY + EPS, pos.z, halfX, halfZ, height, colliders)) {
      pos.y = c.maxY + EPS;
      continue;
    }
    if (vel.x > 0) pos.x = c.minX - halfX - EPS;
    else if (vel.x < 0) pos.x = c.maxX + halfX + EPS;
    vel.x = 0;
  }

  // eje Z (con step-up)
  pos.z += vel.z * dt;
  for (const c of colliders) {
    if (!overlaps(pos, halfX, halfZ, height, c)) continue;
    const rise = c.maxY - pos.y;
    if (rise > 0 && rise <= STEP_UP &&
        freeAt(pos.x, c.maxY + EPS, pos.z, halfX, halfZ, height, colliders)) {
      pos.y = c.maxY + EPS;
      continue;
    }
    if (vel.z > 0) pos.z = c.minZ - halfZ - EPS;
    else if (vel.z < 0) pos.z = c.maxZ + halfZ + EPS;
    vel.z = 0;
  }

  return { onGround };
}

// ¿El segmento a→b está bloqueado por algún collider? (método del "slab")
export function segmentBlocked(a, b, colliders) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  for (const c of colliders) {
    let tmin = 0, tmax = 1, ok = true;
    const axes = [
      [a.x, dx, c.minX, c.maxX],
      [a.y, dy, c.minY, c.maxY],
      [a.z, dz, c.minZ, c.maxZ],
    ];
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { ok = false; break; }
      } else {
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok) return true;
  }
  return false;
}
