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
  hud._combatActive = true;

  hud._syncCrosshairDisplay();
  assert.equal(hud.el.crosshair.style.display, 'block');
  hud.setScope(true);
  assert.equal(hud.el.crosshair.style.display, 'none');
  hud.showDeath(true, 'Bot');
  hud.setScope(false);
  assert.equal(hud.el.crosshair.style.display, 'none');
  hud.showDeath(false);
  assert.equal(hud.el.crosshair.style.display, 'block');
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
