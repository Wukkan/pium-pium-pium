import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  proportionalCornerRadius,
  roundedBoxGeometry,
} from '../src/rounded-geometry.js';

test('corner radius follows the shortest side and respects ratio and cap', () => {
  assert.equal(proportionalCornerRadius(10, 2, 5), 0.32);
  assert.equal(proportionalCornerRadius(10, 2, 5, { ratio: 0.2, maxRadius: 0.25 }), 0.25);
  assert.equal(proportionalCornerRadius(10, 2, 5, { ratio: 99 }), 0.9);
  assert.equal(proportionalCornerRadius(10, 2, 5, { ratio: -1 }), 0.05);
});

test('rounded boxes keep requested outer dimensions and smooth corner normals', () => {
  const geometry = roundedBoxGeometry(4, 2, 1, { ratio: 0.2, segments: 2 });
  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  assert.deepEqual(size.toArray(), [4, 2, 1]);
  assert.equal(geometry.type, 'RoundedBoxGeometry');
  assert.equal(geometry.parameters.radius, 0.2);
  assert.equal(geometry.attributes.position.count, 900);

  const normals = geometry.attributes.normal.array;
  let blendedNormals = 0;
  for (let index = 0; index < normals.length; index += 3) {
    const axes = [normals[index], normals[index + 1], normals[index + 2]]
      .filter((value) => Math.abs(value) > 0.05).length;
    if (axes >= 2) blendedNormals++;
  }
  assert.ok(blendedNormals > 0);
  geometry.dispose();
});

test('rounded geometry clamps invalid dimensions and complexity to safe values', () => {
  const geometry = roundedBoxGeometry(NaN, -2, 0, { radius: 99, segments: 50 });
  assert.deepEqual(
    {
      width: geometry.parameters.width,
      height: geometry.parameters.height,
      depth: geometry.parameters.depth,
      segments: geometry.parameters.segments,
      radius: geometry.parameters.radius,
    },
    { width: 1, height: 2, depth: 1, segments: 4, radius: 0.5 },
  );
  assert.ok(geometry.attributes.position.count <= 2916);
  geometry.dispose();
});
