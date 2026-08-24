export const DEFAULT_BINDINGS = Object.freeze({
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  jump: 'Space',
  slide: 'ShiftLeft',
  reload: 'KeyR',
  grenade: 'KeyG',
  melee: 'KeyV',
  scoreboard: 'Tab',
  openArsenal: 'KeyB',
  openBots: 'KeyH',
  changeTeam: 'KeyM',
  quickChat: 'KeyC',
  muteSound: 'KeyP',
  slot1: 'Digit1',
  slot2: 'Digit2',
  slot3: 'Digit3',
  slot4: 'Digit4',
  slot5: 'Digit5',
  slot6: 'Digit6',
  slot7: 'Digit7',
});

export const BINDING_ACTIONS = Object.freeze([
  { action: 'moveForward', label: 'Avanzar', group: 'Movimiento' },
  { action: 'moveBackward', label: 'Retroceder', group: 'Movimiento' },
  { action: 'moveLeft', label: 'Moverse a la izquierda', group: 'Movimiento' },
  { action: 'moveRight', label: 'Moverse a la derecha', group: 'Movimiento' },
  { action: 'jump', label: 'Saltar / bunny-hop', group: 'Movimiento' },
  { action: 'slide', label: 'Deslizarse', group: 'Movimiento' },
  { action: 'reload', label: 'Recargar', group: 'Combate' },
  { action: 'grenade', label: 'Lanzar granada', group: 'Combate' },
  { action: 'melee', label: 'Ataque con cuchillo', group: 'Combate' },
  { action: 'slot1', label: 'Arma / opción 1', group: 'Ranuras' },
  { action: 'slot2', label: 'Arma / opción 2', group: 'Ranuras' },
  { action: 'slot3', label: 'Arma / opción 3', group: 'Ranuras' },
  { action: 'slot4', label: 'Arma / opción 4', group: 'Ranuras' },
  { action: 'slot5', label: 'Arma / opción 5', group: 'Ranuras' },
  { action: 'slot6', label: 'Arma / opción 6', group: 'Ranuras' },
  { action: 'slot7', label: 'Arma / opción 7', group: 'Ranuras' },
  { action: 'scoreboard', label: 'Mostrar marcador', group: 'Interfaz' },
  { action: 'openArsenal', label: 'Abrir arsenal', group: 'Interfaz' },
  { action: 'openBots', label: 'Controlar bots', group: 'Interfaz' },
  { action: 'changeTeam', label: 'Cambiar equipo', group: 'Interfaz' },
  { action: 'quickChat', label: 'Chat rápido', group: 'Interfaz' },
  { action: 'muteSound', label: 'Silenciar / activar sonido', group: 'Interfaz' },
]);

const ACTION_NAMES = new Set(BINDING_ACTIONS.map(({ action }) => action));
const RESERVED_CODES = new Set([
  'Escape', 'F5', 'F11', 'F12', 'PrintScreen', 'Pause',
  'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ContextMenu',
]);

export function isBindableKeyCode(code) {
  if (typeof code !== 'string' || code.length < 2 || code.length > 24) return false;
  if (RESERVED_CODES.has(code)) return false;
  return /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Space|Tab|Enter|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|ShiftLeft|ShiftRight|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(code);
}

function normalizedObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function assignUnchecked(bindings, action, code) {
  const next = { ...bindings };
  const previous = next[action];
  const conflict = Object.keys(next).find((name) => name !== action && next[name] === code) || null;
  if (conflict) next[conflict] = previous;
  next[action] = code;
  return { bindings: next, conflict };
}

export function readBindings(raw) {
  const value = normalizedObject(raw);
  const stored = {};
  for (const { action } of BINDING_ACTIONS) {
    const code = value[action];
    if (!isBindableKeyCode(code)) continue;
    if (code === 'Tab' && action !== 'scoreboard') continue;
    stored[action] = code;
  }

  // La interfaz guarda el mapa completo. Si ese mapa ya es válido, conservarlo
  // literalmente evita que el orden de los valores por defecto deshaga swaps
  // legítimos al volver a cargar la página.
  const merged = { ...DEFAULT_BINDINGS, ...stored };
  const mergedCodes = Object.values(merged);
  if (new Set(mergedCodes).size === mergedCodes.length) return merged;

  // Para datos antiguos, parciales o corruptos, reconstruir de forma segura y
  // usar intercambios mantiene siempre una tecla única por acción.
  let bindings = { ...DEFAULT_BINDINGS };
  for (const { action } of BINDING_ACTIONS) {
    const code = stored[action];
    if (!code) continue;
    const conflict = Object.keys(bindings).find((name) => name !== action && bindings[name] === code) || null;
    if (action === 'scoreboard' && bindings.scoreboard === 'Tab' && conflict) continue;
    bindings = assignUnchecked(bindings, action, code).bindings;
  }
  return bindings;
}

export function assignBinding(bindings, action, code) {
  const current = readBindings(bindings);
  if (!ACTION_NAMES.has(action)) {
    return { bindings: current, changed: false, conflict: null, error: 'unknown-action' };
  }
  if (!isBindableKeyCode(code)) {
    return { bindings: current, changed: false, conflict: null, error: 'reserved-key' };
  }
  if (code === 'Tab' && action !== 'scoreboard') {
    return { bindings: current, changed: false, conflict: null, error: 'tab-reserved' };
  }
  if (current[action] === code) {
    return { bindings: current, changed: false, conflict: null, error: null };
  }
  const conflict = Object.keys(current).find((name) => name !== action && current[name] === code) || null;
  if (action === 'scoreboard' && current.scoreboard === 'Tab' && conflict) {
    return { bindings: current, changed: false, conflict, error: 'occupied-key' };
  }
  const result = assignUnchecked(current, action, code);
  return { ...result, changed: true, error: null };
}

export function matchesBinding(bindings, action, code) {
  return bindings?.[action] === code;
}

export function bindingSlotIndex(bindings, code) {
  for (let index = 0; index < 7; index++) {
    if (bindings?.[`slot${index + 1}`] === code) return index;
  }
  return -1;
}

export function keyCodeLabel(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `NUM ${code.slice(6)}`;
  const labels = {
    Space: 'ESPACIO', Tab: 'TAB', Enter: 'ENTER', Backquote: 'º / `',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', CapsLock: 'BLOQ MAYÚS',
    ShiftLeft: 'SHIFT IZQ', ShiftRight: 'SHIFT DER',
    ControlLeft: 'CTRL IZQ', ControlRight: 'CTRL DER',
    AltLeft: 'ALT IZQ', AltRight: 'ALT DER',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  };
  return labels[code] || code || 'SIN ASIGNAR';
}
