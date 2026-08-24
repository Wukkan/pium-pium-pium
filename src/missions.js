// ---------------------------------------------------------------------------
// Misiones diarias (locales, guardadas en el navegador): 3 al día, $300 cada
// una. Se eligen del pool según la fecha, así todos tienen las mismas.
// ---------------------------------------------------------------------------

const POOL = [
  { id: 'kills15', txt: 'Consigue 15 bajas', goal: 15, ev: 'kill' },
  { id: 'heads3', txt: 'Acierta 3 tiros a la cabeza', goal: 3, ev: 'headshot' },
  { id: 'win1', txt: 'Gana una partida', goal: 1, ev: 'win' },
  { id: 'streak5', txt: 'Logra una racha de 5', goal: 1, ev: 'streak5' },
  { id: 'kits3', txt: 'Recoge 3 botiquines', goal: 3, ev: 'kit' },
  { id: 'knife2', txt: 'Mata a 2 con el cuchillo', goal: 2, ev: 'knifekill' },
  { id: 'nade1', txt: 'Mata a 1 con granada', goal: 1, ev: 'nadekill' },
];

const STORAGE_KEY = 'pium_missions';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POOL_BY_ID = new Map(POOL.map((mission) => [mission.id, mission]));

export const MISSION_REWARD = 300;

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value, fallback = currentDate()) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : fallback;
}

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readStoredValue(storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return null;
    const raw = storage.getItem(STORAGE_KEY);
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function dailyMissionIds(date = currentDate()) {
  const safeDate = normalizeDate(date);
  let seed = 0;
  for (const ch of safeDate) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const indices = [];
  while (indices.length < 3) {
    seed = (seed * 7 + 13) % 9973;
    const index = seed % POOL.length;
    if (!indices.includes(index)) indices.push(index);
  }
  return indices.map((index) => POOL[index].id);
}

export function normalizeMissionState(value, date = currentDate()) {
  const safeDate = normalizeDate(date);
  const source = value && typeof value === 'object' && !Array.isArray(value) &&
    value.date === safeDate && Array.isArray(value.list)
    ? value.list
    : [];
  const allowedIds = dailyMissionIds(safeDate);
  const savedById = new Map();
  for (const entry of source) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (!allowedIds.includes(entry.id) || savedById.has(entry.id)) continue;
    savedById.set(entry.id, entry);
  }

  const list = allowedIds.map((id) => {
    const definition = POOL_BY_ID.get(id);
    const entry = savedById.get(id);
    const numericProgress = Number(entry?.prog);
    let progress = Number.isFinite(numericProgress) ? Math.floor(numericProgress) : 0;
    progress = Math.min(definition.goal, Math.max(0, progress));
    const done = entry?.done === true || entry?.done === 1 || progress >= definition.goal;
    if (done) progress = definition.goal;
    return { id, prog: progress, done };
  });

  return { date: safeDate, list };
}

export class Missions {
  // onReward(cantidad, textoMision)
  constructor(onReward, options = {}) {
    const config = options && typeof options === 'object' ? options : {};
    this.onReward = typeof onReward === 'function' ? onReward : () => {};
    this.storage = Object.hasOwn(config, 'storage') ? config.storage : defaultStorage();
    const today = normalizeDate(config.today);
    const state = normalizeMissionState(readStoredValue(this.storage), today);
    this.date = state.date;
    this.list = state.list;
    // También repara silenciosamente datos antiguos o parcialmente corruptos.
    this.save();
  }

  save(date = this.date) {
    const safeDate = normalizeDate(date, this.date);
    const state = normalizeMissionState({ date: safeDate, list: this.list }, safeDate);
    this.date = state.date;
    this.list = state.list;
    try {
      if (!this.storage || typeof this.storage.setItem !== 'function') return false;
      this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  event(ev) {
    let changed = false;
    for (const mission of this.list) {
      const definition = POOL_BY_ID.get(mission.id);
      if (!definition || mission.done || definition.ev !== ev) continue;
      mission.prog = Math.min(definition.goal, mission.prog + 1);
      changed = true;
      if (mission.prog >= definition.goal) {
        mission.done = true;
        this.onReward(MISSION_REWARD, definition.txt);
      }
    }
    if (changed) this.save();
  }

  // para pintar en el menú: [{txt, prog, goal, done}]
  status() {
    return this.list.map((mission) => {
      const definition = POOL_BY_ID.get(mission.id);
      return {
        txt: definition.txt,
        prog: Math.min(mission.prog, definition.goal),
        goal: definition.goal,
        done: mission.done,
      };
    });
  }
}
