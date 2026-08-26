export function createSafeWebGLRenderer(THREE, options = {}, onError = () => {}) {
  try {
    if (!THREE || typeof THREE.WebGLRenderer !== 'function') {
      throw new TypeError('WebGLRenderer no disponible');
    }
    return new THREE.WebGLRenderer(options);
  } catch (error) {
    try { onError(error); } catch { /* el reporte nunca debe romper el arranque */ }
    return null;
  }
}

export function createResilientWebGLRenderer(THREE, attempts, onError = () => {}) {
  const optionsList = Array.isArray(attempts) && attempts.length ? attempts : [{}];
  let lastError = null;
  for (const options of optionsList) {
    const renderer = createSafeWebGLRenderer(THREE, options, (error) => { lastError = error; });
    if (renderer) return renderer;
  }
  try { onError(lastError || new Error('No se pudo crear un contexto WebGL')); } catch { /* reporte opcional */ }
  return null;
}
