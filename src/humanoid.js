import * as THREE from 'three';
import { humanoidModelProfile } from './ui-models.js';
import {
  clamp01,
  operatorDeathState,
  operatorMotionState,
} from './character-motion.js';
import { handGripState } from './hand-grip.js';
import { roundedBoxGeometry } from './rounded-geometry.js';

// ---------------------------------------------------------------------------
// Modelo humanoide "blocky" compartido por bots locales y jugadores remotos.
// ---------------------------------------------------------------------------

// Los volúmenes exteriores siguen siendo idénticos a los hitboxes originales.
// Las piezas grandes reciben un bisel un poco más suave, mientras los detalles
// finos usan un solo segmento para mantener estable el presupuesto por operador.
function operatorBoxGeometry(width, height, depth) {
  const shortest = Math.min(Math.abs(width), Math.abs(height), Math.abs(depth));
  return roundedBoxGeometry(width, height, depth, {
    ratio: shortest < 0.07 ? 0.12 : shortest < 0.16 ? 0.15 : 0.18,
    maxRadius: shortest < 0.07 ? 0.008 : 0.055,
    segments: shortest >= 0.16 ? 2 : 1,
  });
}

// Manga elíptica de bajo coste. Los extremos quedan cubiertos por hombro,
// codo y cuff; el ensanchamiento central evita la silueta de tubo o ladrillo.
function operatorLimbGeometry(width, length, depth, { top = 0.48, bottom = 0.38 } = {}) {
  const half = length / 2;
  const middle = Math.max(top, bottom) * 1.035;
  const geometry = new THREE.LatheGeometry([
    new THREE.Vector2(0, -half),
    new THREE.Vector2(bottom * 0.76, -half * 0.94),
    new THREE.Vector2(bottom, -half * 0.8),
    new THREE.Vector2((bottom + middle) / 2, -half * 0.18),
    new THREE.Vector2(middle, half * 0.22),
    new THREE.Vector2(top, half * 0.8),
    new THREE.Vector2(top * 0.76, half * 0.94),
    new THREE.Vector2(0, half),
  ], 12);
  geometry.scale(width, 1, depth);
  return geometry;
}

const freezeVector = (values) => Object.freeze([...values]);

// Proporciones compactas para que la mano siga siendo legible a distancia sin
// volverla un bloque. Las falanges usan geometría compartida de pocos lados y
// no participan en el raycast: el hitbox de brazo conserva su tamaño original.
export const OPERATOR_HAND_PROFILE = Object.freeze({
  palm: freezeVector([0.178, 0.138, 0.184]),
  wrist: freezeVector([0.152, 0.072, 0.164]),
  fingerLengths: freezeVector([0.086, 0.098, 0.092, 0.075]),
  fingerCurls: freezeVector([0.34, 0.48, 0.54, 0.61]),
  middleCurls: freezeVector([0.48, 0.63, 0.69, 0.76]),
  distalCurls: freezeVector([0.38, 0.52, 0.58, 0.65]),
  thumbLength: 0.112,
  segmentsPerFinger: 3,
  meshBudgetPerHand: 17,
});

// El alcance total sigue siendo el histórico (0.725 m) para no cambiar la
// silueta de combate ni la replicación. La distribución anterior, 0.52/0.205,
// hacía que el antebrazo pareciera amputado. Estas proporciones forman una
// cadena continua y cercana a la anatomía humana, con solapes en cada unión.
export const OPERATOR_ARM_PROFILE = Object.freeze({
  upperLength: 0.397,
  forearmLength: 0.328,
  upper: freezeVector([0.205, 0.397, 0.235]),
  forearm: freezeVector([0.178, 0.328, 0.205]),
  shoulder: freezeVector([0.255, 0.18, 0.3]),
  elbow: freezeVector([0.195, 0.145, 0.225]),
  cuff: freezeVector([0.174, 0.082, 0.198]),
  meshBudgetPerArm: 6,
});

export const OPERATOR_GRIP_CLEARANCE = Object.freeze({
  right: Object.freeze({
    pistol: freezeVector([0, 0, 0.126]),
    revolver: freezeVector([0, 0, 0.126]),
    shotgun: freezeVector([0, 0, 0.126]),
    smg: freezeVector([0, 0, 0.125]),
    ar: freezeVector([0, 0, 0.134]),
    sniper: freezeVector([0, 0, 0.127]),
    launcher: freezeVector([0, 0, 0.124]),
  }),
  left: Object.freeze({
    pistol: freezeVector([0, 0.11, 0]),
    revolver: freezeVector([0, 0.114, 0]),
    shotgun: freezeVector([0, 0.026, 0]),
    smg: freezeVector([0, 0.042, 0]),
    ar: freezeVector([0, 0.038, 0]),
    sniper: freezeVector([0, 0.026, 0]),
    launcher: freezeVector([0, 0.07, 0]),
  }),
});

// Ajuste propio del rig de tercera persona. Las poses canonicas tambien sirven
// a las manos de primera persona, por eso la oposicion final del pulgar vive
// aqui y no modifica el viewmodel. Los valores se calibraron sobre la malla
// real de cada arma para que la yema llegue a la empunadura.
export const OPERATOR_THUMB_CONTACT = Object.freeze({
  generic: Object.freeze({
    right: freezeVector([1.1473012, -0.1602019, 0.6365866]),
    left: freezeVector([0.8144593, -0.010548, 0.5426521]),
  }),
  pistol: Object.freeze({ right: freezeVector([0.7097247, 0.1331837, 0.6229084]), left: freezeVector([0.2133229, 0.0342439, 0.196514]) }),
  revolver: Object.freeze({ right: freezeVector([0.9541063, 0.2554004, 0.6262864]), left: freezeVector([0.1172173, 0.3714139, 0.2664757]) }),
  shotgun: Object.freeze({ right: freezeVector([0.9838102, 0.008681, 0.6123869]), left: freezeVector([0.5053147, -0.1111789, 0.5806109]) }),
  smg: Object.freeze({ right: freezeVector([0.8239763, 0.1123676, 0.6222709]), left: freezeVector([0, -0.0861235, 0.4358352]) }),
  ar: Object.freeze({ right: freezeVector([1.0645575, -0.0863012, 0.5394529]), left: freezeVector([0.6752392, -0.1437014, 0.4733896]) }),
  sniper: Object.freeze({ right: freezeVector([0.9981773, -0.0170872, 0.6113932]), left: freezeVector([0.0003899, -0.0516445, 0.5978336]) }),
  launcher: Object.freeze({ right: freezeVector([0.61418, 0.2395738, 0.5804858]), left: freezeVector([0.6424551, -0.1440299, 0.6069866]) }),
});

