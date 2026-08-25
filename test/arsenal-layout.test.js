import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function cssRule(selector, requiredText = '') {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...html.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))];
  assert.ok(matches.length, `missing CSS rule for ${selector}`);
  const match = requiredText
    ? matches.find((candidate) => candidate[1].includes(requiredText))
    : matches[0];
  assert.ok(match, `missing ${selector} rule containing ${requiredText}`);
  return match[1];
}

function hasDeclaration(rule, property, value) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
  assert.match(rule, new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*${escapedValue}`));
}

function functionSource(name, nextName) {
  const start = main.indexOf(`function ${name}(`);
  const end = main.indexOf(`\nfunction ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `unable to isolate ${name}`);
  return main.slice(start, end);
}

test('main arsenal uses a compact fixed catalog viewport', () => {
  const screen = cssRule('#menu-screen-arsenal');
  const grid = cssRule('.menu-arsenal-grid', 'height: 537px');
  const card = cssRule('.menu-weapon-card', 'height: 100%');

  hasDeclaration(screen, 'width', 'min(1040px, 100%)');
  hasDeclaration(grid, 'height', '537px');
  hasDeclaration(grid, 'grid-auto-rows', '252px');
  hasDeclaration(grid, 'overflow-y', 'auto');
  hasDeclaration(grid, 'scrollbar-gutter', 'stable');
  hasDeclaration(card, 'min-height', '0');
  hasDeclaration(card, 'height', '100%');
});

test('in-match buy window keeps one square-like shell for every category', () => {
  const windowRule = cssRule('.buy-window', 'width: min(1020px, 100%)');
  const header = cssRule('.buy-header', 'flex: 0 0 auto');
  const layout = cssRule('.buy-layout', 'flex: 1 1 auto');
  const content = cssRule('.buy-content', 'min-height: 0');
  const grid = cssRule('#buy-grid', 'grid-auto-rows: 186px');

  hasDeclaration(windowRule, 'width', 'min(1020px, 100%)');
  hasDeclaration(windowRule, 'height', 'min(846px, calc(100dvh - 48px))');
  hasDeclaration(windowRule, 'max-height', 'none');
  hasDeclaration(windowRule, 'overflow', 'hidden');
  hasDeclaration(header, 'flex', '0 0 auto');
  hasDeclaration(layout, 'min-height', '0');
  hasDeclaration(content, 'min-height', '0');
  hasDeclaration(grid, 'grid-auto-rows', '186px');
  hasDeclaration(grid, 'overflow-y', 'auto');
  hasDeclaration(grid, 'padding', '5px');
  hasDeclaration(grid, 'scrollbar-gutter', 'stable');
});

test('changing either arsenal filter returns its internal viewport to the first row', () => {
  const menuRenderer = functionSource('renderMenuArsenal', 'showMenuScreen');
  const buyRenderer = functionSource('renderBuyMenu', 'setBuyMenu');
  assert.equal((menuRenderer.match(/grid\.scrollTop\s*=\s*0;/g) || []).length, 1);
  assert.equal((buyRenderer.match(/grid\.scrollTop\s*=\s*0;/g) || []).length, 1);
});

test('responsive arsenal rules preserve fixed internal scrolling without horizontal overflow', () => {
  assert.match(html, /@media \(max-width: 900px\)[\s\S]{0,1800}?\.menu-arsenal-grid\s*\{[^}]*height:\s*min\(537px,\s*62dvh\)/);
  assert.match(html, /@media \(max-width: 520px\)[\s\S]{0,900}?\.menu-arsenal-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*320px\)[^}]*grid-auto-rows:\s*270px/);
  assert.match(html, /@media \(max-width: 680px\)[\s\S]{0,1800}?#buy-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(130px,\s*1fr\)\)/);
  assert.match(html, /@media \(max-width: 460px\)[\s\S]{0,500}?#buy-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*320px\)[^}]*grid-auto-rows:\s*250px/);
  assert.match(html, /@media \(max-height: 600px\)[\s\S]{0,300}?\.buy-subtitle,\s*\.buy-balance,\s*\.buy-footer\s*\{\s*display:\s*none/);
});
