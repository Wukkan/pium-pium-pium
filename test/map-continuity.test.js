import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMap, COLORS } from '../src/shared/mapdata.js';

const bounds = (box) => ({
  minX: box.x - box.w / 2,
  maxX: box.x + box.w / 2,
  minY: box.y - box.h / 2,
  maxY: box.y + box.h / 2,
  minZ: box.z - box.d / 2,
  maxZ: box.z + box.d / 2,
});

const findBox = (boxes, x, z, color, predicate = () => true) => boxes.find((box) =>
  box.x === x && box.z === z && box.color === color && predicate(box));

const assertVerticalContact = (lower, upper, label, tolerance = 1e-9) => {
  assert.ok(lower && upper, `${label}: missing structural part`);
  const a = bounds(lower);
  const b = bounds(upper);
  assert.ok(Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0, `${label}: no X overlap`);
  assert.ok(Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 0, `${label}: no Z overlap`);
  assert.ok(b.minY - a.maxY <= tolerance, `${label}: vertical gap ${b.minY - a.maxY}`);
};

test('every elevated map piece has positive-area support beneath its footprint', () => {
  for (const mapId of ['arena', 'ciudad']) {
    const boxes = buildMap(mapId).boxes;
    for (const [index, box] of boxes.entries()) {
      const elevated = bounds(box);
      if (elevated.minY <= 1e-9) continue;

      const supported = boxes.some((candidate, candidateIndex) => {
        if (candidateIndex === index) return false;
        const support = bounds(candidate);
        const overlapX = Math.min(elevated.maxX, support.maxX) -
          Math.max(elevated.minX, support.minX);
        const overlapZ = Math.min(elevated.maxZ, support.maxZ) -
          Math.max(elevated.minZ, support.minZ);
        return overlapX > 1e-6 && overlapZ > 1e-6 &&
          support.minY < elevated.minY && support.maxY >= elevated.minY - 1e-9;
      });

      assert.ok(supported, `${mapId} box ${index} is floating without footprint support`);
    }
  }
});

test('arena roofs and tower parts form continuous supported structures', () => {
  const map = buildMap('arena');
  const boxes = map.boxes;
  const ground = boxes.find((box) => box.color === COLORS.ground);
  const walls = boxes.filter((box) => box.color === COLORS.wall && box.h === 7);
  assert.equal(walls.length, 4, 'arena must keep four perimeter walls');
  for (const [index, wall] of walls.entries()) {
    assertVerticalContact(ground, wall, `arena ground/wall ${index + 1}`);
  }

  const southWestBase = findBox(boxes, -25, -25, COLORS.building3, (box) => box.h === 4);
  const southWestRoof = findBox(boxes, -25, -25, COLORS.roof);
  const roofTower = findBox(boxes, -27.5, -27.5, COLORS.building3);
  assertVerticalContact(southWestBase, southWestRoof, 'arena southwest base/roof');
  assertVerticalContact(southWestRoof, roofTower, 'arena southwest roof/tower');

  const watchPlatform = findBox(boxes, 35, 6, COLORS.platform, (box) => box.h === 0.5);
  const watchMast = findBox(boxes, 35, 6, COLORS.roof, (box) => box.w === 0.3);
  assertVerticalContact(watchPlatform, watchMast, 'arena watchtower platform/mast');
});

test('city bridge, roof and rails have continuous support', () => {
  const map = buildMap('ciudad');
  const boxes = map.boxes;
  const street = boxes.find((box) => box.color === COLORS.street);
  const walls = boxes.filter((box) => box.color === COLORS.wall && box.h === 8);
  assert.equal(walls.length, 4, 'city must keep four perimeter walls');
  for (const [index, wall] of walls.entries()) {
    assertVerticalContact(street, wall, `city street/wall ${index + 1}`);
  }

  const northEastRoof = findBox(boxes, 19, -19, COLORS.roof);
  const bridge = findBox(boxes, 19, 0, COLORS.platform);
  assertVerticalContact(northEastRoof, bridge, 'city northeast roof/bridge');

  const rails = boxes.filter((box) => box.color === COLORS.barrier && box.d === 26);
  assert.equal(rails.length, 2, 'city bridge must keep both rails');
  for (const [index, rail] of rails.entries()) {
    assertVerticalContact(bridge, rail, `city bridge/rail ${index + 1}`);
  }
});
