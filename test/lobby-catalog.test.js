import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOBBY_MODE,
  DEFAULT_LOBBY_ROOM,
  getLobbyMode,
  getLobbyRoom,
  isLobbyMode,
  isLobbyRoom,
  lobbyCatalogState,
  lobbyJoinFailureAction,
  lobbyModeCardState,
  lobbyRoomCardState,
  lobbyRoomKey,
  lobbySelectionState,
  LOBBY_MODE_IDS,
  LOBBY_MODES,
  LOBBY_ROOM_CAPACITY,
  LOBBY_ROOM_IDS,
  LOBBY_ROOMS_PER_MODE,
  LOBBY_TOTAL_ROOMS,
  sanitizeLobbyMode,
  sanitizeLobbyRoom,
  sanitizeLobbySelection,
} from '../src/lobby-catalog.js';

test('catalog exposes the four playable modes with exactly two ten-player rooms each', () => {
  assert.deepEqual(LOBBY_MODE_IDS, ['ffa', 'teams', 'gun', 'zombies']);
  assert.deepEqual(LOBBY_ROOM_IDS, [1, 2]);
  assert.equal(LOBBY_ROOMS_PER_MODE, 2);
  assert.equal(LOBBY_ROOM_CAPACITY, 10);
  assert.equal(LOBBY_TOTAL_ROOMS, 8);
  assert.equal(Object.isFrozen(LOBBY_MODES), true);
  assert.equal(Object.isFrozen(LOBBY_ROOM_IDS), true);

  const keys = new Set();
  for (const mode of LOBBY_MODES) {
    assert.equal(Object.isFrozen(mode), true);
    assert.equal(Object.isFrozen(mode.rooms), true);
    assert.equal(mode.rooms.length, 2);
    assert.ok(mode.label && mode.shortLabel && mode.description);
    for (const room of mode.rooms) {
      assert.equal(Object.isFrozen(room), true);
      assert.equal(room.mode, mode.id);
      assert.equal(room.capacity, 10);
      assert.match(room.label, /^SALA [12]$/);
      keys.add(room.key);
    }
  }
  assert.equal(keys.size, 8);
});

test('mode sanitization accepts canonical text and rejects unknown or hostile values', () => {
  assert.equal(DEFAULT_LOBBY_MODE, 'ffa');
  assert.equal(sanitizeLobbyMode(' TEAMS '), 'teams');
  assert.equal(sanitizeLobbyMode('Gun'), 'gun');
  assert.equal(sanitizeLobbyMode('private'), 'ffa');
  assert.equal(sanitizeLobbyMode(null, 'zombies'), 'zombies');
  assert.equal(sanitizeLobbyMode({}, '__proto__'), 'ffa');
  assert.equal(isLobbyMode(' zombies '), true);
  assert.equal(isLobbyMode('ZOMBIES_PLUS'), false);
});

test('room sanitization only admits one of the two canonical room numbers', () => {
  assert.equal(DEFAULT_LOBBY_ROOM, 1);
  assert.equal(sanitizeLobbyRoom(' 2 '), 2);
  assert.equal(sanitizeLobbyRoom(1), 1);
  assert.equal(sanitizeLobbyRoom(0, 2), 2);
  assert.equal(sanitizeLobbyRoom(3), 1);
  assert.equal(sanitizeLobbyRoom(1.5), 1);
  assert.equal(sanitizeLobbyRoom('1e0'), 1);
  assert.equal(sanitizeLobbyRoom('__proto__', '2'), 2);
  assert.equal(isLobbyRoom('2'), true);
  assert.equal(isLobbyRoom('02'), false);
});

test('selection sanitization repairs fields independently without mutating input', () => {
  const input = { mode: 'GUN', room: '2', extra: 'discarded' };
  const result = sanitizeLobbySelection(input);
  assert.deepEqual(result, { mode: 'gun', room: 2 });
  assert.deepEqual(input, { mode: 'GUN', room: '2', extra: 'discarded' });
  assert.deepEqual(
    sanitizeLobbySelection({ mode: 'invalid', room: 99 }, { mode: 'teams', room: 2 }),
    { mode: 'teams', room: 2 },
  );
  assert.deepEqual(sanitizeLobbySelection(null), { mode: 'ffa', room: 1 });
});

test('room lookup produces stable canonical keys and safe definitions', () => {
  assert.equal(lobbyRoomKey('teams', 2), 'teams:2');
  assert.equal(lobbyRoomKey('invalid', 9), 'ffa:1');
  assert.equal(getLobbyMode('ZOMBIES').id, 'zombies');
  assert.deepEqual(getLobbyRoom('gun', '2'), {
    key: 'gun:2', mode: 'gun', room: 2, label: 'SALA 2', capacity: 10,
  });
});