const freezeDigitScales = (values) => Object.freeze(
  Object.fromEntries(Object.entries(values).map(([name, scales]) => [name, freezeVector(scales)])),
);
export const OPERATOR_FINGER_CONTACT = Object.freeze({
  generic: Object.freeze({
    right: freezeDigitScales({
      index: [1, 1, 1], middle: [0.255, 0.263, 0.55],
      ring: [0.165, 0.325, 0.322], pinky: [0.321, 0.322, 0.322],
    }),
    left: freezeDigitScales({
      index: [0.004, 0.455, 1.873], middle: [0.006, 0.177, 1.895],
      ring: [0.061, 0.141, 1.745], pinky: [0.194, 0.168, 1.8068331],
    }),
  }),
  pistol: Object.freeze({
    right: freezeDigitScales({
      index: [1, 1, 1], middle: [1.358, 1.46, 1.024],
      ring: [0.468, 0.465, 0.466], pinky: [0.319, 0.324, 0.323],
    }),
    left: freezeDigitScales({
      index: [1.184, 0.298, 0.539], middle: [0.809, 0.807, 0.8],
      ring: [1.003, 1, 1], pinky: [1.558, 0.255, 1.167],
    }),
  }),
  shotgun: Object.freeze({
    right: freezeDigitScales({
      index: [1, 1, 1], middle: [0.792, 0.799, 0.801],
      ring: [0.664, 0.664, 0.667], pinky: [0.517, 0.521, 0.523],
    }),
    left: freezeDigitScales({
      index: [1.402, 1.354, 1.24], middle: [1.557, 1.166, 1.55],
      ring: [1.556, 0.993, 1.458], pinky: [1.532, 0.188, 1.55],
    }),
  }),
  smg: Object.freeze({
    right: freezeDigitScales({
      index: [0.528, 1, 1], middle: [0.585, 0.588, 0.592],
      ring: [0.441, 0.439, 0.439], pinky: [0.29, 0.291, 0.292],
    }),
    left: freezeDigitScales({
      index: [1.611, 1.136, 1.644], middle: [2.058, 0.857, 1.8],
      ring: [1.806, 0.678, 1.8], pinky: [1.4806981, 0.8373637, 0.602579],
    }),
  }),
  ar: Object.freeze({
    right: freezeDigitScales({
      index: [1, 1, 1], middle: [0.542, 0.547, 0.553],
      ring: [0.341, 0.346, 0.348], pinky: [0.316, 0.316, 0.315],
    }),
    left: freezeDigitScales({
      index: [1.876, 0.794, 1.875], middle: [1.837, 1.193, 0.988],
      ring: [1.856, 0.606, 1.85], pinky: [1.4806981, 0.8373637, 0.602579],
    }),
  }),
  sniper: Object.freeze({
    right: freezeDigitScales({
      index: [1, 1, 1], middle: [0.516, 0.522, 0.527],
      ring: [0.295, 0.296, 0.302], pinky: [0.444, 0.447, 0.449],
    }),
    left: freezeDigitScales({
      index: [1.753, 0.899, 1.75], middle: [1.854, 1.034, 1.534],
      ring: [1.823, 0.677, 1.85], pinky: [1.4806981, 0.8373637, 0.602579],
    }),
  }),
  revolver: Object.freeze({
    right: freezeDigitScales({
      index: [1, 1, 1], middle: [1.422, 1.379, 1.198],
      ring: [0.589, 0.588, 0.59], pinky: [0.869, 0.873, 0.88],
    }),
    left: freezeDigitScales({
      index: [0.707, 0.706, 0.707], middle: [1.486, 0.892, 1],
      ring: [1.401, 1.212, 1.388], pinky: [1.5641688, 0.8772734, 0.6268799],
    }),
  }),
  launcher: Object.freeze({
    right: freezeDigitScales({
      index: [0.45, 0.45, 0.45], middle: [0.51, 0.513, 0.516],
      ring: [0.394, 0.397, 0.394], pinky: [0.318, 0.317, 0.318],
    }),
    left: freezeDigitScales({
      index: [1.756, 0.898, 1.8], middle: [1.857, 0.969, 1.847],
      ring: [1.783, 0.76, 1.825], pinky: [1.4806981, 0.8373637, 0.602579],
    }),
  }),
});

export const OPERATOR_PREVIEW_STANCE = Object.freeze({
  pistol: Object.freeze({ yaw: 0.1, z: -0.68, poleX: 1.5, poleZ: -0.75 }),
  revolver: Object.freeze({ yaw: 0.05, z: -0.72, poleX: 1.5, poleZ: -0.5 }),
  shotgun: Object.freeze({ yaw: 0.575, z: -0.55, poleX: 1.5, poleZ: -0.9 }),
  smg: Object.freeze({ yaw: 0.4, z: -0.6, poleX: 1.5, poleZ: -0.9 }),
  ar: Object.freeze({ yaw: 0.55, z: -0.54, poleX: 1.5, poleZ: -0.9 }),
  sniper: Object.freeze({ yaw: 0.65, z: -0.54, poleX: 1.5, poleZ: -0.9 }),
  launcher: Object.freeze({ yaw: 0.45, z: -0.62, poleX: 1.5, poleZ: -0.9 }),
});

const OPERATOR_FINGER_ROOT_OFFSET = Object.freeze({
  generic: Object.freeze({
    right: Object.freeze({
      middle: freezeVector([0.00001, -0.001, 0.00098]),
      ring: freezeVector([-0.00004, -0.0011, 0.00107]),
    }),
  }),
  pistol: Object.freeze({
    right: Object.freeze({ middle: freezeVector([-0.00006, 0, -0.00002]) }),
  }),
  shotgun: Object.freeze({
    left: Object.freeze({ middle: freezeVector([-0.0005, 0.0057, -0.0067]) }),
  }),
  smg: Object.freeze({
    left: Object.freeze({
      index: freezeVector([-0.0001, 0, -0.0002]),
      pinky: freezeVector([-0.0006937, 0.0086953, -0.0101481]),
    }),
  }),
  ar: Object.freeze({
    left: Object.freeze({ pinky: freezeVector([-0.0006937, 0.0086953, -0.0101481]) }),
  }),
  sniper: Object.freeze({
    left: Object.freeze({
      ring: freezeVector([-0.0001, -0.0001, -0.0001]),
      pinky: freezeVector([-0.0006937, 0.0086953, -0.0101481]),
    }),
  }),
  revolver: Object.freeze({
    left: Object.freeze({
      index: freezeVector([-0.0036, 0.0003, -0.013]),
      pinky: freezeVector([-0.0026937, 0.0086953, -0.0101481]),
    }),
  }),
  launcher: Object.freeze({
    right: Object.freeze({ index: freezeVector([0, -0.0015, 0]) }),
    left: Object.freeze({
      index: freezeVector([-0.0001, -0.0001, -0.0001]),
      middle: freezeVector([-0.0023, 0.0051, -0.0057]),
      pinky: freezeVector([-0.0006937, 0.0086953, -0.0101481]),
    }),
  }),
});

