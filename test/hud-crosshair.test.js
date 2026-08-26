import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCrosshairElement, HUD } from '../src/hud.js';
import { crosshairPresentation, readSettings } from '../src/ui-models.js';

function styleRecorder() {
  const values = new Map();
  return {
    values,
    display: '',
    writes: 0,
    setProperty(name, value) {
      this.writes++;
      values.set(name, value);
    },
  };
}

function crosshairElement() {
  const parts = new Map(['.t', '.b', '.l', '.r', '.dot'].map((key) => [key, { style: {} }]));
  return {
    dataset: {},
    style: styleRecorder(),
    parts,
    querySelector(selector) { return parts.get(selector) || null; },
  };
}

test('crosshair DOM adapter applies tactical arms, dot, dimensions, color, and outline', () => {
  const element = crosshairElement();
  const visual = applyCrosshairElement(element, {
    crosshairStyle: 'tactical',
    crosshairColor: '#12abef',
    crosshairScale: 1.5,
    crosshairThickness: 3,
    crosshairGap: 4,
    crosshairDot: true,
    crosshairDotSize: 5,
    crosshairOutline: true,
    crosshairOutlineThickness: 2,
    crosshairOutlineColor: '#112233',
    crosshairOpacity: 0.7,
    crosshairDynamic: true,
    crosshairDynamicAmount: 1.5,
  }, 6);

  assert.equal(element.dataset.crosshairStyle, 'tactical');
  assert.equal(element.parts.get('.t').style.display, 'none');
  assert.equal(element.parts.get('.b').style.display, 'block');
  assert.equal(element.parts.get('.dot').style.display, 'block');
  assert.equal(element.style.values.get('--crosshair-color'), '#12abef');
  assert.equal(element.style.values.get('--crosshair-length'), '13.50px');
  assert.equal(element.style.values.get('--crosshair-gap'), '13.00px');
  assert.equal(element.style.values.get('--crosshair-outline-thickness'), '2.00px');
  assert.equal(visual.dynamicExpansion, 9);
});

test('scope and death always hide the crosshair until both states clear', () => {
  const hud = Object.create(HUD.prototype);
  hud.el = {
    crosshair: crosshairElement(),
    scope: { style: {} },
    death: { style: {} },
    deathKiller: { textContent: '' },
  };
  hud._crosshairVisible = true;
  hud._scopeVisible = false;
  hud._scopeRendered = null;
  hud._combatActive = true;
  hud._crosshairBlocked = false;

  hud._syncCrosshairDisplay();
  assert.equal(hud.el.crosshair.style.display, 'block');
  hud.setScope(true);
  assert.equal(hud.el.crosshair.style.display, 'none');
  hud.showDeath(true, 'Bot');
  hud.setScope(false);
  assert.equal(hud.el.crosshair.style.display, 'none');
  hud.showDeath(false);
  assert.equal(hud.el.crosshair.style.display, 'block');

  hud.setCrosshairBlocked(true);
  assert.equal(hud.el.crosshair.style.display, 'none');
  hud.showDeath(true, 'Bot');
  hud.showDeath(false);
  assert.equal(hud.el.crosshair.style.display, 'none');
  hud.setCrosshairBlocked(false);
  assert.equal(hud.el.crosshair.style.display, 'block');
});

test('scope rendering skips repeated unchanged frames', () => {
  let scopeWrites = 0;
  const scopeStyle = {};
  Object.defineProperty(scopeStyle, 'display', {
    set(value) { scopeWrites++; this.value = value; },
    get() { return this.value; },
  });
  const hud = Object.create(HUD.prototype);
  hud.el = { crosshair: crosshairElement(), scope: { style: scopeStyle } };
  hud._crosshairVisible = true;
  hud._crosshairBlocked = false;
  hud._combatActive = true;
  hud._scopeVisible = false;
  hud._scopeRendered = null;

  hud.setScope(false);
  hud.setScope(false);
  hud.setScope(true);
  hud.setScope(true);
  assert.equal(scopeWrites, 2);
});

test('dynamic frame updates rewrite only gap variables and skip unchanged values', () => {
  const hud = Object.create(HUD.prototype);
  const element = crosshairElement();
  hud.el = { crosshair: element };
  hud._crosshairPreferences = readSettings({
    crosshairGap: 5,
    crosshairDynamic: true,
    crosshairDynamicAmount: 1.25,
  });
  hud._crosshairVisual = crosshairPresentation(hud._crosshairPreferences, 0);
  hud._crosshairRenderedGap = 5;

  hud.setCrosshairSpread(8);
  assert.equal(element.style.values.get('--crosshair-gap'), '15.00px');
  assert.equal(element.style.writes, 2);
  hud.setCrosshairSpread(8);
  assert.equal(element.style.writes, 2);
});

