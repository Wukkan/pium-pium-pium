import * as THREE from 'three';
import { buildGunModel, WEAPON_DEFS, WEAPON_ORDER } from './weapons.js';

// Las miniaturas no mantienen una segunda representación del arsenal. Cada una
// nace del mismo constructor que usa WeaponSystem dentro de la partida.
export const WEAPON_PREVIEW_KINDS = Object.freeze([...WEAPON_ORDER]);

export const DEFAULT_WEAPON_PREVIEW_OPTIONS = Object.freeze({
  width: 320,
  height: 112,
  maxPixelRatio: 1.5,
  maxPixels: 280_000,
  maxDimension: 768,
  padding: 1.2,
  rotationX: 0,
  rotationY: 0,
  rotationZ: -0.035,
});

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizedKind(kind) {
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(WEAPON_DEFS, kind)) {
    throw new RangeError(`Arma desconocida para la vista previa: ${String(kind)}`);
  }
  return kind;
}

// Mantiene el presupuesto de píxeles estable incluso en pantallas HiDPI y en
// tarjetas que accidentalmente reciban dimensiones excesivas.
export function resolveWeaponPreviewSize({
  width = DEFAULT_WEAPON_PREVIEW_OPTIONS.width,
  height = DEFAULT_WEAPON_PREVIEW_OPTIONS.height,
  pixelRatio = 1,
  maxPixelRatio = DEFAULT_WEAPON_PREVIEW_OPTIONS.maxPixelRatio,
  maxPixels = DEFAULT_WEAPON_PREVIEW_OPTIONS.maxPixels,
  maxDimension = DEFAULT_WEAPON_PREVIEW_OPTIONS.maxDimension,
} = {}) {
  const cssWidth = finitePositive(width, DEFAULT_WEAPON_PREVIEW_OPTIONS.width);
  const cssHeight = finitePositive(height, DEFAULT_WEAPON_PREVIEW_OPTIONS.height);
  const ratioLimit = finitePositive(maxPixelRatio, DEFAULT_WEAPON_PREVIEW_OPTIONS.maxPixelRatio);
  const ratio = Math.min(ratioLimit, finitePositive(pixelRatio, 1));
  const pixelLimit = Math.max(1, Math.floor(finitePositive(maxPixels, DEFAULT_WEAPON_PREVIEW_OPTIONS.maxPixels)));
  const dimensionLimit = Math.max(1, Math.floor(finitePositive(maxDimension, DEFAULT_WEAPON_PREVIEW_OPTIONS.maxDimension)));
  const rawWidth = Math.max(1, Math.round(cssWidth * ratio));
  const rawHeight = Math.max(1, Math.round(cssHeight * ratio));
  const scale = Math.min(
    1,
    dimensionLimit / Math.max(rawWidth, rawHeight),
    Math.sqrt(pixelLimit / (rawWidth * rawHeight)),
  );
  const renderWidth = Math.max(1, Math.floor(rawWidth * scale));
  const renderHeight = Math.max(1, Math.floor(rawHeight * scale));
  return {
    cssWidth,
    cssHeight,
    width: renderWidth,
    height: renderHeight,
    aspect: renderWidth / renderHeight,
    pixelRatio: ratio * scale,
  };
}

// Devuelve parámetros ortográficos puros y testeables. Una cámara ortográfica
// evita deformar las proporciones del modelo cuando cambia el ancho de tarjeta.
export function weaponPreviewFrame(size, aspect = 1, padding = DEFAULT_WEAPON_PREVIEW_OPTIONS.padding) {
  const safeAspect = finitePositive(aspect, 1);
  const safePadding = Math.max(1, finitePositive(padding, DEFAULT_WEAPON_PREVIEW_OPTIONS.padding));
  const width = Math.max(0.001, finitePositive(size?.x, 0.001));
  const height = Math.max(0.001, finitePositive(size?.y, 0.001));
  const depth = Math.max(0.001, finitePositive(size?.z, 0.001));
  const halfHeight = Math.max(height / 2, width / (2 * safeAspect)) * safePadding;
  const halfWidth = halfHeight * safeAspect;
  const cameraZ = depth / 2 + Math.max(2, Math.max(width, height) * 0.75);
  return {
    left: -halfWidth,
    right: halfWidth,
    top: halfHeight,
    bottom: -halfHeight,
    near: 0.01,
    far: cameraZ + depth + 10,
    cameraZ,
  };
}

