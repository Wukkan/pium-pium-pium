import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
]);

test('static menu clearly waits for the game module instead of exposing a dead play button', () => {
  assert.match(html, /<html lang="es" data-game-boot="loading">/);
  assert.match(html, /id="play-btn" disabled aria-busy="true">CARGANDO JUEGO/);
  assert.match(html, /setTimeout\(fail, 15000\)/);
  assert.match(html, /REINTENTAR CARGA/);
  assert.match(html, /addEventListener\('pium:ready'/);
  assert.match(main, /document\.documentElement\.dataset\.gameBoot = 'ready'/);
  assert.match(main, /dataset\.gameBoot = 'ready';\s*[\s\S]*?renderLobbySelector\(\);\s*window\.dispatchEvent\(new Event\('pium:ready'\)\)/);
  assert.match(main, /window\.dispatchEvent\(new Event\('pium:ready'\)\)/);
});

test('both primary and operator WebGL contexts retry safely', () => {
  assert.ok((main.match(/createResilientWebGLRenderer\(/g) || []).length >= 2);
  assert.match(main, /antialias: false, powerPreference: 'default'/);
  assert.match(main, /if \(!previewRenderer\) return disableOperatorPreview\(rendererFailure\)/);
  assert.match(main, /catch \(error\) \{\s*disableOperatorPreview\(error\);\s*\}/);
  assert.match(html, /data-preview-state="loading"/);
  assert.ok((html.match(/data-operator-preview-status/g) || []).length >= 2);
});

test('local training remains an explicit escape hatch from online connection failures', () => {
  assert.match(html, /id="local-play-btn"[^>]+disabled>PROBAR EN LOCAL/);
  assert.match(main, /function startLocalTraining\(\)/);
  assert.match(main, /localPlayBtn\?\.addEventListener\('click', startLocalTraining\)/);
  assert.match(main, /function prepareLocalMatch\(\)[\s\S]+setupOffline\(\)/);
  assert.match(main, /finally \{\s*connecting = false;\s*renderLobbySelector\(\);\s*\}/);
  const localEntry = main.match(/function startLocalTraining\(\)[\s\S]*?\n}\n\nfunction setFallbackControls/)?.[0] || '';
  assert.doesNotMatch(localEntry, /tryLock\(\)/, 'local entry must request control only after gameplay is visible');
});
