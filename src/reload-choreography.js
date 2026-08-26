const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const smoothRange = (start, end, value) => smooth01((value - start) / (end - start));
const windowPulse = (value, start, peak, end) => {
  if (value <= start || value >= end) return 0;
  if (value < peak) return smoothRange(start, peak, value);
  return 1 - smoothRange(peak, end, value);
};
const windowPlateau = (value, openStart, openEnd, closeStart, closeEnd) => {
  if (value <= openStart || value >= closeEnd) return 0;
  if (value < openEnd) return smoothRange(openStart, openEnd, value);
  if (value <= closeStart) return 1;
  return 1 - smoothRange(closeStart, closeEnd, value);
};
const mix = (from, to, amount) => from + (to - from) * amount;
const mixVector = (from, to, amount) => from.map((value, index) => mix(value, to[index], amount));
const addVector = (left, right) => left.map((value, index) => value + right[index]);

export const RELOAD_PAYLOAD_TYPES = Object.freeze({
  pistol: 'magazine',
  smg: 'magazine',
  ar: 'magazine',
  sniper: 'magazine',
  shotgun: 'shell',
  revolver: 'speedloader',
  launcher: 'grenade',
});

const MAGAZINE_PATHS = Object.freeze({
  pistol: Object.freeze({
    socket: Object.freeze([0, -0.145, 0.065]),
    carry: Object.freeze([-0.38, -0.18, 0.145]),
    carryHandOffset: Object.freeze([-0.075, 0.065, -0.05]),
    insertHandOffset: Object.freeze([-0.09, 0.08, 0.005]),
    handRotation: Object.freeze([-0.42, -0.54, 0.46]),
  }),
  smg: Object.freeze({
    socket: Object.freeze([0, -0.15, 0.03]),
    carry: Object.freeze([-0.4, -0.19, 0.11]),
    carryHandOffset: Object.freeze([-0.08, 0.065, -0.05]),
    insertHandOffset: Object.freeze([-0.10, 0.085, 0.01]),
    handRotation: Object.freeze([-0.40, -0.55, 0.43]),
  }),
  ar: Object.freeze({
    socket: Object.freeze([0, -0.13, 0.02]),
    carry: Object.freeze([-0.4, -0.18, 0.10]),
    carryHandOffset: Object.freeze([-0.08, 0.06, -0.055]),
    insertHandOffset: Object.freeze([-0.10, 0.075, 0]),
    handRotation: Object.freeze([-0.38, -0.54, 0.44]),
  }),
  sniper: Object.freeze({
    socket: Object.freeze([0, -0.12, -0.02]),
    carry: Object.freeze([-0.4, -0.17, 0.06]),
    carryHandOffset: Object.freeze([-0.08, 0.06, -0.05]),
    insertHandOffset: Object.freeze([-0.10, 0.07, 0.01]),
    handRotation: Object.freeze([-0.36, -0.52, 0.41]),
  }),
});

const maximumVisibleRounds = (kind) => (kind === 'shotgun' || kind === 'revolver' ? 6 : 1);

export function sanitizeReloadRounds(kind, rounds) {
  const maximum = maximumVisibleRounds(kind);
  const numeric = Number(rounds);
  if (!Number.isFinite(numeric) || numeric <= 0) return maximum;
  return Math.min(maximum, Math.max(1, Math.floor(numeric)));
}

function phaseForMagazine(progress) {
  if (progress < 0.12) return 'present';
  if (progress < 0.3) return 'extract';
  if (progress < 0.56) return 'swap';
  if (progress < 0.76) return 'insert';
  if (progress < 0.84) return 'seat';
  if (progress < 0.94) return 'action';
  return 'recover';
}

