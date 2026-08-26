import * as THREE from 'three';

function validateCompatible(first, geometry, attributeNames, indexed) {
  if (!!geometry.index !== indexed) throw new Error('No se pueden mezclar geometrías indexadas y no indexadas');
  const names = Object.keys(geometry.attributes);
  if (names.length !== attributeNames.length || attributeNames.some((name) => !geometry.attributes[name])) {
    throw new Error('Las geometrías del lote no comparten los mismos atributos');
  }
  for (const name of attributeNames) {
    const base = first.attributes[name];
    const current = geometry.attributes[name];
    if (base.itemSize !== current.itemSize || base.normalized !== current.normalized ||
        base.array.constructor !== current.array.constructor) {
      throw new Error(`Atributo incompatible en lote: ${name}`);
    }
  }
}

// Mezcla cajas ya transformadas que comparten material. Es deliberadamente
// pequeña: los mapas solo usan BufferGeometry con position/normal/uv y un
// índice, por lo que no arrastramos una utilidad completa al cliente.
export function mergeMapGeometries(geometries) {
  if (!Array.isArray(geometries) || geometries.length === 0) return null;
  const first = geometries[0];
  const attributeNames = Object.keys(first.attributes);
  const indexed = !!first.index;
  for (const geometry of geometries) {
    validateCompatible(first, geometry, attributeNames, indexed);
  }

  const merged = new THREE.BufferGeometry();
  for (const name of attributeNames) {
    const source = first.attributes[name];
    const totalLength = geometries.reduce(
      (sum, geometry) => sum + geometry.attributes[name].array.length,
      0,
    );
    const array = new source.array.constructor(totalLength);
    let offset = 0;
    for (const geometry of geometries) {
      const values = geometry.attributes[name].array;
      array.set(values, offset);
      offset += values.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, source.itemSize, source.normalized));
  }

  if (indexed) {
    const vertexCount = geometries.reduce(
      (sum, geometry) => sum + geometry.attributes.position.count,
      0,
    );
    const indexCount = geometries.reduce((sum, geometry) => sum + geometry.index.count, 0);
    const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
    const values = new IndexArray(indexCount);
    let indexOffset = 0;
    let vertexOffset = 0;
    for (const geometry of geometries) {
      const source = geometry.index.array;
      for (let index = 0; index < source.length; index++) {
        values[indexOffset + index] = source[index] + vertexOffset;
      }
      indexOffset += source.length;
      vertexOffset += geometry.attributes.position.count;
    }
    merged.setIndex(new THREE.BufferAttribute(values, 1));
  }

  merged.type = 'BatchedMapGeometry';
  merged.userData.sourceGeometryCount = geometries.length;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
