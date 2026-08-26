export const NETWORK_LIMITS = Object.freeze({
  snapshotBackpressureBytes: 256 * 1024,
  hardBackpressureBytes: 1024 * 1024,
  maxWebSocketConnections: 160,
  clientIdleSeconds: 90,
});

export function outboundDeliveryAction({ readyState, bufferedAmount, type } = {}) {
  if (readyState !== 1) return 'drop';
  const pending = Number.isFinite(Number(bufferedAmount))
    ? Math.max(0, Number(bufferedAmount))
    : NETWORK_LIMITS.hardBackpressureBytes + 1;
  if (pending > NETWORK_LIMITS.hardBackpressureBytes) return 'close';
  if (type === 'snap' && pending > NETWORK_LIMITS.snapshotBackpressureBytes) return 'skip';
  return 'send';
}

export function websocketOriginAllowed(origin, host) {
  if (origin === undefined || origin === null || origin === '') return true;
  if (typeof origin !== 'string' || typeof host !== 'string' || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function sanitizeIdleSeconds(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(1, Math.min(600, numeric))
    : NETWORK_LIMITS.clientIdleSeconds;
}
