const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const digit = (curl, { contact = true, splay = 0, twist = 0 } = {}) => ({
  curl,
  contact,
  splay,
  twist,
});

const triggerFingers = () => ({
  index: digit([0.18, 0.28, 0.22], { splay: 0.04, twist: -0.03 }),
  middle: digit([0.58, 0.72, 0.62], { splay: 0.015 }),
  ring: digit([0.63, 0.77, 0.68], { splay: -0.01 }),
  pinky: digit([0.69, 0.83, 0.75], { splay: -0.045, twist: 0.025 }),
});

const supportFingers = ({ compact = false } = {}) => ({
  index: digit(compact ? [0.46, 0.62, 0.55] : [0.52, 0.68, 0.60], { splay: 0.035 }),
  middle: digit(compact ? [0.53, 0.69, 0.61] : [0.58, 0.74, 0.66], { splay: 0.012 }),
  ring: digit(compact ? [0.58, 0.73, 0.66] : [0.63, 0.78, 0.70], { splay: -0.012 }),
  pinky: digit(compact ? [0.64, 0.78, 0.71] : [0.68, 0.82, 0.74], { splay: -0.04 }),
});

const knifeFingers = () => ({
  index: digit([0.56, 0.68, 0.60], { splay: 0.032, twist: -0.018 }),
  middle: digit([0.65, 0.78, 0.69], { splay: 0.01 }),
  ring: digit([0.70, 0.82, 0.74], { splay: -0.014 }),
  pinky: digit([0.74, 0.86, 0.78], { splay: -0.04, twist: 0.02 }),
});

const guardFingers = () => ({
  index: digit([0.18, 0.24, 0.18], { contact: false, splay: 0.14, twist: -0.025 }),
  middle: digit([0.22, 0.29, 0.22], { contact: false, splay: 0.052 }),
  ring: digit([0.27, 0.34, 0.26], { contact: false, splay: -0.045 }),
  pinky: digit([0.34, 0.42, 0.32], { contact: false, splay: -0.14, twist: 0.025 }),
});

const triggerHand = (position, rotation) => ({
  role: 'trigger',
  position,
  rotation,
  fingers: triggerFingers(),
  thumb: digit([0.42, 0.55], { splay: 0.03, twist: -0.05 }),
});

const supportHand = (position, rotation, { compact = false } = {}) => ({
  role: 'support',
  position,
  rotation,
  fingers: supportFingers({ compact }),
  thumb: digit(compact ? [0.34, 0.48] : [0.38, 0.52], { splay: -0.025, twist: 0.04 }),
});

// Cada perfil vive en coordenadas locales del modelo real del arma. Las
// rotaciones orientan la palma contra el lateral de la empuñadura y hacen que
// los dedos crucen el guardamanos, en vez de correr longitudinalmente sobre él.
export const HAND_GRIP_PROFILES = deepFreeze({
  pistol: {
    right: triggerHand([0.030, -0.125, 0.095], [-0.10, 0.03, 1.28]),
    left: supportHand([-0.055, -0.115, 0.045], [-0.15, -1.18, -0.12], { compact: true }),
    reload: { position: [-0.055, -0.400, 0.110], rotation: [-0.62, -0.58, 0.42] },
  },
  revolver: {
    right: triggerHand([0.032, -0.120, 0.120], [-0.12, 0.05, 1.22]),
    left: supportHand([-0.065, -0.095, 0.015], [-0.08, -1.08, -0.18], { compact: true }),
    reload: { position: [0.140, -0.020, 0.040], rotation: [-0.30, -0.18, 0.62] },
  },
  shotgun: {
    right: triggerHand([0.030, -0.120, 0.110], [-0.08, 0.02, 1.22]),
    left: supportHand([-0.100, -0.112, -0.300], [-0.08, -1.48, -0.10]),
  },
  smg: {
    right: triggerHand([0.030, -0.125, 0.080], [-0.10, 0.02, 1.26]),
    left: supportHand([-0.086, -0.097, -0.180], [-0.08, -1.46, -0.08]),
    reload: { position: [-0.065, -0.390, 0.085], rotation: [-0.58, -0.52, 0.38] },
  },
  ar: {
    right: triggerHand([0.030, -0.130, 0.085], [-0.10, 0.02, 1.27]),
    left: supportHand([-0.088, -0.102, -0.310], [-0.06, -1.48, -0.08]),
    reload: { position: [-0.070, -0.370, 0.075], rotation: [-0.56, -0.50, 0.40] },
  },
  sniper: {
    right: triggerHand([0.030, -0.120, 0.120], [-0.10, 0.02, 1.20]),
    left: supportHand([-0.100, -0.087, -0.350], [-0.05, -1.48, -0.06]),
    reload: { position: [-0.065, -0.360, 0.035], rotation: [-0.52, -0.48, 0.36] },
  },
  launcher: {
    right: triggerHand([0.030, -0.135, 0.145], [-0.08, 0.02, 1.20]),
    left: supportHand([-0.078, -0.115, -0.200], [-0.03, -1.48, -0.05]),
    reload: { position: [-0.080, -0.080, -0.450], rotation: [-0.18, -1.30, -0.16] },
  },
  knife: {
    right: {
      role: 'knife',
      // La palma queda fuera del volumen del mango; son las yemas las que
      // alcanzan la goma y no el centro de los dedos.
      position: [0.020, -0.106, 0.070],
      rotation: [-0.09, 1.48, 0.035],
      fingers: knifeFingers(),
      thumb: digit([0.48, 0.62], { splay: 0.025, twist: -0.055 }),
    },
    left: {
      role: 'guard',
      position: [-0.155, -0.132, 0.012],
      rotation: [-0.42, -0.34, -0.36],
      fingers: guardFingers(),
      thumb: digit([0.28, 0.36], { contact: false, splay: -0.16, twist: 0.035 }),
    },
  },
});