test('dot-only style pulses its diameter when dynamic feedback changes', () => {
  const hud = Object.create(HUD.prototype);
  const element = crosshairElement();
  hud.el = { crosshair: element };
  hud._crosshairPreferences = readSettings({
    crosshairStyle: 'dot', crosshairDotSize: 2,
    crosshairDynamic: true, crosshairDynamicAmount: 1,
  });
  hud._crosshairVisual = crosshairPresentation(hud._crosshairPreferences, 0);
  hud._crosshairRenderedGap = hud._crosshairVisual.gap;
  hud._crosshairRenderedDotSize = hud._crosshairVisual.dotSize;

  hud.setCrosshairSpread(10);
  assert.equal(element.style.values.get('--crosshair-dot-size'), '3.80px');
  assert.equal(element.style.values.get('--crosshair-half-dot'), '-1.90px');
  assert.equal(element.style.writes, 2);
  hud.setCrosshairSpread(10);
  assert.equal(element.style.writes, 2);
  hud.setCrosshairSpread(0);
  assert.equal(element.style.values.get('--crosshair-dot-size'), '2.00px');
  assert.equal(element.style.values.get('--crosshair-half-dot'), '-1.00px');
  assert.equal(element.style.writes, 4);
});

test('extreme dot settings retain live firing headroom in the HUD', () => {
  const hud = Object.create(HUD.prototype);
  const element = crosshairElement();
  hud.el = { crosshair: element };
  hud._crosshairPreferences = readSettings({
    crosshairStyle: 'dot', crosshairDotSize: 2, crosshairGap: 20,
    crosshairDynamic: true, crosshairDynamicAmount: 2,
  });
  hud._crosshairVisual = crosshairPresentation(hud._crosshairPreferences, 0);
  hud._crosshairRenderedGap = hud._crosshairVisual.gap;
  hud._crosshairRenderedDotSize = hud._crosshairVisual.dotSize;

  hud.setCrosshairSpread(20);
  const resting = Number.parseFloat(element.style.values.get('--crosshair-dot-size'));
  hud.setCrosshairSpread(32);
  const firing = Number.parseFloat(element.style.values.get('--crosshair-dot-size'));
  assert.ok(firing > resting);
  assert.equal(element.style.values.get('--crosshair-dot-size'), '13.52px');
});

test('weapon HUD identifies the persistent knife instead of showing stale firearm ammo', () => {
  const hud = Object.create(HUD.prototype);
  hud.el = { ammo: { textContent: '', innerHTML: '' }, weaponName: { textContent: '' } };

  hud.updateAmmo({
    knifeEquipped: true,
    ammo: { ammo: 12, reserve: 72 },
    def: { name: 'PISTOLA' },
  });
  assert.equal(hud.el.ammo.textContent, '∞');
  assert.equal(hud.el.weaponName.textContent, 'CUCHILLO');

  hud.updateAmmo({
    knifeEquipped: false,
    ammo: { ammo: 12, reserve: 72 },
    def: { name: 'PISTOLA' },
  });
  assert.match(hud.el.ammo.innerHTML, /^12 /);
  assert.equal(hud.el.weaponName.textContent, 'PISTOLA');
});

test('stable HUD values do not rewrite DOM state every simulation frame', () => {
  let healthWidthWrites = 0;
  let healthLabelWrites = 0;
  let scoreWrites = 0;
  const healthStyle = {};
  Object.defineProperty(healthStyle, 'width', { set() { healthWidthWrites++; } });
  const healthLabel = {};
  Object.defineProperty(healthLabel, 'textContent', { set() { healthLabelWrites++; } });
  const score = {};
  Object.defineProperty(score, 'innerHTML', { set() { scoreWrites++; } });
  const hud = Object.create(HUD.prototype);
  hud.el = {
    healthBar: { style: healthStyle, classList: { toggle() {} } },
    healthLabel,
    score,
  };
  hud._healthRendered = null;
  hud._scoreRendered = null;

  assert.equal(hud.updateHealth(100, 100), true);
  assert.equal(hud.updateHealth(100, 100), false);
  assert.equal(hud.updateScore(4, 2), true);
  assert.equal(hud.updateScore(4, 2), false);
  assert.equal(healthWidthWrites, 1);
  assert.equal(healthLabelWrites, 1);
  assert.equal(scoreWrites, 1);

  assert.equal(hud.updateHealth(75, 100), true);
  assert.equal(hud.updateScore(5, 2), true);
  assert.equal(healthWidthWrites, 2);
  assert.equal(scoreWrites, 2);
});

test('HUD clamps malformed health values before rendering', () => {
  const hud = Object.create(HUD.prototype);
  const widths = [];
  hud.el = {
    healthBar: { style: { set width(value) { widths.push(value); } }, classList: { toggle() {} } },
    healthLabel: { textContent: '' },
  };
  hud._healthRendered = null;
  hud.updateHealth(Infinity, 0);
  assert.equal(widths[0], '0%');
  assert.equal(hud.el.healthLabel.textContent, '0 PV');
});