test('room UI state clamps occupancy and exposes empty, available, nearly-full and full states', () => {
  const empty = lobbyRoomCardState('ffa', 1, { players: -10 });
  assert.deepEqual(
    {
      players: empty.players, available: empty.availableSlots, status: empty.status,
      full: empty.full, joinable: empty.joinable, disabled: empty.disabled,
    },
    { players: 0, available: 10, status: 'empty', full: false, joinable: true, disabled: false },
  );

  const available = lobbyRoomCardState('ffa', 1, {
    players: 5.9,
    selection: { mode: 'ffa', room: 1 },
  });
  assert.equal(available.players, 5);
  assert.equal(available.selected, true);
  assert.equal(available.status, 'available');
  assert.equal(available.occupancyLabel, '5 / 10');
  assert.match(available.ariaLabel, /5 de 10 jugadores/);

  assert.equal(lobbyRoomCardState('ffa', 1, { players: 8 }).status, 'almost-full');
  const full = lobbyRoomCardState('ffa', 1, { players: 999 });
  assert.equal(full.players, 10);
  assert.equal(full.availableSlots, 0);
  assert.equal(full.status, 'full');
  assert.equal(full.statusLabel, 'LLENA');
  assert.equal(full.joinable, false);
  assert.equal(full.disabled, true);
  assert.equal(lobbyRoomCardState('ffa', 1, { players: Number.NaN }).players, 0);
});

test('mode UI state aggregates its two rooms without crossing mode boundaries', () => {
  const occupancy = {
    'teams:1': { players: 10 },
    'teams:2': 7,
    'ffa:1': 9,
  };
  const state = lobbyModeCardState('teams', {
    selection: { mode: 'teams', room: 2 },
    occupancy,
  });
  assert.equal(state.selected, true);
  assert.equal(state.roomCount, 2);
  assert.equal(state.capacity, 20);
  assert.equal(state.players, 17);
  assert.equal(state.availableRooms, 1);
  assert.equal(state.full, false);
  assert.equal(state.rooms[0].full, true);
  assert.equal(state.rooms[1].selected, true);

  const full = lobbyModeCardState('teams', {
    occupancy: { teams: { 1: 10, 2: { count: 10 } } },
  });
  assert.equal(full.players, 20);
  assert.equal(full.availableRooms, 0);
  assert.equal(full.full, true);
  assert.equal(full.joinable, false);
});

test('catalog UI accepts snapshot arrays, always returns eight rooms and ignores corrupt snapshots', () => {
  const snapshots = [
    { mode: 'ffa', room: 1, players: 3 },
    { mode: 'ffa', room: 2, players: 10 },
    { mode: 'gun', room: 2, players: '8' },
    { mode: 'private', room: 1, players: 10 },
    { mode: 'teams', room: 99, players: 10 },
  ];
  const state = lobbyCatalogState({
    selection: { mode: 'gun', room: 2 },
    occupancy: { rooms: snapshots },
  });
  assert.equal(state.modes.length, 4);
  assert.equal(state.modes.flatMap(({ rooms }) => rooms).length, 8);
  assert.equal(state.totalRooms, 8);
  assert.equal(state.roomsPerMode, 2);
  assert.equal(state.roomCapacity, 10);
  assert.equal(state.selection.key, 'gun:2');
  assert.equal(state.selection.players, 8);
  assert.equal(state.modes.find(({ id }) => id === 'ffa').players, 13);
  assert.equal(state.modes.find(({ id }) => id === 'teams').players, 0);
});

test('selection UI exposes a deterministic join decision for available and full rooms', () => {
  const available = lobbySelectionState(
    { mode: 'zombies', room: 2 },
    new Map([['zombies:2', 4]]),
  );
  assert.deepEqual(
    {
      key: available.key,
      title: available.title,
      detail: available.detail,
      action: available.actionLabel,
      joinable: available.joinable,
    },
    {
      key: 'zombies:2',
      title: 'ZOMBIS · SALA 2',
      detail: '4 / 10 JUGADORES',
      action: 'ENTRAR A SALA 2',
      joinable: true,
    },
  );

  const full = lobbySelectionState({ mode: 'zombies', room: 2 }, new Map([['zombies:2', 10]]));
  assert.equal(full.full, true);
  assert.equal(full.joinable, false);
  assert.equal(full.actionLabel, 'SALA LLENA');
});

test('authoritative room errors always return to the lobby instead of changing game type', () => {
  assert.equal(lobbyJoinFailureAction('ROOM_FULL'), 'lobby');
  assert.equal(lobbyJoinFailureAction('INVALID_SELECTION'), 'lobby');
  assert.equal(lobbyJoinFailureAction('network', { serverAvailable: true }), 'lobby');
  assert.equal(lobbyJoinFailureAction('network', { serverAvailable: false }), 'offline');
  assert.equal(lobbyJoinFailureAction('network', {
    serverAvailable: false,
    recoveringOnlineSession: true,
  }), 'lobby', 'a failed reconnect must not silently lock an established online player into local mode');
});