export function visibleObjectBounds(root) {
  if (!root?.isObject3D) throw new TypeError('Se requiere un Object3D para calcular la miniatura.');
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  const transformed = new THREE.Box3();
  root.traverseVisible((object) => {
    const geometry = object.geometry;
    if (!geometry?.attributes?.position) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
    transformed.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
    bounds.union(transformed);
  });
  if (bounds.isEmpty()) throw new Error('El modelo de arma no contiene geometría visible.');
  return bounds;
}

export function buildWeaponOnlyModel(kind, { modelFactory = buildGunModel } = {}) {
  const safeKind = normalizedKind(kind);
  const model = modelFactory(safeKind);
  if (!model?.isObject3D) throw new TypeError('buildGunModel debe devolver un Object3D de Three.js.');

  // Solo se separan los elementos ajenos al arma. Sus recursos son exclusivos
  // de este modelo recién construido, así que pueden liberarse sin afectar el
  // WeaponSystem ni otro preview. Las piezas y materiales del arma no se clonan
  // ni se reinterpretan.
  model.visible = true;
  const arms = model.userData?.viewmodel?.arms?.root;
  if (arms) disposeWeaponPreviewObject(arms);
  const flash = model.userData?.flash;
  if (flash) disposeWeaponPreviewObject(flash);
  const muzzleLight = model.userData?.muzzleLight;
  if (muzzleLight) {
    muzzleLight.visible = false;
    muzzleLight.intensity = 0;
    muzzleLight.removeFromParent();
  }
  if (model.userData.viewmodel) model.userData.viewmodel.arms = null;
  model.userData.flash = null;
  model.userData.muzzleLight = null;
  model.userData.weaponPreview = { kind: safeKind, source: 'buildGunModel' };
  return model;
}

// Nombre orientado a miniaturas conservado como API semántica; ambos caminos
// producen un modelo weapon-only fresco con ownership independiente.
export function createWeaponPreviewModel(kind, options) {
  return buildWeaponOnlyModel(kind, options);
}

function orientAndCenterModel(model, options) {
  const presentation = new THREE.Group();
  presentation.name = `weapon-preview-presentation-${options.kind}`;
  presentation.rotation.set(options.rotationX, options.rotationY, options.rotationZ);
  presentation.add(model);
  presentation.updateWorldMatrix(true, true);
  const center = visibleObjectBounds(presentation).getCenter(new THREE.Vector3());
  presentation.position.sub(center);
  presentation.updateWorldMatrix(true, true);
  return presentation;
}

function createPreviewScene(kind, options) {
  const model = createWeaponPreviewModel(kind, options);
  try {
    const presentation = orientAndCenterModel(model, { ...options, kind });
    const scene = new THREE.Scene();
    scene.add(presentation);

    // Luz equivalente al renderer principal: materiales originales, espacio de
    // color sRGB y ACES; no hay suelo ni decorado que altere la silueta.
    const hemisphere = new THREE.HemisphereLight(0xdceaff, 0x172238, 2.65);
    // La cámara mira desde +X: la luz principal se mantiene en ese mismo
    // hemisferio para que los materiales oscuros conserven detalle en tarjeta.
    const key = new THREE.DirectionalLight(0xffdfb0, 4.8);
    key.position.set(4.8, 4.6, 3.4);
    const fill = new THREE.DirectionalLight(0x83bdff, 2.15);
    fill.position.set(3.2, -1.8, -4.5);
    const rim = new THREE.DirectionalLight(0x4d8fd8, 1.15);
    rim.position.set(-3.8, 2.1, -4.2);
    scene.add(hemisphere, key, fill, rim);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    const bounds = visibleObjectBounds(presentation);
    const size = bounds.getSize(new THREE.Vector3());
    // La toma mira desde +X. En pantalla, el eje longitudinal Z del arma es el
    // ancho y Y es la altura, por lo que el frustum usa esas proyecciones.
    const projectedSize = new THREE.Vector3(size.z, size.y, size.x);
    return { scene, camera, model, presentation, bounds, size, projectedSize };
  } catch (error) {
    disposeWeaponPreviewObject(model);
    throw error;
  }
}

function applyCameraFrame(entry, aspect, padding) {
  const frame = weaponPreviewFrame(entry.projectedSize, aspect, padding);
  Object.assign(entry.camera, frame);
  entry.camera.position.set(frame.cameraZ, 0, 0);
  entry.camera.up.set(0, 1, 0);
  entry.camera.lookAt(0, 0, 0);
  entry.camera.updateProjectionMatrix();
  return frame;
}