const OPERATOR_THUMB_ROOT_OFFSET = Object.freeze({
  generic: Object.freeze({
    right: freezeVector([0.0016194, 0.0000193, -0.0011676]),
    left: freezeVector([-0.0021089, -0.0017674, -0.0048997]),
  }),
  pistol: Object.freeze({
    right: freezeVector([0.0003379, -0.0001501, 0.000138]),
    left: freezeVector([-0.000057, -0.0143091, -0.0028926]),
  }),
  revolver: Object.freeze({
    right: freezeVector([-0.0000547, -0.0000062, 0.0002476]),
    left: freezeVector([0.009839, -0.0148393, -0.0025556]),
  }),
  shotgun: Object.freeze({
    right: freezeVector([0.0005772, 0.0000122, 0.0001625]),
    left: freezeVector([-0.0021235, 0.0006456, -0.0002149]),
  }),
  smg: Object.freeze({
    right: freezeVector([0.0014001, -0.0005389, -0.0003449]),
    left: freezeVector([-0.000053, -0.0000066, 0.0000133]),
  }),
  ar: Object.freeze({
    right: freezeVector([0.0010507, -0.0000517, -0.0008297]),
    left: freezeVector([-0.0001735, -0.0001064, -0.0000611]),
  }),
  sniper: Object.freeze({
    right: freezeVector([0.0016748, 0.0000443, 0.0000804]),
    left: freezeVector([-0.0000357, -0.0000049, 0.0000024]),
  }),
  launcher: Object.freeze({
    right: freezeVector([0.0009924, 0.0000473, 0.0007012]),
    left: freezeVector([-0.0001859, -0.0000306, -0.000064]),
  }),
});

// El modelo se construye mirando hacia -Z, igual que la camara/jugadores.
// La IA de bots conserva por compatibilidad un yaw cuyo frente es +Z. El
// desfase vive en un pivote visual interno para que `group.rotation.y` siga
// siendo el yaw logico usado por red, impactos y backstabs.
export function humanoidFacingOffset(kind = 'pl') {
  return kind === 'bot' ? Math.PI : 0;
}

export function setHumanoidFacingConvention(rig, kind = 'pl') {
  if (!rig?.visualRoot) return false;
  rig.visualRoot.rotation.y = humanoidFacingOffset(kind);
  return true;
}

export function makeNameSprite(name, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.font = "italic 900 26px 'Arial Black', Arial";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(name, 128, 24);
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 24);
  const tex = new THREE.CanvasTexture(canvas);
  // depthTest activado: las paredes ocultan el nombre (nada de wallhack)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  sprite.scale.set(1.9, 0.36, 1);
  return sprite;
}

