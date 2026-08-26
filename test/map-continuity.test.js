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
  const southEastRoof = findBox(boxes, 19, 20, COLORS.roof);
  const northApproach = findBox(boxes, 19, -11.75, COLORS.platform);
  const bridge = findBox(boxes, 19, 0, COLORS.platform);
  const southApproach = findBox(boxes, 19, 11.75, COLORS.platform);
  assertVerticalContact(northEastRoof, northApproach, 'city northeast roof/bridge approach');
  assertVerticalContact(northApproach, bridge, 'city north approach/bridge');
  assertVerticalContact(bridge, southApproach, 'city bridge/south approach');
  assertVerticalContact(southApproach, southEastRoof, 'city south approach/southeast roof');

  const rails = boxes.filter((box) => box.color === COLORS.barrier && box.d === 21.2);
  assert.equal(rails.length, 2, 'city bridge must keep both rails');
  for (const [index, rail] of rails.entries()) {
    assertVerticalContact(bridge, rail, `city bridge/rail ${index + 1}`);
  }
});

test('destructible crates never interpenetrate static map cover', () => {
  for (const mapId of ['arena', 'ciudad']) {
    const boxes = buildMap(mapId).boxes;
    const crates = boxes.filter((box) => box.crate);
    const staticCover = boxes.filter((box) => !box.crate);
    for (const crate of crates) {
      const a = bounds(crate);
      for (const cover of staticCover) {
        const b = bounds(cover);
        const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        assert.ok(
          overlapX <= 1e-6 || overlapY <= 1e-6 || overlapZ <= 1e-6,
          `${mapId} ${crate.crate} intersects static cover at (${cover.x}, ${cover.y}, ${cover.z})`,
        );
      }
    }
  }
});
