import * as THREE from 'three';

const cornerPosition = new THREE.Vector3();
const cornerNormal = new THREE.Vector3();

const finiteDimension = (value, fallback = 1) => {
  const numeric = Math.abs(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

export function proportionalCornerRadius(
  width,
  height,
  depth,
  { ratio = 0.16, maxRadius = Infinity } = {},
) {
  const shortest = Math.min(
    finiteDimension(width), finiteDimension(height), finiteDimension(depth),
  );
  const safeRatio = Math.min(0.45, Math.max(0.025, Number(ratio) || 0.16));
  const safeMaximum = Number.isFinite(Number(maxRadius))
    ? Math.max(0, Number(maxRadius))
    : Infinity;
  return Math.min(shortest * safeRatio, shortest * 0.49, safeMaximum);
}

// Adaptación compacta de RoundedBoxGeometry de Three.js. Mantiene los límites
// exteriores solicitados, pero recorta el volumen de aristas y esquinas. Es
// apropiada para props y viewmodels; una cobertura AABB necesita la variante
// collisionSafeBoxGeometry() de abajo para conservar todo su volumen visible.
export class RoundedBoxGeometry extends THREE.BoxGeometry {
  constructor(width = 1, height = 1, depth = 1, segments = 2, radius = 0.1) {
    const safeWidth = finiteDimension(width);
    const safeHeight = finiteDimension(height);
    const safeDepth = finiteDimension(depth);
    const safeSegments = Math.min(4, Math.max(1, Math.round(Number(segments) || 2)));
    const safeRadius = Math.min(
      safeWidth / 2, safeHeight / 2, safeDepth / 2, Math.max(0, Number(radius) || 0),
    );
    const totalSegments = safeSegments * 2 + 1;
    super(1, 1, 1, totalSegments, totalSegments, totalSegments);

    this.type = 'RoundedBoxGeometry';
    this.parameters = {
      width: safeWidth,
      height: safeHeight,
      depth: safeDepth,
      segments: safeSegments,
      radius: safeRadius,
    };

    const nonIndexed = this.toNonIndexed();
    this.index = null;
    this.setAttribute('position', nonIndexed.getAttribute('position'));
    this.setAttribute('normal', nonIndexed.getAttribute('normal'));
    this.setAttribute('uv', nonIndexed.getAttribute('uv'));
    nonIndexed.dispose();

    const halfSegment = 0.5 / totalSegments;
    const inner = new THREE.Vector3(safeWidth, safeHeight, safeDepth)
      .multiplyScalar(0.5)
      .subScalar(safeRadius);
    const positions = this.attributes.position.array;
    const normals = this.attributes.normal.array;

    for (let index = 0; index < positions.length; index += 3) {
      cornerPosition.fromArray(positions, index);
      cornerNormal.copy(cornerPosition);
      cornerNormal.x -= Math.sign(cornerNormal.x) * halfSegment;
      cornerNormal.y -= Math.sign(cornerNormal.y) * halfSegment;
      cornerNormal.z -= Math.sign(cornerNormal.z) * halfSegment;
      cornerNormal.normalize();

      positions[index] = inner.x * Math.sign(cornerPosition.x) + cornerNormal.x * safeRadius;
      positions[index + 1] = inner.y * Math.sign(cornerPosition.y) + cornerNormal.y * safeRadius;
      positions[index + 2] = inner.z * Math.sign(cornerPosition.z) + cornerNormal.z * safeRadius;
      normals[index] = cornerNormal.x;
      normals[index + 1] = cornerNormal.y;
      normals[index + 2] = cornerNormal.z;
    }

    this.attributes.position.needsUpdate = true;
    this.attributes.normal.needsUpdate = true;
    this.computeBoundingBox();
    this.computeBoundingSphere();
  }
}

export function roundedBoxGeometry(width, height, depth, options = {}) {
  const radius = options.radius ?? proportionalCornerRadius(width, height, depth, options);
  return new RoundedBoxGeometry(
    width,
    height,
    depth,
    options.segments ?? 2,
    radius,
  );
}

// Caja completamente sólida que coincide con un collider AABB. Las posiciones
// permanecen sobre las seis caras originales y solo se suavizan las normales
// en una franja proporcional junto a las aristas. Así el mapa conserva una
// lectura visual suave sin abrir huecos, separar piezas ni crear cobertura
// invisible en las esquinas.
export class CollisionSafeBoxGeometry extends THREE.BoxGeometry {
  constructor(width = 1, height = 1, depth = 1, radius = 0.1) {
    const safeWidth = finiteDimension(width);
    const safeHeight = finiteDimension(height);
    const safeDepth = finiteDimension(depth);
    const safeRadius = Math.min(
      safeWidth * 0.49,
      safeHeight * 0.49,
      safeDepth * 0.49,
      Math.max(0, Number(radius) || 0),
    );
    const bands = safeRadius > 0 ? 3 : 1;
    super(safeWidth, safeHeight, safeDepth, bands, bands, bands);

    this.type = 'CollisionSafeBoxGeometry';
    this.parameters = {
      width: safeWidth,
      height: safeHeight,
      depth: safeDepth,
      radius: safeRadius,
      bands,
    };

    if (safeRadius <= 0) {
      this.computeBoundingBox();
      this.computeBoundingSphere();
      return;
    }

    const half = [safeWidth / 2, safeHeight / 2, safeDepth / 2];
    const positions = this.attributes.position.array;
    const normals = this.attributes.normal.array;
    const epsilon = 1e-6;

    for (let index = 0; index < positions.length; index += 3) {
      // BoxGeometry con tres bandas crea un anillo interior uniforme. Se mueve
      // ese anillo a la distancia visual solicitada sin tocar las caras AABB.
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[index + axis];
        if (Math.abs(value) < half[axis] - epsilon) {
          positions[index + axis] = Math.sign(value) * (half[axis] - safeRadius);
        }
      }

      const x = positions[index];
      const y = positions[index + 1];
      const z = positions[index + 2];
      const nx = Math.abs(Math.abs(x) - half[0]) <= epsilon ? Math.sign(x) : 0;
      const ny = Math.abs(Math.abs(y) - half[1]) <= epsilon ? Math.sign(y) : 0;
      const nz = Math.abs(Math.abs(z) - half[2]) <= epsilon ? Math.sign(z) : 0;
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[index] = nx / length;
      normals[index + 1] = ny / length;
      normals[index + 2] = nz / length;
    }

    this.attributes.position.needsUpdate = true;
    this.attributes.normal.needsUpdate = true;
    this.computeBoundingBox();
    this.computeBoundingSphere();
  }
}

export function collisionSafeBoxGeometry(width, height, depth, options = {}) {
  const radius = options.radius ?? proportionalCornerRadius(width, height, depth, options);
  return new CollisionSafeBoxGeometry(width, height, depth, radius);
}