// sombreros comprables, construidos con cajas sobre la cabeza
export function makeHat(type) {
  if (!type || type === 'none') return null;
  const g = new THREE.Group();
  const add = (color, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(operatorBoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  if (type === 'cap') {
    add(0x2e6fd8, 0.46, 0.14, 0.46, 0, 0.07, 0);
    add(0x2e6fd8, 0.4, 0.05, 0.24, 0, 0.02, -0.32); // visera
  } else if (type === 'top') {
    add(0x1a1a1e, 0.52, 0.06, 0.52, 0, 0.03, 0);    // ala
    add(0x1a1a1e, 0.34, 0.42, 0.34, 0, 0.26, 0);    // copa
    add(0xd83a2e, 0.36, 0.07, 0.36, 0, 0.1, 0);     // cinta
  } else if (type === 'crown') {
    add(0xf2c94c, 0.44, 0.14, 0.44, 0, 0.07, 0);
    for (const [px, pz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16], [0, 0]]) {
      add(0xf2c94c, 0.08, 0.16, 0.08, px, 0.2, pz);
    }
  }
  return g;
}

// Devuelve el rig completo. `userData` se asigna a cada malla golpeable
// para que el raycast de las armas identifique a quién y dónde ha dado.
export function makeHumanoid(color, name, userDataFor, nameColor, hat) {
  const accentColor = new THREE.Color(color);
  accentColor.offsetHSL(0, 0.04, 0.18);
  const uniform = new THREE.MeshLambertMaterial({ color });
  const uniformDark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.48) });
  const uniformMid = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.72) });
  const uniformAccent = new THREE.MeshLambertMaterial({ color: accentColor });
  const armor = new THREE.MeshLambertMaterial({ color: 0x202a35 });
  const armorEdge = new THREE.MeshLambertMaterial({ color: 0x3f5365 });
  const skinTone = new THREE.MeshLambertMaterial({ color: 0xe0aa7a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x202a34 });
  const boot = new THREE.MeshLambertMaterial({ color: 0x111821 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x1b242d, roughness: 0.94, metalness: 0.01 });
  const glovePanel = new THREE.MeshStandardMaterial({ color: 0x394957, roughness: 0.8, metalness: 0.015 });
  const gloveGrip = new THREE.MeshStandardMaterial({ color: 0x0e141a, roughness: 1, metalness: 0 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x11161d });
  const visor = new THREE.MeshLambertMaterial({ color: 0x152b3a });
  const statusLight = new THREE.MeshBasicMaterial({ color: accentColor });
  // Se conserva el volumen de daño histórico sin dibujarlo. La anatomía nueva
  // es puramente visual y no añade superficies vulnerables al raycast.
  const armHitboxMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x292e36 });
  const gunAccent = new THREE.MeshLambertMaterial({ color: 0x59636d });
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.9 });

  const group = new THREE.Group();
  const visualRoot = new THREE.Group();
  visualRoot.name = 'visualRoot';
  group.add(visualRoot);
  const torso = new THREE.Group();
  visualRoot.add(torso);
  const parts = [];
  const profile = humanoidModelProfile();
  const armorGroup = new THREE.Group();
  const headgear = new THREE.Group();
  const equipment = new THREE.Group();
  const headPivot = new THREE.Group();
  armorGroup.name = 'armor';
  headgear.name = 'headgear';
  equipment.name = 'equipment';
  headPivot.name = 'headPivot';
  headPivot.position.set(0, 1.66, 0);
  headPivot.add(headgear);
  torso.add(armorGroup, equipment, headPivot);

  const add = (geometry, material, x, y, z, partName, parent = group) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    if (partName) {
      m.userData = userDataFor(partName);
      parts.push(m);
    }
    parent.add(m);
    return m;
  };

  const box = (w, h, d, mat, x, y, z, partName, parent) => add(
    operatorBoxGeometry(w, h, d), mat, x, y, z, partName, parent,
  );
  const sphere = (radius, mat, x, y, z, partName, parent) => add(
    new THREE.SphereGeometry(radius, 12, 8), mat, x, y, z, partName, parent,
  );

  const legL = new THREE.Group(); legL.position.set(-0.15, 0.8, 0);
  const legR = new THREE.Group(); legR.position.set(0.15, 0.8, 0);
  legL.name = 'legL';
  legR.name = 'legR';
  visualRoot.add(legL, legR);
  box(...profile.leg, pants, 0, -0.4, 0, 'leg', legL);
  box(...profile.leg, pants, 0, -0.4, 0, 'leg', legR);
  box(0.22, 0.12, 0.38, boot, 0, -0.82, -0.08, 'leg', legL);
  box(0.22, 0.12, 0.38, boot, 0, -0.82, -0.08, 'leg', legR);
  box(0.27, 0.08, 0.46, metal, 0, -0.78, -0.12, null, legL);
  box(0.27, 0.08, 0.46, metal, 0, -0.78, -0.12, null, legR);
  box(0.2, 0.12, 0.05, armorEdge, 0, -0.22, -0.14, null, legL);
  box(0.2, 0.12, 0.05, armorEdge, 0, -0.22, -0.14, null, legR);

  const body = new THREE.Group();
  body.name = 'body';
  torso.add(body);
  box(...profile.body, uniform, 0, 1.11, 0, 'body', body);
  box(0.48, 0.08, 0.36, uniformDark, 0, 0.8, 0, null, body);

  // Chaleco, placas y bolsillos: son decoración y no crean nuevos hitboxes.
  box(...profile.vest, armor, 0, 1.11, 0, null, armorGroup);
  box(0.43, 0.32, 0.045, armorEdge, 0, 1.2, -0.24, null, armorGroup);
  box(0.07, 0.31, 0.05, metal, -0.2, 1.2, -0.27, null, armorGroup);
  box(0.07, 0.31, 0.05, metal, 0.2, 1.2, -0.27, null, armorGroup);
  box(0.15, 0.13, 0.07, armorEdge, -0.24, 0.94, -0.25, null, armorGroup);
  box(0.15, 0.13, 0.07, armorEdge, 0.24, 0.94, -0.25, null, armorGroup);
  for (const x of [-0.16, 0, 0.16]) {
    box(0.12, 0.19, 0.07, armorEdge, x, 0.98, -0.28, null, armorGroup);
    box(0.07, 0.035, 0.018, uniformAccent, x, 1.03, -0.325, null, armorGroup);
  }
  box(0.7, 0.08, 0.44, uniformDark, 0, 0.82, 0, null, armorGroup);
  box(0.13, 0.07, 0.04, uniformAccent, 0, 0.82, -0.24, null, armorGroup);
  box(0.2, 0.07, 0.025, statusLight, -0.1, 1.36, -0.265, null, armorGroup);
  box(0.08, 0.1, 0.08, armorEdge, -0.38, 1.3, 0, null, armorGroup);
  box(0.08, 0.1, 0.08, armorEdge, 0.38, 1.3, 0, null, armorGroup);

  // Mochila, correas y radio para dar una silueta reconocible desde atrás.
  box(...profile.backpack, armor, 0, 1.12, 0.29, null, equipment);
  box(0.09, 0.58, 0.05, armorEdge, -0.2, 1.12, 0.23, null, equipment);
  box(0.09, 0.58, 0.05, armorEdge, 0.2, 1.12, 0.23, null, equipment);
  box(0.14, 0.2, 0.08, metal, 0.28, 1.35, 0.04, null, equipment);
  box(0.04, 0.28, 0.04, armorEdge, 0.28, 1.58, 0.04, null, equipment);
  box(0.18, 0.34, 0.16, armor, 0.39, 0.75, 0.04, null, equipment);
  box(0.2, 0.06, 0.18, armorEdge, 0.39, 0.9, 0.04, null, equipment);

  const head = box(0.42, 0.42, 0.42, skinTone, 0, 0, 0, 'head', headPivot);
  const faceVisor = box(0.28, 0.08, 0.04, visor, 0, 0.1, -0.22, null, headgear);
  faceVisor.castShadow = false;
  box(...profile.helmet, armor, 0, 0.25, 0, null, headgear);
  box(0.56, 0.08, 0.5, armorEdge, 0, 0.16, 0, null, headgear);
  box(0.07, 0.06, 0.34, uniformAccent, 0, 0.31, 0, null, headgear);
  box(0.08, 0.2, 0.12, metal, -0.27, 0.2, 0, null, headgear);
  box(0.08, 0.2, 0.12, metal, 0.27, 0.2, 0, null, headgear);
  box(0.07, 0.12, 0.06, armorEdge, -0.32, -0.03, -0.03, null, headgear);
  box(0.07, 0.12, 0.06, armorEdge, 0.32, -0.03, -0.03, null, headgear);
  box(0.04, 0.04, 0.32, metal, 0.25, -0.02, -0.14, null, headgear).rotation.x = 0.35;
  box(0.08, 0.07, 0.06, statusLight, 0.25, -0.07, -0.29, null, headgear);

  const armL = new THREE.Group(); armL.position.set(-0.4, 1.34, 0);
  const armR = new THREE.Group(); armR.position.set(0.4, 1.34, 0);
  armL.name = 'armL';
  armR.name = 'armR';
  torso.add(armL, armR);
  const forearmL = new THREE.Group(); forearmL.position.set(0, -OPERATOR_ARM_PROFILE.upperLength, 0);
  const forearmR = new THREE.Group(); forearmR.position.set(0, -OPERATOR_ARM_PROFILE.upperLength, 0);
  forearmL.name = 'forearmL';
  forearmR.name = 'forearmR';
  armL.add(forearmL);
  armR.add(forearmR);
  const armHitboxGeometry = operatorBoxGeometry(...profile.limb);
  const upperArmGeometry = operatorLimbGeometry(
    OPERATOR_ARM_PROFILE.upper[0], OPERATOR_ARM_PROFILE.upperLength,
    OPERATOR_ARM_PROFILE.upper[2], { top: 0.49, bottom: 0.39 },
  );
  const forearmGeometry = operatorLimbGeometry(
    OPERATOR_ARM_PROFILE.forearm[0], OPERATOR_ARM_PROFILE.forearmLength,
    OPERATOR_ARM_PROFILE.forearm[2], { top: 0.5, bottom: 0.37 },
  );
  const shoulderGeometry = operatorBoxGeometry(...OPERATOR_ARM_PROFILE.shoulder);
  const elbowGeometry = operatorBoxGeometry(...OPERATOR_ARM_PROFILE.elbow);
  const forearmShellGeometry = operatorBoxGeometry(0.16, 0.17, 0.055);
  const forearmCuffGeometry = operatorBoxGeometry(...OPERATOR_ARM_PROFILE.cuff);

  const upperArmHitL = add(armHitboxGeometry, armHitboxMaterial, 0, -0.26, 0, 'arm', armL);
  const upperArmHitR = add(armHitboxGeometry, armHitboxMaterial, 0, -0.26, 0, 'arm', armR);
  upperArmHitL.name = 'upperArmL';
  upperArmHitR.name = 'upperArmR';
  upperArmHitL.castShadow = false; upperArmHitL.receiveShadow = false;
  upperArmHitR.castShadow = false; upperArmHitR.receiveShadow = false;
  const upperArmVisualL = add(
    upperArmGeometry, uniformMid,
    0, -OPERATOR_ARM_PROFILE.upperLength / 2, 0, null, armL,
  );
  const upperArmVisualR = add(
    upperArmGeometry, uniformMid,
    0, -OPERATOR_ARM_PROFILE.upperLength / 2, 0, null, armR,
  );
  upperArmVisualL.name = 'upper-arm-visual-L';
  upperArmVisualR.name = 'upper-arm-visual-R';

  const buildOperatorArmDetails = (side, arm, forearm, upperArm) => {
    // La hombrera pertenece al torso: si rota con el IK abre un hueco negro al
    // levantar el arma. El brazo nace debajo y queda cubierto por este socket.
    const shoulder = add(
      shoulderGeometry, armor,
      arm.position.x, arm.position.y - 0.035, arm.position.z, null, torso,
    );
    shoulder.name = `shoulder-${side}`;

    const forearmBase = add(
      forearmGeometry, uniformMid,
      0, -OPERATOR_ARM_PROFILE.forearmLength / 2, 0, null, forearm,
    );
    forearmBase.name = `forearm-${side}`;
    const elbow = add(elbowGeometry, uniformDark, 0, -0.018, 0, null, forearm);
    elbow.name = `elbow-${side}`;
    const shell = add(forearmShellGeometry, armorEdge, 0, -0.108, -0.094, null, forearm);
    shell.name = `forearm-shell-${side}`;
    const cuff = add(
      forearmCuffGeometry, glovePanel,
      0, -(OPERATOR_ARM_PROFILE.forearmLength - OPERATOR_ARM_PROFILE.cuff[1] / 2), 0,
      null, forearm,
    );
    cuff.name = `forearm-cuff-${side}`;
    arm.userData.anatomy = {
      upperArm, shoulder,
      forearm: forearmBase, elbow, shell, cuff,
    };
  };

  buildOperatorArmDetails('L', armL, forearmL, upperArmVisualL);
  buildOperatorArmDetails('R', armR, forearmR, upperArmVisualR);

  const fingerGeometry = new THREE.CylinderGeometry(0.0125, 0.016, 1, 8, 1);
  const thumbGeometry = new THREE.CylinderGeometry(0.015, 0.019, 1, 8, 1);
  const wristGeometry = new THREE.CylinderGeometry(0.076, 0.081, OPERATOR_HAND_PROFILE.wrist[1], 10, 1);
  const fingerNames = ['index', 'middle', 'ring', 'pinky'];
  const fingerSlots = [0.061, 0.021, -0.022, -0.06];
  const fingerSplay = [0.055, 0.018, -0.012, -0.06];

  const makeOperatorHand = (side, parent) => {
    const direction = side === 'L' ? -1 : 1;
    const hand = new THREE.Group();
    hand.name = `hand${side}`;
    hand.position.set(0, -0.3, -0.02);
    parent.add(hand);

    const palm = box(...OPERATOR_HAND_PROFILE.palm, glove, 0, 0, 0, null, hand);
    palm.name = `hand${side}-palm`;
    // Placa dorsal: el espesor va sobre Z (normal de la palma), no sobre Y.
    // Un pequeño solape oculta z-fighting sin convertirla en un bloque interno.
    const palmPanel = box(0.145, 0.116, 0.025, glovePanel, 0, 0.002, 0.0955, null, hand);
    palmPanel.name = `hand${side}-palm-panel`;

    const wrist = add(wristGeometry, glovePanel, 0, 0.097, 0.006, null, hand);
    wrist.name = `hand${side}-wrist`;
    wrist.scale.z = OPERATOR_HAND_PROFILE.wrist[2] / OPERATOR_HAND_PROFILE.wrist[0];

    const fingers = {};
    for (let index = 0; index < fingerNames.length; index++) {
      const fingerName = fingerNames[index];
      const totalLength = OPERATOR_HAND_PROFILE.fingerLengths[index];
      const proximalLength = totalLength * 0.43;
      const intermediateLength = totalLength * 0.32;
      const distalLength = totalLength - proximalLength - intermediateLength;
      const root = new THREE.Group();
      root.name = `hand${side}-${fingerName}`;
      root.position.set(direction * fingerSlots[index], -0.058, -0.058);
      root.userData.basePosition = root.position.clone();
      root.rotation.x = OPERATOR_HAND_PROFILE.fingerCurls[index];
      root.rotation.z = direction * fingerSplay[index];

      const proximal = new THREE.Mesh(fingerGeometry, glove);
      proximal.name = `hand${side}-${fingerName}-proximal`;
      proximal.position.y = -proximalLength / 2;
      proximal.scale.y = proximalLength;
      proximal.castShadow = false;
      root.add(proximal);

      const intermediateJoint = new THREE.Group();
      intermediateJoint.name = `hand${side}-${fingerName}-intermediate-joint`;
      intermediateJoint.position.y = -proximalLength;
      intermediateJoint.rotation.x = OPERATOR_HAND_PROFILE.middleCurls[index];
      const intermediate = new THREE.Mesh(fingerGeometry, glove);
      intermediate.name = `hand${side}-${fingerName}-intermediate`;
      intermediate.position.y = -intermediateLength / 2;
      intermediate.scale.set(0.94, intermediateLength, 0.94);
      intermediate.castShadow = false;
      intermediateJoint.add(intermediate);

      const distalJoint = new THREE.Group();
      distalJoint.name = `hand${side}-${fingerName}-distal-joint`;
      distalJoint.position.y = -intermediateLength;
      distalJoint.rotation.x = OPERATOR_HAND_PROFILE.distalCurls[index];
      const distal = new THREE.Mesh(fingerGeometry, gloveGrip);
      distal.name = `hand${side}-${fingerName}-distal`;
      distal.position.y = -distalLength / 2;
      distal.scale.set(0.92, distalLength, 0.92);
      distal.castShadow = false;
      distalJoint.add(distal);
      intermediateJoint.add(distalJoint);
      root.add(intermediateJoint);
      hand.add(root);
      fingers[fingerName] = {
        root, proximal, intermediateJoint, intermediate, distalJoint, distal, totalLength,
      };
    }

    const thumbLength = OPERATOR_HAND_PROFILE.thumbLength;
    const thumbProximalLength = thumbLength * 0.58;
    const thumbDistalLength = thumbLength - thumbProximalLength;
    const thumb = new THREE.Group();
    thumb.name = `hand${side}-thumb`;
    thumb.position.set(direction * 0.088, -0.005, -0.035);
    thumb.userData.basePosition = thumb.position.clone();
    thumb.rotation.set(0.5, 0, direction * 0.82);
    const thumbProximal = new THREE.Mesh(thumbGeometry, glove);
    thumbProximal.name = `hand${side}-thumb-proximal`;
    thumbProximal.position.y = -thumbProximalLength / 2;
    thumbProximal.scale.y = thumbProximalLength;
    thumbProximal.castShadow = false;
    thumb.add(thumbProximal);
    const thumbDistalJoint = new THREE.Group();
    thumbDistalJoint.position.y = -thumbProximalLength;
    thumbDistalJoint.rotation.x = 0.72;
    const thumbDistal = new THREE.Mesh(thumbGeometry, gloveGrip);
    thumbDistal.name = `hand${side}-thumb-distal`;
    thumbDistal.position.y = -thumbDistalLength / 2;
    thumbDistal.scale.set(0.92, thumbDistalLength, 0.92);
    thumbDistal.castShadow = false;
    thumbDistalJoint.add(thumbDistal);
    thumb.add(thumbDistalJoint);
    hand.add(thumb);

    hand.userData.anatomy = {
      palm,
      palmPanel,
      wrist,
      fingers,
      thumb: {
        root: thumb, proximal: thumbProximal,
        distalJoint: thumbDistalJoint, distal: thumbDistal,
      },
    };
    hand.userData.side = side;
    return hand;
  };

  const handL = makeOperatorHand('L', forearmL);
  const handR = makeOperatorHand('R', forearmR);

  const applyOperatorHandPose = (hand, pose, kind = 'ar') => {
    const direction = hand.userData.side === 'L' ? -1 : 1;
    const sideName = hand.userData.side === 'L' ? 'left' : 'right';
    const contactProfile = OPERATOR_FINGER_CONTACT[kind] || OPERATOR_FINGER_CONTACT.generic;
    const fingerScales = contactProfile[sideName];
    const fingerOffsets = OPERATOR_FINGER_ROOT_OFFSET[kind]?.[sideName];
    hand.userData.role = pose.role;
    for (const fingerName of fingerNames) {
      const finger = hand.userData.anatomy.fingers[fingerName];
      const digit = pose.fingers[fingerName];
      const contactScale = fingerScales[fingerName] ?? [1, 1, 1];
      finger.root.position.copy(finger.root.userData.basePosition);
      const rootOffset = fingerOffsets?.[fingerName];
      if (rootOffset) finger.root.position.add(new THREE.Vector3(...rootOffset));
      finger.root.rotation.set(
        (0.08 + digit.curl[0] * 1.15) * (contactScale[0] ?? 1),
        (digit.twist || 0) * 0.32,
        direction * (digit.splay || 0) * 0.82,
      );
      finger.intermediateJoint.rotation.x = (0.08 + digit.curl[1] * 1.35)
        * (contactScale[1] ?? 1);
      finger.distalJoint.rotation.x = (0.04 + digit.curl[2] * 1.18)
        * (contactScale[2] ?? 1);
      finger.root.userData.contact = digit.contact;
    }
    const thumb = hand.userData.anatomy.thumb;
    thumb.root.rotation.set(
      0.28 + pose.thumb.curl[0] * 0.58,
      direction * ((pose.thumb.twist || 0) * 0.28),
      // El pulgar nace junto al indice y cruza casi recto sobre la empunadura.
      // Una apertura lateral grande lo orientaba fuera del arma.
      direction * (0.08 + pose.thumb.curl[0] * 0.08 + (pose.thumb.splay || 0) * 0.08),
    );
    thumb.distalJoint.rotation.x = 0.12 + pose.thumb.curl[1] * 0.92;
    thumb.root.userData.contact = pose.thumb.contact;
  };

  const applyOperatorThumbContact = (hand, kind) => {
    const profile = OPERATOR_THUMB_CONTACT[kind] || OPERATOR_THUMB_CONTACT.generic;
    const contact = hand === handR ? profile.right : profile.left;
    const thumb = hand.userData.anatomy.thumb;
    const side = hand === handR ? 'right' : 'left';
    thumb.root.position.copy(thumb.root.userData.basePosition);
    const rootOffset = OPERATOR_THUMB_ROOT_OFFSET[kind]?.[side];
    if (rootOffset) thumb.root.position.add(new THREE.Vector3(...rootOffset));
    thumb.root.rotation.x = contact[0];
    thumb.root.rotation.z = contact[1];
    thumb.distalJoint.rotation.x = contact[2] ?? thumb.distalJoint.rotation.x;
  };

  const defaultHandPose = handGripState({ kind: 'ar' });
  applyOperatorHandPose(handL, defaultHandPose.left, 'generic');
  applyOperatorHandPose(handR, defaultHandPose.right, 'generic');
  applyOperatorThumbContact(handL, 'generic');
  applyOperatorThumbContact(handR, 'generic');

  const gun = new THREE.Group();
  gun.name = 'gun';
  gun.position.set(0, 1.16, -0.12);
  gun.rotation.x = -0.32;
  box(0.14, 0.16, 0.55, gunMat, 0, 0.04, -0.24, null, gun);
  box(0.12, 0.14, 0.24, metal, 0, 0.04, 0.13, null, gun);
  box(0.09, 0.1, 0.38, gunAccent, 0, 0.04, -0.67, null, gun);
  const gunGrip = box(0.105, 0.24, 0.12, metal, 0, -0.12, 0, null, gun);
  gunGrip.name = 'operator-gun-primary-grip';
  box(0.06, 0.06, 0.12, gunAccent, 0, 0.14, -0.48, null, gun);
  box(0.12, 0.06, 0.08, metal, 0, 0.08, -0.9, null, gun);
  const gunHandguard = box(0.13, 0.13, 0.34, armorEdge, 0, 0, -0.38, null, gun);
  gunHandguard.name = 'operator-gun-support-grip';
  box(0.035, 0.05, 0.32, metal, 0, 0.04, -1.02, null, gun);
  const muzzleFlash = add(
    new THREE.ConeGeometry(0.09, 0.28, 6), flashMaterial,
    0, 0.04, -1.23, null, gun,
  );
  muzzleFlash.name = 'muzzleFlash';
  muzzleFlash.rotation.x = -Math.PI / 2;
  muzzleFlash.visible = false;
  muzzleFlash.castShadow = false;
  muzzleFlash.receiveShadow = false;

  // Objetivos comunes arma/manos. Las palmas permanecen tangentes a las dos
  // superficies de agarre mientras los brazos resuelven el alcance desde los
  // hombros; así apuntar no rota el arma a través de los guantes.
  const rightGripTarget = new THREE.Object3D();
  rightGripTarget.name = 'operator-right-hand-target';
  rightGripTarget.position.set(0, -0.11, 0.152);
  const leftGripTarget = new THREE.Object3D();
  leftGripTarget.name = 'operator-left-hand-target';
  leftGripTarget.position.set(0, -0.157, -0.38);
  leftGripTarget.rotation.x = Math.PI / 2;
  gun.add(rightGripTarget, leftGripTarget);
  torso.add(gun);

  const armDown = new THREE.Vector3(0, -1, 0);
  const upperLength = OPERATOR_ARM_PROFILE.upperLength;
  const forearmWrist = new THREE.Vector3(0, -OPERATOR_ARM_PROFILE.forearmLength, 0);
  const handWrist = new THREE.Vector3(0, 0.097, 0.006);
  const gunMatrix = new THREE.Matrix4();
  const targetMatrix = new THREE.Matrix4();
  const desiredHandMatrix = new THREE.Matrix4();
  const parentMatrix = new THREE.Matrix4();
  const localHandMatrix = new THREE.Matrix4();
  const inverseArm = new THREE.Quaternion();
  const shoulder = new THREE.Vector3();
  const wrist = new THREE.Vector3();
  const reach = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const upperDirection = new THREE.Vector3();
  const lowerDirection = new THREE.Vector3();
  const localLowerDirection = new THREE.Vector3();
  const poleDirection = new THREE.Vector3();
  const unitForearmWrist = forearmWrist.clone().normalize();
  const lowerLength = forearmWrist.length();
  const handScale = new THREE.Vector3();
  let operatorPoleX = 1;
  let operatorPoleZ = 0.55;
  const operatorGripBindings = [
    [-1, armL, forearmL, handL, leftGripTarget],
    [1, armR, forearmR, handR, rightGripTarget],
  ];

  const syncOperatorGrip = () => {
    gun.updateMatrix();
    gunMatrix.copy(gun.matrix);
    for (const [side, arm, forearm, hand, target] of operatorGripBindings) {
      target.updateMatrix();
      targetMatrix.copy(target.matrix);
      desiredHandMatrix.multiplyMatrices(gunMatrix, targetMatrix);
      wrist.copy(handWrist).applyMatrix4(desiredHandMatrix);
      shoulder.copy(arm.position);
      reach.subVectors(wrist, shoulder);
      const distance = Math.max(0.001, reach.length());
      reach.multiplyScalar(1 / distance);
      const safeDistance = Math.min(
        upperLength + lowerLength - 0.001,
        Math.max(Math.abs(upperLength - lowerLength) + 0.001, distance),
      );
      const along = (upperLength ** 2 - lowerLength ** 2 + safeDistance ** 2) / (2 * safeDistance);
      const bend = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
      poleDirection.set(side * operatorPoleX, -0.18, operatorPoleZ);
      poleDirection.addScaledVector(reach, -poleDirection.dot(reach));
      if (poleDirection.lengthSq() < 0.0001) poleDirection.set(side, 0, 0.5);
      poleDirection.normalize();
      elbow.copy(shoulder).addScaledVector(reach, along).addScaledVector(poleDirection, bend);

      upperDirection.subVectors(elbow, shoulder).normalize();
      arm.quaternion.setFromUnitVectors(armDown, upperDirection);
      arm.updateMatrix();
      forearm.position.set(0, -upperLength, 0);
      lowerDirection.subVectors(wrist, elbow).normalize();
      inverseArm.copy(arm.quaternion).invert();
      localLowerDirection.copy(lowerDirection).applyQuaternion(inverseArm).normalize();
      forearm.quaternion.setFromUnitVectors(unitForearmWrist, localLowerDirection);
      forearm.updateMatrix();

      parentMatrix.multiplyMatrices(arm.matrix, forearm.matrix);
      localHandMatrix.copy(parentMatrix).invert().multiply(desiredHandMatrix);
      localHandMatrix.decompose(hand.position, hand.quaternion, handScale);
      hand.scale.set(1, 1, 1);
    }
  };

  const gripEuler = new THREE.Euler();
  const gripQuaternion = new THREE.Quaternion();
  const gripClearance = new THREE.Vector3();
  const operatorHandBasis = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(Math.PI / 2, 0, 0),
  );
  let operatorWeaponKind = 'generic';
  const setOperatorWeaponGrip = (kind, weaponScale = 1) => {
    const grip = handGripState({ kind });
    const scale = Number.isFinite(Number(weaponScale))
      ? Math.min(2, Math.max(0.5, Number(weaponScale)))
      : 1;
    for (const [target, hand, pose] of [
      [rightGripTarget, handR, grip.right],
      [leftGripTarget, handL, grip.left],
    ]) {
      gripEuler.fromArray(pose.rotation);
      gripQuaternion.setFromEuler(gripEuler);
      // La mano de primera persona modela los dedos sobre -Z; la del operador
      // los encadena sobre -Y. Esta base alinea ambos rigs sin duplicar perfiles.
      target.quaternion.copy(gripQuaternion).multiply(operatorHandBasis);
      target.position.fromArray(pose.position).multiplyScalar(scale);
      gripClearance.fromArray(
        hand === handR
          ? (OPERATOR_GRIP_CLEARANCE.right[grip.kind] || OPERATOR_GRIP_CLEARANCE.right.ar)
          : (OPERATOR_GRIP_CLEARANCE.left[grip.kind] || OPERATOR_GRIP_CLEARANCE.left.ar),
      ).applyQuaternion(target.quaternion);
      target.position.add(gripClearance);
      applyOperatorHandPose(hand, pose, grip.kind);
      applyOperatorThumbContact(hand, grip.kind);
    }
    operatorWeaponKind = grip.kind;
    syncOperatorGrip();
    return grip.kind;
  };
  const setOperatorPreviewStance = () => {
    const stance = OPERATOR_PREVIEW_STANCE[operatorWeaponKind] || OPERATOR_PREVIEW_STANCE.ar;
    operatorPoleX = stance.poleX;
    operatorPoleZ = stance.poleZ;
    gun.position.set(0, 1.16, stance.z);
    gun.rotation.set(-0.32, stance.yaw, 0);
    syncOperatorGrip();
    return stance;
  };
  syncOperatorGrip();

  const hatMesh = makeHat(hat);
  if (hatMesh) {
    hatMesh.position.set(0, 0.26, 0);
    headPivot.add(hatMesh);
  }

  const nameSprite = makeNameSprite(name, nameColor);
  nameSprite.position.set(0, hatMesh ? 2.55 : 2.35, 0);
  torso.add(nameSprite);

  return {
    group, visualRoot, parts, torso, body, legL, legR, armL, armR, forearmL, forearmR, handL, handR,
    head, headPivot, gun, gunGrip, gunHandguard, muzzleFlash, nameSprite,
    gripTargets: { left: leftGripTarget, right: rightGripTarget },
    syncOperatorGrip, setOperatorWeaponGrip, setOperatorPreviewStance,
    getOperatorWeaponGripKind: () => operatorWeaponKind,
    armor: armorGroup, headgear, equipment,
    motion: { hit: 0, hitSide: 1, recoil: 0 },
  };
}

