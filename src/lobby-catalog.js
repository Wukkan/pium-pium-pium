// Contrato puro y compartido del selector de lobby. No conoce DOM, WebSocket,
// almacenamiento ni estado de partida: tanto cliente como servidor pueden usar
// las mismas claves y límites sin mantener catálogos paralelos.

export const LOBBY_ROOMS_PER_MODE = 2;
export const LOBBY_ROOM_CAPACITY = 10;
export const DEFAULT_LOBBY_MODE = 'ffa';
export const DEFAULT_LOBBY_ROOM = 1;

const MODE_BLUEPRINTS = [
  {
    id: 'ffa',
    label: 'TODOS CONTRA TODOS',
    shortLabel: 'FFA',
    description: 'Combate individual. Cada baja cuenta para tu marcador.',
  },
  {
    id: 'teams',
    label: 'EQUIPOS',
    shortLabel: 'EQUIPOS',
    description: 'Dos escuadrones compiten por el control de la partida.',
  },
  {
    id: 'gun',
    label: 'BÚSQUEDA DEL ARMA',
    shortLabel: 'ARMAS',
    description: 'Avanza por la secuencia de armas con cada eliminación.',
  },
  {
    id: 'zombies',
    label: 'ZOMBIS',
    shortLabel: 'ZOMBIS',
    description: 'Coopera para sobrevivir a oleadas de enemigos.',
  },
];

export const LOBBY_ROOM_IDS = Object.freeze(
  Array.from({ length: LOBBY_ROOMS_PER_MODE }, (_, index) => index + 1),
);

function roomDefinition(mode, room) {
  return Object.freeze({
    key: `${mode}:${room}`,
    mode,
    room,
    label: `SALA ${room}`,
    capacity: LOBBY_ROOM_CAPACITY,
  });
}

export const LOBBY_MODES = Object.freeze(MODE_BLUEPRINTS.map((blueprint) => Object.freeze({
  ...blueprint,
  rooms: Object.freeze(LOBBY_ROOM_IDS.map((room) => roomDefinition(blueprint.id, room))),
})));

export const LOBBY_MODE_IDS = Object.freeze(LOBBY_MODES.map(({ id }) => id));
export const LOBBY_TOTAL_ROOMS = LOBBY_MODES.length * LOBBY_ROOMS_PER_MODE;
export const LOBBY_JOIN_ERROR_CODES = Object.freeze([
  'ROOM_FULL', 'INVALID_ROOM', 'INVALID_SELECTION', 'ROOM_MISMATCH', 'ROOM_NOT_FOUND',
]);

const MODE_BY_ID = new Map(LOBBY_MODES.map((mode) => [mode.id, mode]));
const ROOM_ID_SET = new Set(LOBBY_ROOM_IDS);

function normalizedMode(value) {
  if (typeof value !== 'string') return null;
  const mode = value.trim().toLowerCase();
  return MODE_BY_ID.has(mode) ? mode : null;
}

function normalizedRoom(value) {
  let room = value;
  if (typeof room === 'string') {
    const trimmed = room.trim();
    if (!/^\d+$/.test(trimmed) || String(Number(trimmed)) !== trimmed) return null;
    room = Number(trimmed);
  }
  return Number.isSafeInteger(room) && ROOM_ID_SET.has(room) ? room : null;
}

export function isLobbyMode(value) {
  return normalizedMode(value) !== null;
}

export function isLobbyRoom(value) {
  return normalizedRoom(value) !== null;
}

export function sanitizeLobbyMode(value, fallback = DEFAULT_LOBBY_MODE) {
  return normalizedMode(value) ?? normalizedMode(fallback) ?? DEFAULT_LOBBY_MODE;
}

export function sanitizeLobbyRoom(value, fallback = DEFAULT_LOBBY_ROOM) {
  return normalizedRoom(value) ?? normalizedRoom(fallback) ?? DEFAULT_LOBBY_ROOM;
}

export function sanitizeLobbySelection(value, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallbackSource = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
    ? fallback
    : {};
  return {
    mode: sanitizeLobbyMode(source.mode, fallbackSource.mode),
    room: sanitizeLobbyRoom(source.room, fallbackSource.room),
  };
}

export function lobbyRoomKey(mode, room) {
  return `${sanitizeLobbyMode(mode)}:${sanitizeLobbyRoom(room)}`;
}

export function getLobbyMode(mode) {
  return MODE_BY_ID.get(sanitizeLobbyMode(mode));
}

export function getLobbyRoom(mode, room) {
  const safeMode = getLobbyMode(mode);
  const safeRoom = sanitizeLobbyRoom(room);
  return safeMode.rooms[safeRoom - 1];
}

function sanitizedPlayerCount(value) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? (value.players ?? value.count)
    : value;
  if (candidate === '' || candidate === null || candidate === undefined) return 0;
  const numeric = Number(candidate);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(LOBBY_ROOM_CAPACITY, Math.max(0, Math.trunc(numeric)));
}

function validSnapshotSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const mode = normalizedMode(value.mode);
  const room = normalizedRoom(value.room);
  return mode && room ? { mode, room } : null;
}