export function disposeWeaponPreviewObject(root) {
  if (!root?.isObject3D) return { geometries: 0, materials: 0, textures: 0 };
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    // Three.js comparte internamente Sprite.geometry entre instancias. Nunca se
    // toma ownership de esa geometría global; sí de su material y texturas.
    if (!object.isSprite && object.geometry?.dispose) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material?.dispose) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && value.dispose) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  root.removeFromParent();
  return { geometries: geometries.size, materials: materials.size, textures: textures.size };
}

function defaultRendererFactory() {
  return new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
}

function configurePreviewRenderer(renderer) {
  if (!renderer?.render || !renderer?.domElement) {
    throw new TypeError('rendererFactory debe devolver un renderer compatible con Three.js.');
  }
  renderer.setPixelRatio?.(1);
  renderer.setClearColor?.(0x000000, 0);
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  if ('toneMapping' in renderer) renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = 1.22;
  if (renderer.shadowMap) renderer.shadowMap.enabled = false;
  return renderer;
}

/**
 * Captura una colección de armas como PNG transparentes. El renderer y todos
 * los modelos 3D son temporales: se usa un solo contexto para las faltantes, se
 * guardan sus data URLs en el Map recibido y después se liberan completamente.
 */
export function captureWeaponPreviewDataUrls({
  kinds = WEAPON_PREVIEW_KINDS,
  cache = new Map(),
  rendererFactory = defaultRendererFactory,
  pixelRatio = defaultPixelRatio(),
  mimeType = 'image/png',
  quality,
  ...options
} = {}) {
  if (!(cache instanceof Map)) throw new TypeError('cache debe ser un Map.');
  if (!Array.isArray(kinds)) throw new TypeError('kinds debe ser una lista de armas.');
  const safeKinds = [...new Set(kinds.map(normalizedKind))];
  const missing = safeKinds.filter((kind) => !cache.has(kind));
  if (missing.length === 0) return cache;
  if (typeof rendererFactory !== 'function') throw new TypeError('rendererFactory debe ser una función.');

  const resolvedOptions = { ...DEFAULT_WEAPON_PREVIEW_OPTIONS, ...options };
  const size = resolveWeaponPreviewSize({ ...resolvedOptions, pixelRatio });
  const renderer = configurePreviewRenderer(rendererFactory());
  try {
    if (typeof renderer.domElement.toDataURL !== 'function') {
      throw new TypeError('El canvas WebGL no permite capturar una data URL.');
    }
    renderer.setSize?.(size.width, size.height, false);
    for (const kind of missing) {
      const entry = createPreviewScene(kind, resolvedOptions);
      try {
        applyCameraFrame(entry, size.aspect, resolvedOptions.padding);
        renderer.clear?.();
        renderer.render(entry.scene, entry.camera);
        const url = renderer.domElement.toDataURL(mimeType, quality);
        if (typeof url !== 'string' || !url.startsWith('data:')) {
          throw new Error(`No se pudo capturar la miniatura de ${kind}.`);
        }
        cache.set(kind, url);
      } finally {
        entry.scene.remove(entry.presentation);
        disposeWeaponPreviewObject(entry.model);
      }
    }
    return cache;
  } finally {
    renderer.dispose?.();
    renderer.forceContextLoss?.();
  }
}

function defaultPixelRatio() {
  return typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
}

function imageForTarget(target, options) {
  if (!target) throw new TypeError('Se requiere un elemento para montar la vista previa.');
  const isImage = String(target.tagName || '').toLowerCase() === 'img';
  if (isImage) return { image: target, created: false };
  const documentRef = target.ownerDocument || globalThis.document;
  if (!documentRef?.createElement || typeof target.append !== 'function') {
    throw new TypeError('El destino debe ser una imagen o un elemento DOM que admita hijos.');
  }
  const image = documentRef.createElement('img');
  image.className = options.imageClass || 'weapon-preview-image';
  if (image.style) {
    image.style.display = 'block';
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.objectFit = 'contain';
    image.style.pointerEvents = 'none';
  }
  target.append(image);
  return { image, created: true };
}

function setTargetState(target, state) {
  target.setAttribute?.('data-weapon-preview-state', state);
  if (target.dataset) target.dataset.weaponPreviewState = state;
}

/**
 * Galería liviana basada en snapshots. La primera miniatura genera y cachea las
 * siete armas con un único renderer temporal; mount nunca conserva escenas,
 * modelos ni contextos WebGL y ambos menús pueden reutilizar el mismo data URL.
 */
