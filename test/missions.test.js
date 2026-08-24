import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dailyMissionIds,
  Missions,
  normalizeMissionState,
} from '../src/missions.js';

const TODAY = '2026-08-24';

function memoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem() { return value; },
    setItem(_key, nextValue) { value = nextValue; },
    value() { return value; },
  };
}

test('blocked mission storage never aborts construction or saving', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  let missions;
  assert.doesNotThrow(() => {
    missions = new Missions(() => {}, { storage: blocked, today: TODAY });
  });
  assert.equal(missions.status().length, 3);
  assert.equal(missions.save(), false);
});

test('corrupt mission JSON and null lists regenerate the deterministic daily set', () => {
  for (const raw of ['{bad json', JSON.stringify({ date: TODAY, list: null })]) {
    const storage = memoryStorage(raw);
    const missions = new Missions(() => {}, { storage, today: TODAY });
    assert.deepEqual(missions.list.map(({ id }) => id), dailyMissionIds(TODAY));
    assert.deepEqual(missions.status().map(({ prog, done }) => ({ prog, done })), [
      { prog: 0, done: false },
      { prog: 0, done: false },
      { prog: 0, done: false },
    ]);
    assert.doesNotThrow(() => JSON.parse(storage.value()));
  }
});

test('mission state keeps only todays unique pool entries and clamps progress', () => {
  const ids = dailyMissionIds(TODAY);
  const state = normalizeMissionState({
    date: TODAY,
    list: [
      { id: ids[0], prog: 99999, done: false },
      { id: ids[0], prog: 0, done: false },
      { id: ids[1], prog: -20, done: true },
      { id: 'not-in-pool', prog: 5, done: true },
      { id: ids[2], prog: '2.9', done: false },
    ],
  }, TODAY);

  assert.deepEqual(state.list.map(({ id }) => id), ids);
  const status = new Missions(() => {}, {
    storage: memoryStorage(JSON.stringify(state)),
    today: TODAY,
  }).status();
  assert.equal(status[0].prog, status[0].goal);
  assert.equal(status[0].done, true);
  assert.equal(status[1].prog, status[1].goal);
  assert.equal(status[1].done, true);
  assert.ok(status[2].prog >= 0 && status[2].prog <= status[2].goal);
});

test('mission data from another date cannot carry progress into today', () => {
  const ids = dailyMissionIds(TODAY);
  const storage = memoryStorage(JSON.stringify({
    date: '2026-08-23',
    list: ids.map((id) => ({ id, prog: 999, done: true })),
  }));
  const missions = new Missions(() => {}, { storage, today: TODAY });
  assert.ok(missions.status().every(({ prog, done }) => prog === 0 && done === false));
});