const damp = (current, target, response) => current + (target - current) * response;

export function triggerHumanoidHit(rig, intensity = 1, side = 1) {
  if (!rig?.motion) return;
  rig.motion.hit = Math.max(rig.motion.hit, 0.35 + clamp01(intensity) * 0.65);
  rig.motion.hitSide = side < 0 ? -1 : 1;
}

export function triggerHumanoidShot(rig, intensity = 1) {
  if (!rig?.motion) return;
  rig.motion.recoil = Math.max(rig.motion.recoil, clamp01(intensity));
  if (rig.muzzleFlash) rig.muzzleFlash.visible = true;
}

// Caminar, correr, respirar, apuntar y reaccionar al combate comparten el
// mismo rig. La amortiguacion evita saltos visuales al recibir snapshots.
export function animateHumanoid(rig, dt, speed, walkTimeRef, aiming, aimPitch = 0) {
  const frame = Math.min(0.1, Math.max(0, Number(dt) || 0));
  const safeSpeed = Math.max(0, Number(speed) || 0);
  walkTimeRef.t = Number(walkTimeRef.t) || 0;
  walkTimeRef.idle = Number(walkTimeRef.idle) || walkTimeRef.t;
  walkTimeRef.t += frame * safeSpeed * 1.65;
  walkTimeRef.idle += frame;

  const motion = rig.motion || (rig.motion = { hit: 0, hitSide: 1, recoil: 0 });
  motion.hit = Math.max(0, motion.hit - frame * 4.2);
  motion.recoil = Math.max(0, motion.recoil - frame * 11.5);
  const pose = operatorMotionState({
    time: walkTimeRef.t,
    idleTime: walkTimeRef.idle,
    speed: safeSpeed,
    aiming,
    aimPitch,
    hit: motion.hit,
    hitSide: motion.hitSide,
    recoil: motion.recoil,
  });
  const response = 1 - Math.exp(-frame * (aiming ? 18 : 13));

  rig.legL.rotation.x = damp(rig.legL.rotation.x, pose.legL, response);
  rig.legR.rotation.x = damp(rig.legR.rotation.x, pose.legR, response);
  rig.armL.position.x = damp(rig.armL.position.x, aiming ? -0.36 : -0.4, response);
  rig.armR.position.x = damp(rig.armR.position.x, aiming ? 0.36 : 0.4, response);
  const safePitch = Math.min(1.15, Math.max(-1.15, Number(aimPitch) || 0));
  const gunTargetX = 0;
  const gunTargetY = aiming ? 1.32 : 1.16 - pose.sprint * 0.08;
  const gunTargetZ = aiming ? -0.25 : -0.12 + pose.sprint * 0.035;
  const gunTargetRotation = aiming
    ? -safePitch + motion.recoil * 0.08
    : -0.32 - pose.sprint * 0.16 + motion.recoil * 0.04;
  rig.gun.position.x = damp(rig.gun.position.x, gunTargetX, response);
  rig.gun.position.y = damp(rig.gun.position.y, gunTargetY, response);
  rig.gun.position.z = damp(rig.gun.position.z, gunTargetZ, response);
  rig.gun.rotation.x = damp(rig.gun.rotation.x, gunTargetRotation, response);
  rig.gun.rotation.y = damp(rig.gun.rotation.y, 0, response);
  rig.gun.rotation.z = damp(rig.gun.rotation.z, 0, response);
  rig.syncOperatorGrip?.();
  rig.torso.position.y = damp(rig.torso.position.y, pose.bodyY, response);
  rig.torso.rotation.x = damp(rig.torso.rotation.x, pose.torsoPitch, response);
  rig.torso.rotation.y = damp(rig.torso.rotation.y, pose.torsoYaw, response);
  rig.torso.rotation.z = damp(rig.torso.rotation.z, pose.torsoRoll, response);
  if (rig.headPivot) {
    rig.headPivot.rotation.x = damp(rig.headPivot.rotation.x, pose.headPitch, response);
    rig.headPivot.rotation.y = damp(rig.headPivot.rotation.y, pose.headYaw, response);
    rig.headPivot.rotation.z = damp(rig.headPivot.rotation.z, pose.headRoll, response);
  }
  if (rig.equipment) rig.equipment.rotation.z = damp(
    rig.equipment.rotation.z, pose.equipmentRoll, response,
  );
  if (rig.muzzleFlash) {
    rig.muzzleFlash.visible = motion.recoil > 0.12;
    rig.muzzleFlash.scale.setScalar(pose.muzzleScale);
    rig.muzzleFlash.rotation.z += frame * 18;
  }
}

