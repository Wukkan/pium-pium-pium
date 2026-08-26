export const PROTOCOL_VERSION = 2;

// Catálogo único del cable. Añadir un mensaje exige declararlo aquí y cubrirlo
// con una prueba; así cliente y servidor no acumulan eventos fantasma.
export const CLIENT_MESSAGE_TYPES = Object.freeze([
  'hola', 'st', 'fire', 'hit', 'team', 'vote', 'selfdmg', 'chat', 'skin',
  'botcfg', 'ping', 'nade',
]);

export const SERVER_MESSAGE_TYPES = Object.freeze([
  'hi', 'full', 'joinerr', 'snap', 'match', 'podium', 'votes', 'chat', 'pong',
  'ammo', 'botcfg', 'cbox', 'gun', 'fire', 'kill', 'nade', 'ouch', 'spawn',
  'med', 'aviso', 'botbye', 'corr', 'hitok',
]);

export function isClientMessageType(type) {
  return typeof type === 'string' && CLIENT_MESSAGE_TYPES.includes(type);
}

export function isServerMessageType(type) {
  return typeof type === 'string' && SERVER_MESSAGE_TYPES.includes(type);
}
