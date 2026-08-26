// Política pura de capacidades del combate. Mantener estas decisiones fuera
// de main.js evita que movimiento, armas, audio y Pointer Lock diverjan a
// medida que se agregan nuevas interfaces o estados de partida.

export function gameplayOverlayPolicy({
  chatOpen = false,
  buyOpen = false,
  botPanelOpen = false,
  podiumOpen = false,
  teamPickerOpen = false,
} = {}) {
  const modal = !!(buyOpen || botPanelOpen || podiumOpen || teamPickerOpen);
  const communication = !!chatOpen;
  return Object.freeze({
    modal,
    communication,
    movement: modal,
    combat: modal || communication,
    audio: modal || communication,
  });
}

export function gameplayCapabilities({
  state = 'menu',
  hasControl = false,
  connecting = false,
  dead = false,
  hidden = false,
  ...overlayState
} = {}) {
  const overlays = gameplayOverlayPolicy(overlayState);
  const active = state === 'playing' && !connecting && !dead;
  return Object.freeze({
    active,
    movement: active && !!hasControl && !overlays.movement,
    combat: active && !!hasControl && !overlays.combat,
    audio: state === 'playing' && !dead && !hidden && !overlays.audio,
    pointerLock: active && !overlays.modal,
    overlays,
  });
}

export function combatAudioAllowed({
  state = 'menu', dead = false, overlayOpen = false, hidden = false,
} = {}) {
  return state === 'playing' && !dead && !overlayOpen && !hidden;
}
