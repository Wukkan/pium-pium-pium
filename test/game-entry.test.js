import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gameplayControlActive, requestPointerLockSafe } from '../src/game-entry.js';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('gameplay control remains active with Pointer Lock or the compatible fallback', () => {
  assert.equal(gameplayControlActive(null, false), false);
  assert.equal(gameplayControlActive({}, false), true);
  assert.equal(gameplayControlActive(null, true), true);
});

test('Pointer Lock absence and synchronous errors never abort room entry', async () => {
  for (const target of [null, {}, { requestPointerLock() { throw new Error('blocked'); } }]) {
    const attempt = requestPointerLockSafe(target);
    assert.equal(attempt.requested, false);
    assert.equal(await attempt.completion, false);
  }
});

test('Pointer Lock promises report acceptance and rejection without throwing', async () => {
  const accepted = requestPointerLockSafe({ requestPointerLock: () => Promise.resolve() });
  assert.equal(accepted.requested, true);
  assert.equal(await accepted.completion, true);

  const rejected = requestPointerLockSafe({ requestPointerLock: () => Promise.reject(new Error('denied')) });
  assert.equal(rejected.requested, true);
  assert.equal(await rejected.completion, false);

  const legacy = requestPointerLockSafe({ requestPointerLock() {} });
  assert.equal(legacy.requested, true);
  assert.equal(await legacy.completion, true);
});

test('successful joining opens gameplay independently from Pointer Lock', () => {
  assert.match(mainSource, /if \(joined \|\| botsLocal\) \{ enterGameplayView\(\); return; \}/);
  assert.match(mainSource, /function enterGameplayView\(\)[\s\S]*?state = 'playing';[\s\S]*?hud\.showMenu\(false\);[\s\S]*?hud\.showHud\(true\);/);
  assert.match(mainSource, /const inputEnabled = playing && hasGameplayControl\(\)/);
  assert.match(mainSource, /player\.setFallbackLook\(fallbackControlsActive, renderer\.domElement\)/);
  assert.match(mainSource, /weapons\.setFallbackControls\(fallbackControlsActive, renderer\.domElement\)/);
});

test('the room entry CTA stays fixed and visible on compact viewports', () => {
  assert.match(indexSource, /@media \(max-width: 900px\)[\s\S]*?#menu-screen-play\.active #play-btn\s*\{[\s\S]*?position: fixed;/);
  assert.match(indexSource, /#menu\s*\{\s*overflow: hidden; padding-bottom: 112px;/);
  assert.match(indexSource, /#menu-content\s*\{\s*height: 100%; overflow-y: auto;/);
});

test('a late Pointer Lock grant cannot capture the cursor over an overlay', () => {
  assert.match(mainSource, /if \(document\.pointerLockElement\) \{\s*if \(buyOpen \|\| botPanelOpen \|\| podiumOpen \|\| teamPickerOpen\) \{\s*document\.exitPointerLock\(\);\s*return;/);
});
