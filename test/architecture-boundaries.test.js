import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootUrl = new URL('..', import.meta.url);
const root = fileURLToPath(rootUrl);

function jsFiles(relativeDirectory) {
  const directory = join(root, relativeDirectory);
  const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = join(path, entry.name);
    return entry.isDirectory() ? walk(target) : extname(entry.name) === '.js' ? [target] : [];
  });
  return walk(directory);
}

test('shared simulation contracts remain independent from browser globals', () => {
  for (const file of jsFiles('src/shared')) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\b(?:window|document|localStorage|sessionStorage)\b/, file);
    assert.doesNotMatch(source, /from\s+['"]\.\.\//, file);
  }
});

test('entrypoint growth stays behind explicit reviewable budgets', () => {
  const budgets = new Map([
    ['src/main.js', 3300],
    ['src/weapons.js', 2300],
    ['server/server.js', 1900],
  ]);
  for (const [relativePath, maximumLines] of budgets) {
    const lines = readFileSync(new URL(relativePath, rootUrl), 'utf8').split(/\r?\n/).length;
    assert.ok(lines <= maximumLines, `${relativePath}: ${lines} > ${maximumLines}; extraer un módulo antes de crecer`);
  }
});