const cloneDigit = (source) => ({
  curl: [...source.curl],
  contact: source.contact,
  splay: source.splay || 0,
  twist: source.twist || 0,
});

const cloneHand = (source) => ({
  role: source.role,
  position: [...source.position],
  rotation: [...source.rotation],
  fingers: Object.fromEntries(Object.entries(source.fingers).map(([name, value]) => [name, cloneDigit(value)])),
  thumb: cloneDigit(source.thumb),
});

const mix = (from, to, amount) => from + (to - from) * amount;
const mixVector = (from, to, amount) => from.map((value, index) => mix(value, to[index], amount));

function relaxReloadHand(hand, amount) {
  const relaxed = {
    index: [0.20, 0.30, 0.24],
    middle: [0.31, 0.42, 0.34],
    ring: [0.36, 0.47, 0.39],
    pinky: [0.42, 0.53, 0.45],
  };
  for (const [name, finger] of Object.entries(hand.fingers)) {
    finger.curl = mixVector(finger.curl, relaxed[name], amount);
    finger.contact = amount < 0.08;
  }
  hand.thumb.curl = mixVector(hand.thumb.curl, [0.20, 0.30], amount);
  hand.thumb.contact = amount < 0.08;
}

function tightenHand(hand, amount) {
  for (const [name, finger] of Object.entries(hand.fingers)) {
    if (name === 'index' && hand.role === 'trigger') continue;
    finger.curl = finger.curl.map((value) => clamp01(value + amount));
  }
  hand.thumb.curl = hand.thumb.curl.map((value) => clamp01(value + amount * 0.65));
}

const STATIC_GRIP_STATES = new Map();

export function handGripState({
  kind = 'pistol',
  ads = false,
  reloading = false,
  reloadProgress = 0,
  firePulse = 0,
} = {}) {
  const safeKind = Object.prototype.hasOwnProperty.call(HAND_GRIP_PROFILES, kind) ? kind : 'pistol';
  const shotPressure = clamp01(firePulse);
  const cacheable = !reloading && shotPressure === 0;
  const cacheKey = cacheable ? `${safeKind}:${Boolean(ads)}` : '';
  if (cacheable && STATIC_GRIP_STATES.has(cacheKey)) return STATIC_GRIP_STATES.get(cacheKey);
  const profile = HAND_GRIP_PROFILES[safeKind];
  const right = cloneHand(profile.right);
  const left = cloneHand(profile.left);
  const reload = reloading ? clamp01(reloadProgress) : 0;
  // Sube y baja de forma continua, y vuelve exactamente al anclaje al acabar.
  const manipulation = reloading && reload > 0 && reload < 1 ? Math.sin(reload * Math.PI) : 0;

  if (safeKind === 'shotgun' && manipulation > 0) {
    left.role = 'pump';
    tightenHand(left, 0.035 * manipulation);
  } else if (profile.reload && manipulation > 0) {
    left.role = 'reload';
    left.position = mixVector(left.position, profile.reload.position, manipulation);
    left.rotation = mixVector(left.rotation, profile.reload.rotation, manipulation);
    relaxReloadHand(left, manipulation);
  }

  // El arma y las manos comparten rig. ADS no cambia sus anclajes; solamente
  // refuerza la presión de agarre. El disparo aprieta los dedos sin despegarlos.
  const pressure = (ads ? 0.012 : 0) + shotPressure * (safeKind === 'knife' ? 0.07 : 0.018);
  if (pressure > 0) {
    tightenHand(right, pressure);
    if (left.role !== 'reload') tightenHand(left, pressure * 0.7);
  }

  const state = { kind: safeKind, right, left };
  if (cacheable) {
    deepFreeze(state);
    STATIC_GRIP_STATES.set(cacheKey, state);
  }
  return state;
}