export function animateHumanoidDeath(rig, progress, side = 1) {
  const pose = operatorDeathState(progress, side);
  // Sobrescribir los tres ejes evita heredar torsiones del ultimo frame de
  // apuntado. El arma cae con el cuerpo y el IK mantiene hombro, codo, muneca
  // y manos como una sola cadena durante toda la animacion.
  rig.group.rotation.set(pose.groupRotationX, rig.group.rotation.y, pose.groupRotationZ);
  rig.torso.rotation.set(pose.torsoRotationX, 0, pose.torsoRotationZ);
  rig.torso.position.y = pose.torsoY;
  rig.legL.rotation.set(pose.legL, 0, 0);
  rig.legR.rotation.set(pose.legR, 0, 0);
  rig.armL.position.x = -0.4;
  rig.armR.position.x = 0.4;
  rig.gun.position.set(pose.gunX, pose.gunY, pose.gunZ);
  rig.gun.rotation.set(pose.gunPitch, pose.gunYaw, pose.gunRoll);
  rig.syncOperatorGrip?.();
  if (rig.headPivot) rig.headPivot.rotation.set(0, 0, pose.headRoll);
  if (rig.equipment) rig.equipment.rotation.set(0, 0, pose.equipmentRoll);
  if (rig.muzzleFlash) rig.muzzleFlash.visible = false;
  if (rig.nameSprite?.material) rig.nameSprite.material.opacity = pose.nameOpacity;
  return pose;
}

