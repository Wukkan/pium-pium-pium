import { jumpPadContainsPoint } from './shared/mapdata.js';

// Los saltadores tienen prioridad sobre el salto manual. Esta comprobación se
// ejecuta antes de Player.update para que mantener Espacio (bunny-hop) no
// consuma primero el estado onGround con el impulso normal de 8.6 m/s.
export function activateGroundedJumpPad(player, pads, inputEnabled = true) {
  if (!inputEnabled || !player?.onGround || !player?.pos || !Array.isArray(pads)) return null;

  for (const pad of pads) {
    if (!jumpPadContainsPoint(player.pos, pad)) continue;
    const launched = typeof player.launchFromPad === 'function'
      ? player.launchFromPad(pad)
      : typeof player.launchVertical === 'function' && player.launchVertical(pad.power);
    if (!launched) continue;
    return pad;
  }
  return null;
}