// La ocupación puede venir como Map/objeto por clave `mode:room`, como objeto
// anidado por modo y sala, o como lista de snapshots `{ mode, room, players }`.
// Entradas inválidas nunca terminan asignadas por accidente a la sala fallback.
function occupancyFor(occupancy, mode, room) {
  const key = `${mode}:${room}`;
  if (occupancy instanceof Map) return sanitizedPlayerCount(occupancy.get(key));
  if (Array.isArray(occupancy)) {
    const match = occupancy.find((entry) => {
      const selection = validSnapshotSelection(entry);
      return selection?.mode === mode && selection.room === room;
    });
    return sanitizedPlayerCount(match);
  }
  if (!occupancy || typeof occupancy !== 'object') return 0;
  if (Array.isArray(occupancy.rooms)) return occupancyFor(occupancy.rooms, mode, room);
  if (Object.prototype.hasOwnProperty.call(occupancy, key)) {
    return sanitizedPlayerCount(occupancy[key]);
  }
  const modeRooms = Object.prototype.hasOwnProperty.call(occupancy, mode) ? occupancy[mode] : null;
  if (modeRooms && typeof modeRooms === 'object' &&
      Object.prototype.hasOwnProperty.call(modeRooms, room)) {
    return sanitizedPlayerCount(modeRooms[room]);
  }
  return 0;
}

function roomAvailability(players) {
  if (players >= LOBBY_ROOM_CAPACITY) return { status: 'full', statusLabel: 'LLENA' };
  if (players === 0) return { status: 'empty', statusLabel: 'VACÍA' };
  if (players >= LOBBY_ROOM_CAPACITY - 2) {
    return { status: 'almost-full', statusLabel: 'CASI LLENA' };
  }
  return { status: 'available', statusLabel: 'DISPONIBLE' };
}

export function lobbyRoomCardState(mode, room, {
  selection,
  players,
  occupancy,
} = {}) {
  const definition = getLobbyRoom(mode, room);
  const selected = sanitizeLobbySelection(selection);
  const playerCount = players === undefined
    ? occupancyFor(occupancy, definition.mode, definition.room)
    : sanitizedPlayerCount(players);
  const availableSlots = LOBBY_ROOM_CAPACITY - playerCount;
  const availability = roomAvailability(playerCount);
  const isSelected = selected.mode === definition.mode && selected.room === definition.room;
  return {
    ...definition,
    selected: isSelected,
    players: playerCount,
    availableSlots,
    occupancyLabel: `${playerCount} / ${LOBBY_ROOM_CAPACITY}`,
    full: availableSlots === 0,
    joinable: availableSlots > 0,
    disabled: availableSlots === 0,
    ...availability,
    ariaLabel: `${definition.label}, ${playerCount} de ${LOBBY_ROOM_CAPACITY} jugadores, ${availability.statusLabel.toLowerCase()}`,
  };
}

export function lobbyModeCardState(mode, {
  selection,
  occupancy,
} = {}) {
  const definition = getLobbyMode(mode);
  const selected = sanitizeLobbySelection(selection);
  const rooms = definition.rooms.map(({ room }) => lobbyRoomCardState(definition.id, room, {
    selection: selected,
    occupancy,
  }));
  const players = rooms.reduce((total, state) => total + state.players, 0);
  const availableRooms = rooms.filter(({ joinable }) => joinable).length;
  return {
    id: definition.id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    description: definition.description,
    selected: selected.mode === definition.id,
    rooms,
    roomCount: LOBBY_ROOMS_PER_MODE,
    players,
    capacity: LOBBY_ROOMS_PER_MODE * LOBBY_ROOM_CAPACITY,
    availableRooms,
    full: availableRooms === 0,
    joinable: availableRooms > 0,
  };
}

export function lobbySelectionState(selection, occupancy) {
  const safeSelection = sanitizeLobbySelection(selection);
  const mode = getLobbyMode(safeSelection.mode);
  const room = lobbyRoomCardState(safeSelection.mode, safeSelection.room, {
    selection: safeSelection,
    occupancy,
  });
  return {
    mode: safeSelection.mode,
    room: safeSelection.room,
    key: room.key,
    modeLabel: mode.label,
    roomLabel: room.label,
    players: room.players,
    capacity: room.capacity,
    availableSlots: room.availableSlots,
    full: room.full,
    joinable: room.joinable,
    status: room.status,
    statusLabel: room.statusLabel,
    occupancyLabel: room.occupancyLabel,
    title: `${mode.label} · ${room.label}`,
    detail: `${room.occupancyLabel} JUGADORES`,
    actionLabel: room.full ? 'SALA LLENA' : `ENTRAR A ${room.label}`,
  };
}

export function lobbyCatalogState({ selection, occupancy } = {}) {
  const safeSelection = sanitizeLobbySelection(selection);
  return {
    selection: lobbySelectionState(safeSelection, occupancy),
    modes: LOBBY_MODES.map(({ id }) => lobbyModeCardState(id, {
      selection: safeSelection,
      occupancy,
    })),
    roomsPerMode: LOBBY_ROOMS_PER_MODE,
    roomCapacity: LOBBY_ROOM_CAPACITY,
    totalRooms: LOBBY_TOTAL_ROOMS,
  };
}

export function lobbyJoinFailureAction(errorCode, {
  serverAvailable = false,
  recoveringOnlineSession = false,
} = {}) {
  return recoveringOnlineSession || LOBBY_JOIN_ERROR_CODES.includes(errorCode) || serverAvailable
    ? 'lobby'
    : 'offline';
}