export function resetHumanoidPose(rig) {
  if (!rig) return;
  rig.group.rotation.x = 0;
  rig.group.rotation.z = 0;
  rig.torso.position.y = 0;
  rig.torso.rotation.set(0, 0, 0);
  rig.legL.rotation.set(0, 0, 0);
  rig.legR.rotation.set(0, 0, 0);
  rig.armL.rotation.set(0, 0, 0);
  rig.armR.rotation.set(0, 0, 0);
  rig.armL.position.x = -0.4;
  rig.armR.position.x = 0.4;
  if (rig.headPivot) rig.headPivot.rotation.set(0, 0, 0);
  if (rig.equipment) rig.equipment.rotation.set(0, 0, 0);
  rig.gun.position.set(0, 1.16, -0.12);
  rig.gun.rotation.set(-0.32, 0, 0);
  rig.syncOperatorGrip?.();
  if (rig.muzzleFlash) rig.muzzleFlash.visible = false;
  if (rig.nameSprite?.material) {
    rig.nameSprite.material.opacity = 1;
    rig.nameSprite.visible = true;
  }
  rig.motion = { hit: 0, hitSide: 1, recoil: 0 };
}

export function disposeHumanoid(rig) {
  if (!rig?.group) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  rig.group.traverse((object) => {
    // Sprite usa una geometría singleton interna de Three.js compartida entre
    // todos los nombres. No pertenece al rig y disponerla invalida a los demás.
    if (object.geometry && !object.isSprite) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material);
      if (material.map) textures.add(material.map);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
