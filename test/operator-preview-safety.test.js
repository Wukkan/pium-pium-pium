import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createResilientWebGLRenderer,
  createSafeWebGLRenderer,
} from '../src/operator-preview-safety.js';

test('operator preview creates the renderer with the requested options', () => {
  const calls = [];
  class Renderer {
    constructor(options) {
      calls.push(options);
      this.ready = true;
    }
  }
  const options = { antialias: true, alpha: true };
  const renderer = createSafeWebGLRenderer({ WebGLRenderer: Renderer }, options);
  assert.equal(renderer.ready, true);
  assert.deepEqual(calls, [options]);
});

test('operator preview WebGL failure is reported without aborting game startup', () => {
  const failure = new Error('context limit reached');
  const reported = [];
  class BrokenRenderer {
    constructor() { throw failure; }
  }
  const renderer = createSafeWebGLRenderer(
    { WebGLRenderer: BrokenRenderer },
    { antialias: true },
    (error) => reported.push(error),
  );
  assert.equal(renderer, null);
  assert.deepEqual(reported, [failure]);
});

test('missing WebGL implementation uses the same safe fallback', () => {
  let reported = null;
  assert.equal(createSafeWebGLRenderer({}, {}, (error) => { reported = error; }), null);
  assert.match(reported.message, /WebGLRenderer no disponible/);
});

test('resilient renderer retries with a lighter graphics profile', () => {
  const attempts = [];
  class Renderer {
    constructor(options) {
      attempts.push(options);
      if (options.antialias) throw new Error('perfil pesado rechazado');
      this.options = options;
    }
  }
  const renderer = createResilientWebGLRenderer({ WebGLRenderer: Renderer }, [
    { antialias: true, powerPreference: 'high-performance' },
    { antialias: false, powerPreference: 'default' },
  ]);
  assert.equal(renderer.options.antialias, false);
  assert.equal(attempts.length, 2);
});

test('resilient renderer reports only after every profile fails', () => {
  const errors = [];
  class BrokenRenderer { constructor() { throw new Error('sin contexto'); } }
  const renderer = createResilientWebGLRenderer(
    { WebGLRenderer: BrokenRenderer },
    [{ antialias: true }, { antialias: false }],
    (error) => errors.push(error),
  );
  assert.equal(renderer, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /sin contexto/);
});