export class WeaponPreviewManager {
  constructor({
    cache = new Map(),
    capture = captureWeaponPreviewDataUrls,
    preloadAll = true,
    throwOnError = false,
    ...captureOptions
  } = {}) {
    if (!(cache instanceof Map)) throw new TypeError('cache debe ser un Map.');
    if (typeof capture !== 'function') throw new TypeError('capture debe ser una función.');
    this.cache = cache;
    this.capture = capture;
    this.preloadAll = preloadAll;
    this.throwOnError = throwOnError;
    this.captureOptions = captureOptions;
    this.entries = new Set();
    this.lastError = null;
    this.disposed = false;
  }

  preload(kinds = WEAPON_PREVIEW_KINDS) {
    if (this.disposed) throw new Error('El administrador de miniaturas ya fue cerrado.');
    const requested = [...new Set(kinds.map(normalizedKind))];
    const captureKinds = this.preloadAll ? WEAPON_PREVIEW_KINDS : requested;
    try {
      this.capture({ ...this.captureOptions, kinds: captureKinds, cache: this.cache });
      this.lastError = null;
    } catch (error) {
      this.lastError = error;
      if (this.throwOnError) throw error;
    }
    return this.cache;
  }

  _apply(entry) {
    let url = this.cache.get(entry.kind);
    if (!url) {
      this.preload([entry.kind]);
      url = this.cache.get(entry.kind);
    }
    if (!url) {
      if (entry.image) entry.image.hidden = true;
      setTargetState(entry.target, 'fallback');
      entry.available = false;
      return false;
    }
    if (!entry.image) {
      const result = imageForTarget(entry.target, entry.options);
      entry.image = result.image;
      entry.createdImage = result.created;
    }
    entry.image.src = url;
    entry.image.alt = entry.options.label || `Vista 3D de ${WEAPON_DEFS[entry.kind].name}`;
    entry.image.decoding = 'async';
    entry.image.draggable = false;
    entry.image.hidden = false;
    setTargetState(entry.target, 'ready');
    entry.available = true;
    return true;
  }

  mount(target, kind, options = {}) {
    if (this.disposed) throw new Error('El administrador de miniaturas ya fue cerrado.');
    const entry = {
      target,
      kind: normalizedKind(kind),
      options,
      image: null,
      createdImage: false,
      available: false,
      disposed: false,
    };
    const handle = {
      get kind() { return entry.kind; },
      get image() { return entry.image; },
      get available() { return entry.available; },
      refresh: () => this.refresh(handle),
      setWeapon: (nextKind) => this.setWeapon(handle, nextKind),
      dispose: () => this.unmount(handle),
      _entry: entry,
    };
    entry.handle = handle;
    this.entries.add(entry);
    try {
      this._apply(entry);
    } catch (error) {
      this.entries.delete(entry);
      entry.disposed = true;
      throw error;
    }
    return handle;
  }

  _entryFor(handle) {
    const entry = handle?._entry;
    if (!entry || !this.entries.has(entry) || entry.disposed) {
      throw new Error('La vista previa no está montada en este administrador.');
    }
    return entry;
  }

  refresh(handle) {
    return this._apply(this._entryFor(handle));
  }

  setWeapon(handle, kind) {
    const entry = this._entryFor(handle);
    const safeKind = normalizedKind(kind);
    if (safeKind === entry.kind) return false;
    entry.kind = safeKind;
    this._apply(entry);
    return true;
  }

  unmount(handle) {
    const entry = handle?._entry;
    if (!entry || !this.entries.has(entry) || entry.disposed) return false;
    entry.disposed = true;
    if (entry.createdImage) entry.image?.remove?.();
    setTargetState(entry.target, 'idle');
    this.entries.delete(entry);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    for (const entry of [...this.entries]) this.unmount(entry.handle);
    this.disposed = true;
  }
}

export function mountWeaponPreviews(root, {
  manager = null,
  selector = '[data-weapon-preview]',
  managerOptions = {},
  previewOptions = {},
} = {}) {
  if (!root?.querySelectorAll) throw new TypeError('Se requiere una raíz DOM para buscar miniaturas.');
  const ownsManager = !manager;
  const activeManager = manager || new WeaponPreviewManager(managerOptions);
  const handles = [];
  for (const target of root.querySelectorAll(selector)) {
    const kind = target.dataset?.weaponPreview || target.getAttribute?.('data-weapon-preview');
    handles.push(activeManager.mount(target, kind, previewOptions));
  }
  return {
    manager: activeManager,
    handles,
    dispose() {
      for (const handle of handles) handle.dispose();
      if (ownsManager) activeManager.dispose();
    },
  };
}
