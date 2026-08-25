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

export const DEFAULT_LIVE_WEAPON_PREVIEW_OPTIONS = Object.freeze({
  ...DEFAULT_WEAPON_PREVIEW_OPTIONS,
  maxFps: 30,
  // Una vuelta completa cada ~8 s; hover/foco la acelera sin marear el menú.
  rotationSpeed: 0.78,
  interactionSpeedMultiplier: 1.45,
  tiltAmplitude: 0.012,
  intersectionThreshold: 0.08,
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

// Estado puro de la rotación: facilita verificar movimiento y accesibilidad sin
// crear renderer, DOM ni temporizadores en las pruebas.
export function liveWeaponPreviewPose(elapsedSeconds = 0, {
  reducedMotion = false,
  rotationSpeed = DEFAULT_LIVE_WEAPON_PREVIEW_OPTIONS.rotationSpeed,
  tiltAmplitude = DEFAULT_LIVE_WEAPON_PREVIEW_OPTIONS.tiltAmplitude,
} = {}) {
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  if (reducedMotion) return { x: 0, y: 0, z: 0 };
  const speed = Math.max(0, Number(rotationSpeed) || 0);
  const tilt = Math.max(0, Number(tiltAmplitude) || 0);
  const phase = elapsed * speed;
  return {
    x: Math.sin(phase * 2) * tilt,
    y: phase % (Math.PI * 2),
    z: 0,
  };
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
  presentation.name = `weapon-preview-centered-${options.kind}`;
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
    const centeredModel = orientAndCenterModel(model, { ...options, kind });
    // Un pivote separado mantiene el centro del arma en el origen. La captura
    // estática queda idéntica y la vista en vivo puede rotar sin orbitar.
    const presentation = new THREE.Group();
    presentation.name = `weapon-preview-presentation-${kind}`;
    presentation.add(centeredModel);
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

function defaultLiveRendererFactory() {
  return new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
}

function defaultAnimationNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultAnimationFrame() {
  return typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : null;
}

function defaultCancelAnimationFrame() {
  return typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : null;
}

function defaultIntersectionObserverFactory() {
  return typeof globalThis.IntersectionObserver === 'function'
    ? (callback, options) => new globalThis.IntersectionObserver(callback, options)
    : null;
}

function defaultResizeObserverFactory() {
  return typeof globalThis.ResizeObserver === 'function'
    ? (callback) => new globalThis.ResizeObserver(callback)
    : null;
}

function defaultMatchMedia() {
  return typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia.bind(globalThis) : null;
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

function setLiveTargetState(target, state) {
  target.setAttribute?.('data-weapon-live-state', state);
  if (target.dataset) target.dataset.weaponLiveState = state;
}

function initiallyVisible(target, documentRef) {
  if (typeof target?.getBoundingClientRect !== 'function') return true;
  const rect = target.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return false;
  const view = documentRef?.defaultView || globalThis;
  const width = finitePositive(view?.innerWidth, Infinity);
  const height = finitePositive(view?.innerHeight, Infinity);
  return rect.bottom >= 0 && rect.right >= 0 && rect.top <= height && rect.left <= width;
}

function documentIsVisible(documentRef) {
  return documentRef?.hidden !== true && documentRef?.visibilityState !== 'hidden';
}

function normalizedRenderScale(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0.5, numeric)) : 1;
}

function liveRenderTarget(target, options) {
  if (!target) throw new TypeError('Se requiere un elemento para montar la vista 3D en vivo.');
  const isImage = String(target.tagName || '').toLowerCase() === 'img';
  const renderTarget = options.renderTarget || (isImage ? target.parentElement : target);
  if (!renderTarget || typeof renderTarget.append !== 'function') {
    throw new TypeError('La vista 3D en vivo requiere un contenedor DOM que admita el canvas.');
  }
  return {
    renderTarget,
    interactionTarget: options.interactionTarget || renderTarget,
    fallbackElement: options.fallbackElement || (isImage ? target : null),
  };
}

/**
 * Motor interactivo de previews. Conserva como máximo un modelo, un canvas y un
 * contexto WebGL: el canvas se mueve a la tarjeta con hover/foco y las demás
 * continúan mostrando el snapshot cacheado de WeaponPreviewManager.
 */
export class LiveWeaponPreviewManager {
  constructor({
    rendererFactory = defaultLiveRendererFactory,
    intersectionObserverFactory = defaultIntersectionObserverFactory(),
    resizeObserverFactory = defaultResizeObserverFactory(),
    matchMedia = defaultMatchMedia(),
    requestFrame = defaultAnimationFrame(),
    cancelFrame = defaultCancelAnimationFrame(),
    now = defaultAnimationNow,
    documentRef = globalThis.document || null,
    pixelRatio = defaultPixelRatio,
    renderScale = 1,
    reducedMotion = null,
    throwOnError = false,
    ...options
  } = {}) {
    if (typeof rendererFactory !== 'function') throw new TypeError('rendererFactory debe ser una función.');
    if (typeof now !== 'function') throw new TypeError('now debe ser una función.');
    this.rendererFactory = rendererFactory;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.now = now;
    this.documentRef = documentRef;
    this.pixelRatio = pixelRatio;
    this.renderScale = normalizedRenderScale(renderScale);
    this.throwOnError = throwOnError;
    this.options = { ...DEFAULT_LIVE_WEAPON_PREVIEW_OPTIONS, ...options };
    this.entries = new Set();
    this.observedEntries = new Map();
    this.activeEntry = null;
    this.sceneEntry = null;
    this.sceneKey = '';
    this.renderer = null;
    this.canvas = null;
    this.canvasContextLost = null;
    this.renderSize = null;
    this.frameRequest = null;
    this.activeStartedAt = 0;
    this.lastRenderAt = -Infinity;
    this.rotationPhase = 0;
    this.lastPoseAt = null;
    this.intentCounter = 0;
    this.suspended = false;
    this.webglFailed = false;
    this.lastError = null;
    this.disposed = false;

    this.intersectionObserver = null;
    if (typeof intersectionObserverFactory === 'function') {
      try {
        this.intersectionObserver = intersectionObserverFactory(
          (records) => this._onIntersections(records),
          { threshold: this.options.intersectionThreshold },
        );
      } catch (error) {
        this.lastError = error;
      }
    }

    this.resizeObserver = null;
    if (typeof resizeObserverFactory === 'function') {
      try {
        this.resizeObserver = resizeObserverFactory((records) => this._onResize(records));
      } catch (error) {
        this.lastError = error;
      }
    }

    this.motionQuery = null;
    this.motionListener = null;
    this.appReducedMotion = typeof reducedMotion === 'boolean' ? reducedMotion : false;
    this.systemReducedMotion = false;
    this.reducedMotion = this.appReducedMotion;
    if (typeof matchMedia === 'function') {
      try {
        this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
        this.systemReducedMotion = !!this.motionQuery?.matches;
        this.reducedMotion = this.appReducedMotion || this.systemReducedMotion;
        this.motionListener = (event) => this._setSystemReducedMotion(!!event.matches);
        this.motionQuery?.addEventListener?.('change', this.motionListener);
        if (!this.motionQuery?.addEventListener) this.motionQuery?.addListener?.(this.motionListener);
      } catch (error) {
        this.lastError = error;
      }
    }

    this.pageVisible = documentIsVisible(documentRef);
    this.visibilityListener = () => {
      this.pageVisible = documentIsVisible(this.documentRef);
      if (!this.pageVisible) {
        this._cancelFrame();
      } else if (this.activeEntry) {
        this._safeRender(this.now(), true);
        this._scheduleFrame();
      } else {
        this._activateBestEntry();
      }
    };
    documentRef?.addEventListener?.('visibilitychange', this.visibilityListener);
  }

  mount(target, kind, options = {}) {
    if (this.disposed) throw new Error('El motor de previews 3D ya fue cerrado.');
    const elements = liveRenderTarget(target, options);
    const entry = {
      target,
      kind: normalizedKind(kind),
      options,
      ...elements,
      visible: initiallyVisible(elements.renderTarget, this.documentRef),
      hovered: false,
      focused: false,
      manualActive: false,
      autoActive: options.autoActivate === true || options.equipped === true,
      intentOrder: 0,
      live: false,
      failed: false,
      fallbackVisibility: null,
      listeners: [],
      disposed: false,
    };
    const handle = {
      get kind() { return entry.kind; },
      get active() { return thisManager.activeEntry === entry; },
      get visible() { return entry.visible; },
      get live() { return entry.live; },
      get autoActive() { return entry.autoActive; },
      activate: () => this.activate(handle),
      deactivate: () => this.deactivate(handle),
      setWeapon: (nextKind) => this.setWeapon(handle, nextKind),
      setVisible: (visible) => this.setVisible(handle, visible),
      setEquipped: (equipped) => this.setEquipped(handle, equipped),
      retry: () => this.retry(handle),
      dispose: () => this.unmount(handle),
      _entry: entry,
    };
    const thisManager = this;
    entry.handle = handle;
    this.entries.add(entry);
    this.observedEntries.set(entry.renderTarget, entry);
    this._bindEntryEvents(entry);
    this.intersectionObserver?.observe?.(entry.renderTarget);
    this.resizeObserver?.observe?.(entry.renderTarget);
    setLiveTargetState(entry.target, entry.visible ? 'idle' : 'offscreen');
    if (entry.autoActive) {
      this._markIntent(entry);
      this._syncEntry(entry);
    }
    return handle;
  }

  _bindEntryEvents(entry) {
    const bind = (type, listener) => {
      entry.interactionTarget?.addEventListener?.(type, listener);
      entry.listeners.push([type, listener]);
    };
    bind('pointerenter', () => {
      this._refreshVisibilityFallback(entry);
      entry.hovered = true;
      this._markIntent(entry);
      this._syncEntry(entry);
    });
    bind('pointerleave', () => {
      entry.hovered = false;
      this._syncEntry(entry);
    });
    bind('focusin', () => {
      this._refreshVisibilityFallback(entry);
      entry.focused = true;
      this._markIntent(entry);
      this._syncEntry(entry);
    });
    bind('focusout', (event) => {
      if (event.relatedTarget && entry.interactionTarget?.contains?.(event.relatedTarget)) return;
      entry.focused = false;
      this._syncEntry(entry);
    });
  }

  _entryFor(handle) {
    const entry = handle?._entry;
    if (!entry || !this.entries.has(entry) || entry.disposed) {
      throw new Error('La vista 3D no está montada en este administrador.');
    }
    return entry;
  }

  _markIntent(entry) {
    entry.intentOrder = ++this.intentCounter;
  }

  _refreshVisibilityFallback(entry) {
    if (this.intersectionObserver) return entry.visible;
    const visible = initiallyVisible(entry.renderTarget, this.documentRef);
    if (entry.visible !== visible) {
      entry.visible = visible;
      setLiveTargetState(entry.target, visible ? 'idle' : 'offscreen');
    }
    return visible;
  }

  _wantsLive(entry) {
    return entry.visible && !entry.failed &&
      (entry.manualActive || entry.hovered || entry.focused || entry.autoActive);
  }

  _syncEntry(entry) {
    if (this._wantsLive(entry)) {
      this._activateEntry(entry);
    } else if (this.activeEntry === entry) {
      this._detachActive();
      this._activateBestEntry();
    }
  }

  _activateBestEntry() {
    if (this.suspended || this.webglFailed || this.disposed || !this.pageVisible || this.activeEntry) return false;
    const candidate = [...this.entries]
      .filter((entry) => this._wantsLive(entry))
      .sort((a, b) => b.intentOrder - a.intentOrder)[0];
    return candidate ? this._activateEntry(candidate) : false;
  }

  _onIntersections(records = []) {
    for (const record of records) {
      const entry = this.observedEntries.get(record.target);
      if (!entry) continue;
      const visible = record.isIntersecting !== false && (record.intersectionRatio ?? 1) > 0;
      this.setVisible(entry.handle, visible);
    }
  }

  _onResize(records = []) {
    if (!this.activeEntry) return;
    if (records.length && !records.some((record) => record.target === this.activeEntry.renderTarget)) return;
    this._safeRender(this.now(), true);
  }

  _ensureRenderer() {
    if (this.renderer) return this.renderer;
    if (this.webglFailed) throw this.lastError || new Error('WebGL no está disponible para previews en vivo.');
    const renderer = configurePreviewRenderer(this.rendererFactory());
    const canvas = renderer.domElement;
    if (!canvas?.style) canvas.style = {};
    canvas.className = this.options.canvasClass || 'weapon-live-preview-canvas';
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      display: 'block',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '1',
    });
    canvas.setAttribute?.('aria-hidden', 'true');
    this.canvasContextLost = (event) => {
      event?.preventDefault?.();
      this._handleFailure(new Error('El contexto WebGL de las armas se perdió.'), this.activeEntry);
    };
    canvas.addEventListener?.('webglcontextlost', this.canvasContextLost);
    this.renderer = renderer;
    this.canvas = canvas;
    return renderer;
  }

  _sceneOptions(entry) {
    return { ...this.options, ...entry.options };
  }

  _sceneCacheKey(entry) {
    const options = this._sceneOptions(entry);
    return [entry.kind, options.rotationX, options.rotationY, options.rotationZ].join('|');
  }

  _ensureScene(entry) {
    const key = this._sceneCacheKey(entry);
    if (this.sceneEntry && this.sceneKey === key) return this.sceneEntry;
    this._disposeScene();
    this.sceneEntry = createPreviewScene(entry.kind, this._sceneOptions(entry));
    this.sceneKey = key;
    return this.sceneEntry;
  }

  _disposeScene() {
    if (!this.sceneEntry) return;
    this.sceneEntry.scene.remove(this.sceneEntry.presentation);
    disposeWeaponPreviewObject(this.sceneEntry.model);
    this.sceneEntry = null;
    this.sceneKey = '';
  }

  _fallbackFor(entry) {
    if (entry.fallbackElement) return entry.fallbackElement;
    return entry.renderTarget.querySelector?.('.weapon-preview-image') ||
      entry.renderTarget.querySelector?.('img') || null;
  }

  _hideFallback(entry) {
    const fallback = this._fallbackFor(entry);
    if (!fallback?.style) return;
    entry.fallbackElement = fallback;
    entry.fallbackVisibility = fallback.style.visibility;
    fallback.style.visibility = 'hidden';
  }

  _restoreFallback(entry) {
    const fallback = entry?.fallbackElement;
    if (fallback?.style && entry.fallbackVisibility !== null) {
      fallback.style.visibility = entry.fallbackVisibility;
    }
    if (entry) entry.fallbackVisibility = null;
  }

  _resizeActive() {
    const entry = this.activeEntry;
    if (!entry || !this.renderer || !this.sceneEntry) return null;
    const options = this._sceneOptions(entry);
    const rect = entry.renderTarget.getBoundingClientRect?.();
    const deviceRatio = typeof this.pixelRatio === 'function' ? this.pixelRatio() : this.pixelRatio;
    const requestedRatio = finitePositive(deviceRatio, 1) * this.renderScale;
    const size = resolveWeaponPreviewSize({
      ...options,
      width: rect?.width || entry.renderTarget.clientWidth || options.width,
      height: rect?.height || entry.renderTarget.clientHeight || options.height,
      pixelRatio: requestedRatio,
    });
    if (!this.renderSize || this.renderSize.width !== size.width || this.renderSize.height !== size.height) {
      this.renderer.setSize?.(size.width, size.height, false);
      this.renderSize = size;
    }
    applyCameraFrame(this.sceneEntry, size.aspect, options.padding);
    return size;
  }

  _renderActive(timestamp, force = false) {
    const entry = this.activeEntry;
    if (!entry || !this.renderer || !this.sceneEntry || !entry.visible || this.suspended || !this.pageVisible) return false;
    const time = Number.isFinite(Number(timestamp)) ? Number(timestamp) : this.now();
    const options = this._sceneOptions(entry);
    const fps = finitePositive(options.maxFps, DEFAULT_LIVE_WEAPON_PREVIEW_OPTIONS.maxFps);
    if (!force && time - this.lastRenderAt < 1000 / fps) return false;
    if (force || !this.renderSize) this._resizeActive();
    const poseDelta = this.lastPoseAt === null
      ? 0
      : Math.min(0.1, Math.max(0, (time - this.lastPoseAt) / 1000));
    this.lastPoseAt = time;
    if (!this.reducedMotion) {
      const speed = finitePositive(options.rotationSpeed, DEFAULT_LIVE_WEAPON_PREVIEW_OPTIONS.rotationSpeed) *
        (entry.hovered || entry.focused
          ? finitePositive(options.interactionSpeedMultiplier, DEFAULT_LIVE_WEAPON_PREVIEW_OPTIONS.interactionSpeedMultiplier)
          : 1);
      this.rotationPhase = (this.rotationPhase + poseDelta * speed) % (Math.PI * 2);
    }
    const pose = liveWeaponPreviewPose(this.rotationPhase, {
      ...options,
      rotationSpeed: 1,
      reducedMotion: this.reducedMotion,
    });
    this.sceneEntry.presentation.rotation.set(pose.x, pose.y, pose.z);
    this.sceneEntry.presentation.updateWorldMatrix(true, true);
    this.renderer.clear?.();
    this.renderer.render(this.sceneEntry.scene, this.sceneEntry.camera);
    this.lastRenderAt = time;
    return true;
  }

  _safeRender(timestamp, force = false) {
    try {
      return this._renderActive(timestamp, force);
    } catch (error) {
      return this._handleFailure(error, this.activeEntry);
    }
  }

  _scheduleFrame() {
    if (this.frameRequest !== null || !this.requestFrame || !this.activeEntry ||
        this.reducedMotion || this.suspended || !this.pageVisible || this.webglFailed) return;
    this.frameRequest = -1;
    const requestId = this.requestFrame((timestamp) => {
      this.frameRequest = null;
      this.tick(timestamp);
      this._scheduleFrame();
    });
    if (this.frameRequest === -1) this.frameRequest = requestId;
  }

  _cancelFrame() {
    if (this.frameRequest !== null && this.frameRequest !== -1) this.cancelFrame?.(this.frameRequest);
    this.frameRequest = null;
  }

  _activateEntry(entry) {
    if (this.disposed || this.suspended || this.webglFailed || !this.pageVisible || !this._wantsLive(entry)) return false;
    if (this.activeEntry === entry && entry.live) {
      this._scheduleFrame();
      return true;
    }
    if (this.activeEntry) this._detachActive();
    this.activeEntry = entry;
    this.activeStartedAt = this.now();
    this.lastRenderAt = -Infinity;
    this.rotationPhase = 0;
    this.lastPoseAt = this.activeStartedAt;
    this.renderSize = null;
    try {
      this._ensureRenderer();
      this._ensureScene(entry);
      entry.renderTarget.append(this.canvas);
      this._renderActive(this.activeStartedAt, true);
      this._hideFallback(entry);
      entry.live = true;
      setLiveTargetState(entry.target, this.reducedMotion ? 'static' : 'live');
      this._scheduleFrame();
      return true;
    } catch (error) {
      return this._handleFailure(error, entry);
    }
  }

  _detachActive() {
    const entry = this.activeEntry;
    if (!entry) return false;
    this._cancelFrame();
    this._restoreFallback(entry);
    entry.live = false;
    setLiveTargetState(entry.target, entry.visible ? 'idle' : 'offscreen');
    this.canvas?.remove?.();
    this.activeEntry = null;
    this.renderSize = null;
    this.lastPoseAt = null;
    return true;
  }

  _releaseRenderer() {
    if (!this.renderer) return;
    this.canvas?.removeEventListener?.('webglcontextlost', this.canvasContextLost);
    this.canvas?.remove?.();
    this.renderer.dispose?.();
    this.renderer.forceContextLoss?.();
    this.renderer = null;
    this.canvas = null;
    this.canvasContextLost = null;
    this.renderSize = null;
  }

  _handleFailure(error, entry) {
    this.lastError = error instanceof Error ? error : new Error(String(error));
    this.webglFailed = true;
    this._cancelFrame();
    if (entry) {
      this._restoreFallback(entry);
      entry.live = false;
      entry.failed = true;
      setLiveTargetState(entry.target, 'fallback');
    }
    this.activeEntry = null;
    this._disposeScene();
    this._releaseRenderer();
    if (this.throwOnError) throw this.lastError;
    return false;
  }

  activate(handle) {
    const entry = this._entryFor(handle);
    this._refreshVisibilityFallback(entry);
    entry.manualActive = true;
    this._markIntent(entry);
    return this._activateEntry(entry);
  }

  deactivate(handle) {
    const entry = this._entryFor(handle);
    entry.manualActive = false;
    entry.hovered = false;
    entry.focused = false;
    if (this.activeEntry !== entry) return false;
    this._detachActive();
    this._activateBestEntry();
    return true;
  }

  setVisible(handle, visible) {
    const entry = this._entryFor(handle);
    const next = !!visible;
    if (entry.visible === next) return false;
    entry.visible = next;
    if (!next) {
      setLiveTargetState(entry.target, 'offscreen');
      if (this.activeEntry === entry) {
        this._detachActive();
        this._activateBestEntry();
      }
    } else {
      setLiveTargetState(entry.target, 'idle');
      this._syncEntry(entry);
    }
    return true;
  }

  setWeapon(handle, kind) {
    const entry = this._entryFor(handle);
    const safeKind = normalizedKind(kind);
    if (safeKind === entry.kind) return false;
    const wasActive = this.activeEntry === entry;
    if (wasActive) this._detachActive();
    entry.kind = safeKind;
    entry.failed = false;
    if (wasActive && this._wantsLive(entry)) this._activateEntry(entry);
    return true;
  }

  setEquipped(handle, equipped) {
    const entry = this._entryFor(handle);
    const next = !!equipped;
    if (entry.autoActive === next) return false;
    entry.autoActive = next;
    if (next) this._markIntent(entry);
    this._syncEntry(entry);
    return true;
  }

  _applyReducedMotionPreference() {
    const next = this.appReducedMotion || this.systemReducedMotion;
    if (next === this.reducedMotion) return false;
    this.reducedMotion = next;
    this._cancelFrame();
    if (this.activeEntry) {
      this.activeStartedAt = this.now();
      this.lastRenderAt = -Infinity;
      this._safeRender(this.activeStartedAt, true);
      setLiveTargetState(this.activeEntry.target, next ? 'static' : 'live');
      this._scheduleFrame();
    }
    return true;
  }

  _setSystemReducedMotion(value) {
    const next = !!value;
    if (next === this.systemReducedMotion) return false;
    this.systemReducedMotion = next;
    this._applyReducedMotionPreference();
    return true;
  }

  setReducedMotion(value) {
    const next = !!value;
    if (next === this.appReducedMotion) return false;
    this.appReducedMotion = next;
    this._applyReducedMotionPreference();
    return true;
  }

  setRenderScale(value) {
    const next = normalizedRenderScale(value);
    if (next === this.renderScale) return false;
    this.renderScale = next;
    this.renderSize = null;
    if (this.activeEntry) this._safeRender(this.now(), true);
    return true;
  }

  syncPreferences({ reducedMotion = this.appReducedMotion, renderScale = this.renderScale } = {}) {
    const motionChanged = this.setReducedMotion(reducedMotion);
    const scaleChanged = this.setRenderScale(renderScale);
    return motionChanged || scaleChanged;
  }

  tick(timestamp = this.now()) {
    if (this.reducedMotion || this.suspended || !this.pageVisible || !this.activeEntry) return false;
    return this._safeRender(timestamp, false);
  }

  retry(handle = null) {
    if (this.disposed) return false;
    this.webglFailed = false;
    this.lastError = null;
    for (const entry of this.entries) entry.failed = false;
    if (handle) {
      const entry = this._entryFor(handle);
      this._markIntent(entry);
      return this._wantsLive(entry) ? this._activateEntry(entry) : false;
    }
    return this._activateBestEntry();
  }

  suspend({ release = false } = {}) {
    if (this.disposed || this.suspended) return false;
    this.suspended = true;
    this._detachActive();
    if (release) {
      this._disposeScene();
      this._releaseRenderer();
    }
    return true;
  }

  resume({ retry = false } = {}) {
    if (this.disposed) return false;
    const changed = this.suspended;
    this.suspended = false;
    if (retry) {
      this.webglFailed = false;
      this.lastError = null;
      for (const entry of this.entries) entry.failed = false;
    }
    this._activateBestEntry();
    return changed;
  }

  unmount(handle) {
    const entry = handle?._entry;
    if (!entry || !this.entries.has(entry) || entry.disposed) return false;
    if (this.activeEntry === entry) this._detachActive();
    entry.disposed = true;
    this._restoreFallback(entry);
    for (const [type, listener] of entry.listeners) {
      entry.interactionTarget?.removeEventListener?.(type, listener);
    }
    this.intersectionObserver?.unobserve?.(entry.renderTarget);
    this.resizeObserver?.unobserve?.(entry.renderTarget);
    this.observedEntries.delete(entry.renderTarget);
    this.entries.delete(entry);
    setLiveTargetState(entry.target, 'idle');
    this._activateBestEntry();
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.suspended = true;
    this._detachActive();
    for (const entry of [...this.entries]) this.unmount(entry.handle);
    this.intersectionObserver?.disconnect?.();
    this.resizeObserver?.disconnect?.();
    if (this.motionListener) {
      this.motionQuery?.removeEventListener?.('change', this.motionListener);
      if (!this.motionQuery?.removeEventListener) this.motionQuery?.removeListener?.(this.motionListener);
    }
    this.documentRef?.removeEventListener?.('visibilitychange', this.visibilityListener);
    this._disposeScene();
    this._releaseRenderer();
    this.disposed = true;
  }
}

export function mountLiveWeaponPreviews(root, {
  manager = null,
  selector = '[data-weapon-live-preview]',
  managerOptions = {},
  previewOptions = {},
} = {}) {
  if (!root?.querySelectorAll) throw new TypeError('Se requiere una raíz DOM para buscar previews en vivo.');
  const ownsManager = !manager;
  const activeManager = manager || new LiveWeaponPreviewManager(managerOptions);
  const handles = [];
  for (const target of root.querySelectorAll(selector)) {
    const kind = target.dataset?.weaponLivePreview || target.getAttribute?.('data-weapon-live-preview');
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
