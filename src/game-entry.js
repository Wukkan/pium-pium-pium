// Entrada robusta al combate: Pointer Lock mejora el control del mouse, pero
// nunca debe decidir si la partida puede mostrarse o aceptar teclado.

export function gameplayControlActive(pointerLockElement, fallbackActive = false, requiredElement = null) {
  const ownsPointerLock = requiredElement
    ? pointerLockElement === requiredElement
    : !!pointerLockElement;
  return ownsPointerLock || !!fallbackActive;
}

export function requestPointerLockSafe(target) {
  if (!target || typeof target.requestPointerLock !== 'function') {
    return { requested: false, completion: Promise.resolve(false) };
  }

  try {
    const result = target.requestPointerLock();
    const completion = result && typeof result.then === 'function'
      ? Promise.resolve(result).then(() => true, () => false)
      : Promise.resolve(true);
    return { requested: true, completion };
  } catch {
    return { requested: false, completion: Promise.resolve(false) };
  }
}
