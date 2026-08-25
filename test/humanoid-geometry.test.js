import test from 'node:test';
import assert from 'node:assert/strict';

import { disposeHumanoid, makeHat, makeHumanoid } from '../src/humanoid.js';

function canvasDocument() {
  return {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            font: '', textAlign: '', textBaseline: '', lineWidth: 0,
            strokeStyle: '', fillStyle: '', strokeText() {}, fillText() {},
          };
        },
      };
    },
  };
}

test('operator and hats keep their hitbox dimensions while rounding visible boxes', () => {
  const previousDocument = globalThis.document;
  globalThis.document = canvasDocument();
  let rig;
  try {
    rig = makeHumanoid('#4a78aa', 'TEST', (part) => ({ part }), '#ffffff', 'cap');
    const hat = makeHat('crown');
    let triangles = 0;
    let roundedBoxes = 0;
    let legacyBoxes = 0;

    for (const root of [rig.group, hat]) {
      root.traverse((object) => {
        if (!object.isMesh || !object.geometry) return;
        const geometry = object.geometry;
        triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
        if (geometry.type === 'RoundedBoxGeometry') roundedBoxes++;
        if (geometry.type === 'BoxGeometry') legacyBoxes++;
      });
    }

    assert.ok(roundedBoxes >= 65);
    assert.equal(legacyBoxes, 0);
    assert.ok(triangles <= 12000, `${triangles} triangles exceed the operator budget`);
    assert.deepEqual(rig.head.geometry.parameters, {
      width: 0.42, height: 0.42, depth: 0.42, segments: 2, radius: 0.055,
    });
    assert.deepEqual(
      [...new Set(rig.parts.map((part) => part.userData.part))].sort(),
      ['arm', 'body', 'head', 'leg'],
    );
  } finally {
    if (rig) disposeHumanoid(rig);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