function magazineState(kind, progress, active, roundCount) {
  const config = MAGAZINE_PATHS[kind] || MAGAZINE_PATHS.pistol;
  const extracted = smoothRange(0.12, 0.3, progress);
  // El cargador se presenta claramente a la izquierda antes de acelerar hacia
  // el brocal; así la mano no lo oculta en primera persona.
  const inserted = smoothRange(0.56, 0.76, progress);
  const oldPosition = mixVector(config.socket, config.carry, extracted);
  const sparePosition = mixVector(config.carry, config.socket, inserted);
  const oldRotation = [extracted * 0.16, 0, extracted * 0.12];
  const spareRotation = [(1 - inserted) * 0.16, 0, (1 - inserted) * 0.12];
  const useSpare = progress >= 0.3;
  const handPayloadPosition = useSpare ? sparePosition : oldPosition;
  const handOffset = useSpare
    ? mixVector(config.carryHandOffset, config.insertHandOffset, inserted)
    : config.carryHandOffset;
  const supportMix = active ? windowPlateau(progress, 0.04, 0.16, 0.86, 0.98) : 0;
  const seat = active ? windowPulse(progress, 0.74, 0.8, 0.87) : 0;
  const actionCycle = active ? windowPulse(progress, 0.82, 0.88, 0.95) : 0;

  return {
    kind,
    type: 'magazine',
    active,
    progress,
    phase: active ? phaseForMagazine(progress) : 'idle',
    roundCount,
    magazine: {
      installedVisible: !active || progress < 0.3 || progress >= 0.76,
      installedPosition: progress >= 0.76
        ? addVector(config.socket, [0, seat * 0.012, 0])
        : oldPosition,
      installedRotation: progress >= 0.76 ? [0, 0, 0] : oldRotation,
      spareVisible: active && progress >= 0.3 && progress < 0.76,
      sparePosition,
      spareRotation,
      socket: [...config.socket],
      extracted,
      inserted,
      seat,
    },
    payload: {
      visible: active && progress >= 0.3 && progress < 0.76,
      position: sparePosition,
      rotation: spareRotation,
      roundIndex: 0,
    },
    support: {
      role: supportMix > 0 ? 'reload' : 'support',
      mix: supportMix,
      holding: active && supportMix > 0.08 && progress < 0.88,
      grip: 'magazine',
      position: addVector(handPayloadPosition, handOffset),
      rotation: [...config.handRotation],
    },
    mechanism: {
      magazineDrop: !active ? 0 : progress < 0.3 ? extracted : progress < 0.76 ? 1 - inserted : 0,
      pumpTravel: 0,
      cylinderOpen: 0,
      breechOpen: 0,
      ejector: 0,
      actionCycle,
    },
    loadedVisible: false,
  };
}

function shotgunState(kind, progress, active, roundCount) {
  const loadStart = 0.14;
  const loadEnd = 0.7;
  const withinLoads = active && progress >= loadStart && progress < loadEnd;
  const scaled = withinLoads
    ? ((progress - loadStart) / (loadEnd - loadStart)) * roundCount
    : progress >= loadEnd ? roundCount : 0;
  const roundIndex = Math.min(roundCount - 1, Math.max(0, Math.floor(scaled)));
  const roundCycle = withinLoads ? scaled - Math.floor(scaled) : 0;
  const insert = smoothRange(0.16, 0.6, roundCycle);
  const handStroke = windowPlateau(roundCycle, 0.04, 0.5, 0.6, 0.98);
  const approach = [-0.10, -0.13, 0.13];
  const socket = [-0.02, -0.08, 0.04];
  const payloadPosition = mixVector(approach, socket, insert);
  const handPosition = addVector(mixVector(approach, socket, handStroke), [-0.055, 0.06, 0.035]);
  const shellVisible = withinLoads && roundCycle >= 0.07 && roundCycle <= 0.68;
  const shellSupport = active ? windowPlateau(progress, 0, 0.14, 0.69, 0.83) : 0;
  const pumpTravel = active ? windowPulse(progress, 0.83, 0.89, 0.98) : 0;
  const pumping = active && progress >= 0.83 && progress < 0.98;

  return {
    kind,
    type: 'shell',
    active,
    progress,
    phase: !active ? 'idle' : progress < loadStart ? 'present' : withinLoads ? 'insert' : pumping ? 'action' : 'recover',
    roundCount,
    payload: {
      visible: shellVisible,
      position: payloadPosition,
      rotation: [0, (1 - insert) * 0.85, -0.08],
      roundIndex,
      insert,
      socket,
    },
    support: {
      role: pumping ? 'pump' : shellSupport > 0 ? 'reload' : 'support',
      mix: pumping ? 0 : shellSupport,
      holding: shellVisible,
      grip: 'shell',
      position: handPosition,
      rotation: [-0.26, -1.05, 0.2],
    },
    mechanism: {
      magazineDrop: 0,
      pumpTravel,
      cylinderOpen: 0,
      breechOpen: 0,
      ejector: 0,
      actionCycle: pumpTravel,
    },
    loadedVisible: false,
  };
}

