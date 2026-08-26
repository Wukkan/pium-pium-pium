import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['src', 'server', 'test', 'scripts'];
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) files.push(target);
  }
}

for (const target of TARGETS) {
  const directory = resolve(ROOT, target);
  if (statSync(directory).isDirectory()) collect(directory);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) continue;
  process.stderr.write(result.stderr || result.stdout || `Error de sintaxis: ${file}\n`);
  process.exit(result.status || 1);
}

console.log(`Sintaxis válida: ${files.length} módulos.`);
