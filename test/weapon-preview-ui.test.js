import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
]);

test('arsenal and buy cards use snapshots plus one shared live 3D contract', () => {
  assert.match(main, /new WeaponPreviewManager\(/);
  assert.match(main, /new LiveWeaponPreviewManager\(/);
  assert.match(main, /mountWeaponCardPreview\(card, '\.weapon-icon'/);
  assert.match(main, /mountWeaponCardPreview\(card, '\.buy-weapon-icon'/);
  assert.ok((main.match(/data-weapon-preview=/g) || []).length >= 2);
  assert.match(main, /fallbackElement: snapshotHandle\.image/);
  assert.match(main, /interactionTarget: card/);
  assert.match(main, /liveWeaponPreviewManager\.syncPreferences\(/);
  assert.match(main, /liveWeaponPreviewManager\.resume\(\)/);
  assert.match(main, /liveWeaponPreviewManager\.suspend\(\)/);
  assert.match(main, /pagehide[\s\S]*event\.persisted[\s\S]*pageshow/);
  assert.match(main, /hud\.showBuyMenu\(buyOpen\);\s*if \(buyOpen\) \{\s*renderBuyMenu\(\);\s*liveWeaponPreviewManager\.resume\(\)/);
  assert.match(html, /\.weapon-preview-image, \.weapon-live-preview-canvas\s*\{/);
  assert.ok((main.match(/weapon-preview-live/g) || []).length >= 2);
});

test('legacy CSS weapon silhouettes cannot drift from playable models', () => {
  assert.doesNotMatch(html, /\.menu-weapon-card\s+\.weapon-icon::before/);
  assert.doesNotMatch(html, /\.buy-weapon-icon::(?:before|after)/);
  assert.doesNotMatch(html, /--weapon-(?:length|height|stock|skew)/);
});

test('operator preview identity includes and mounts the equipped weapon model', () => {
  assert.match(main, /buildWeaponOnlyModel\(kind\)/);
  assert.match(main, /const weaponKind = WEAPON_DEFS\[weapons\.current\]\?\.kind/);
  assert.match(main, /\|\$\{weaponKind\}`/);
  assert.match(main, /equipOperatorPreviewWeapon\(rig, weaponKind\)/);
  assert.match(main, /setOperatorWeaponGrip\?\.\(kind, detailedWeapon\.scale\.x\)/);
  assert.match(main, /setOperatorPreviewStance\?\.\(\)/);
  assert.match(main, /animateHumanoid\([\s\S]*operatorPreview\.motionClock/);
  assert.match(main, /operatorPreview\.camera\.fov = operatorPreviewFov\(weaponKind, \{ compact \}\)/);
  assert.match(main, /operatorPreview\.rig = rig;\s*syncOperatorPreviewCamera\(\)/);
});

test('active loadout card reuses the personalized operator renderer', () => {
  assert.match(html, /id="menu-operator-preview"[^>]+role="img"/);
  assert.doesNotMatch(html, /class="operator-avatar"/);
  assert.match(main, /const hostId = activeScreen === 'operator' \? 'operator-preview' : 'menu-operator-preview'/);
  assert.match(main, /operatorPreview\.renderer && operatorPreview\.renderer\.domElement\.parentElement !== host/);
  assert.match(main, /host\.appendChild\(operatorPreview\.renderer\.domElement\)/);
  assert.match(main, /active === 'play' \|\| active === 'operator'\) initOperatorPreview\(active\)/);
  assert.match(main, /const key = `\$\{name\}\|\$\{skin\.hat \|\| 'none'\}\|\$\{color\}\|\$\{weaponKind\}`/);
  assert.match(main, /makeHumanoid\(color, name,[\s\S]+skin\.hat \|\| 'none'\)/);
  assert.match(main, /for \(const id of \['operator-preview', 'menu-operator-preview'\]\)/);
  assert.match(main, /host\.setAttribute\('aria-label', operatorLabel\)/);
  assert.match(main, /host\.dataset\.hat = meta\.hat \|\| 'none'/);
  assert.match(main, /host\.dataset\.weapon = weapon\.kind/);
  assert.match(main, /previewRenderer\.domElement\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(main, /pagehide[\s\S]+disposeOperatorPreview\(\)/);
});
