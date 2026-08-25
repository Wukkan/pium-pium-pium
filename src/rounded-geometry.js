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

// Adaptación compacta de RoundedBoxGeometry de Three.js. Mantiene exactamente
// el volumen exterior solicitado, de modo que los colliders de caja continúan
// siendo válidos mientras las aristas visuales reciben un bisel proporcional.
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