function revolverState(kind, progress, active, roundCount) {
  const cylinderOpen = active ? windowPlateau(progress, 0.08, 0.22, 0.72, 0.9) : 0;
  const carrierReach = active ? windowPlateau(progress, 0.28, 0.5, 0.6, 0.74) : 0;
  const approach = [0.15, -0.02, 0.18];
  const socket = [0.095, 0.03, 0.11];
  const payloadPosition = mixVector(approach, socket, carrierReach);
  const payloadVisible = active && progress >= 0.26 && progress < 0.74;
  const supportMix = active ? windowPlateau(progress, 0.14, 0.28, 0.72, 0.88) : 0;
  const ejector = active ? windowPulse(progress, 0.22, 0.32, 0.42) : 0;
  const loadedVisible = active && progress >= 0.5 && cylinderOpen > 0.04;

  return {
    kind,
    type: 'speedloader',
    active,
    progress,
    phase: !active ? 'idle' : progress < 0.22 ? 'open' : progress < 0.42 ? 'eject' : progress < 0.66 ? 'insert' : progress < 0.9 ? 'close' : 'recover',
    roundCount,
    payload: {
      visible: payloadVisible,
      position: payloadPosition,
      rotation: [0, 0, carrierReach * 0.55],
      roundIndex: 0,
      roundCount: loadedVisible ? 0 : roundCount,
      insert: carrierReach,
      socket,
    },
    support: {
      role: supportMix > 0 ? 'reload' : 'support',
      mix: supportMix,
      holding: payloadVisible,
      grip: 'speedloader',
      position: addVector(payloadPosition, [0.045, -0.05, -0.07]),
      rotation: [-0.3, -0.18, 0.62],
    },
    mechanism: {
      magazineDrop: 0,
      pumpTravel: 0,
      cylinderOpen,
      breechOpen: 0,
      ejector,
      actionCycle: 0,
    },
    loadedVisible,
    loadedRoundCount: loadedVisible ? roundCount : 0,
  };
}

function launcherState(kind, progress, active, roundCount) {
  const breechOpen = active ? windowPlateau(progress, 0.08, 0.22, 0.72, 0.9) : 0;
  const insert = active ? smoothRange(0.38, 0.72, progress) : 0;
  const approach = [-0.20, -0.12, -0.58];
  const socket = [0, 0, -0.48];
  const payloadPosition = mixVector(approach, socket, insert);
  const payloadVisible = active && progress >= 0.32 && progress < 0.82;
  const supportMix = active ? windowPlateau(progress, 0.14, 0.3, 0.78, 0.92) : 0;
  const handPosition = mixVector(
    [-0.20, -0.10, -0.46],
    [-0.08, -0.08, -0.45],
    smoothRange(0.32, 0.68, progress),
  );

  return {
    kind,
    type: 'grenade',
    active,
    progress,
    phase: !active ? 'idle' : progress < 0.22 ? 'open' : progress < 0.38 ? 'extract' : progress < 0.74 ? 'insert' : progress < 0.9 ? 'close' : 'recover',
    roundCount: 1,
    payload: {
      visible: payloadVisible,
      position: payloadPosition,
      rotation: [0, (1 - insert) * 0.9, -0.12 * (1 - insert)],
      roundIndex: 0,
      insert,
      socket,
    },
    support: {
      role: supportMix > 0 ? 'reload' : 'support',
      mix: supportMix,
      holding: payloadVisible,
      grip: 'grenade',
      position: handPosition,
      rotation: [-0.18, -1.3, -0.16],
    },
    mechanism: {
      magazineDrop: 0,
      pumpTravel: 0,
      cylinderOpen: 0,
      breechOpen,
      ejector: active ? windowPulse(progress, 0.22, 0.3, 0.4) : 0,
      actionCycle: 0,
    },
    loadedVisible: active && progress >= 0.68 && progress < 0.9,
  };
}

export function reloadChoreographyState({
  kind = 'pistol',
  progress = 0,
  active = true,
  rounds,
} = {}) {
  const safeKind = Object.prototype.hasOwnProperty.call(RELOAD_PAYLOAD_TYPES, kind) ? kind : 'pistol';
  const safeProgress = clamp01(progress);
  const safeActive = Boolean(active);
  const roundCount = sanitizeReloadRounds(safeKind, rounds);
  const type = RELOAD_PAYLOAD_TYPES[safeKind];
  if (type === 'magazine') return magazineState(safeKind, safeProgress, safeActive, roundCount);
  if (type === 'shell') return shotgunState(safeKind, safeProgress, safeActive, roundCount);
  if (type === 'speedloader') return revolverState(safeKind, safeProgress, safeActive, roundCount);
  return launcherState(safeKind, safeProgress, safeActive, roundCount);
}
