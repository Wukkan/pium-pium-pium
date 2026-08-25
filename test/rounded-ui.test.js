import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('the interface exposes one proportional radius system', () => {
  for (const token of ['--radius-sm', '--radius-md', '--radius-lg', '--radius-pill']) {
    assert.match(html, new RegExp(`${token}:`));
  }
  assert.doesNotMatch(html, /\*\s*\{[^}]*border-radius/s);
});

test('all major UI surfaces participate in the rounded system', () => {
  for (const selector of [
    '#podium', '#team-picker', '#scores', '#chat-menu', '#custom-panel',
    '#menu-loadout', '.menu-hero-side', '.menu-weapon-card', '.buy-window',
    '.buy-card', '.bot-panel-window', '.bot-control-card', '.options-group',
    '.crosshair-preview-stage', '#play-btn', '#name-input', '#death::before',
  ]) {
    assert.ok(html.includes(selector), `missing rounded UI contract for ${selector}`);
  }
});

test('bars and sight elements use rounded caps while circular controls stay circular', () => {
  for (const selector of [
    '#reload-bar', '#health-bar', '#scope .cross-h', '#hitmarker .hm',
    '.crosshair-shape .line', '::-webkit-slider-thumb', '::-moz-range-thumb',
  ]) {
    assert.ok(html.includes(selector), `missing rounded detail for ${selector}`);
  }
  assert.match(html, /#bot-close,[\s\S]*?border-radius:\s*50%/);
});
