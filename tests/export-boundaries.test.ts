import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const mainRoot = path.resolve(__dirname, '../../src/main');
const exportRoot = path.join(mainRoot, 'export');
const retropieRoot = path.join(exportRoot, 'retropie');

function inside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : entry.name.endsWith('.ts') ? [file] : [];
  });
}

function imports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return ts.preProcessFile(source, true, true).importedFiles.map(item => item.fileName);
}

test('export infrastructure does not depend on Electron, IPC or the RetroPie strategy', () => {
  const files = sourceFiles(exportRoot);
  assert.ok(files.includes(path.join(exportRoot, 'export-service.ts')));
  assert.ok(files.includes(path.join(retropieRoot, 'retropie-exporter.ts')));
  const violations = files.flatMap(file => imports(file).filter(reference => {
    if (/^electron(?:\/|$)/.test(reference)) return true;
    if (!reference.startsWith('.')) return false;
    const destination = path.resolve(path.dirname(file), reference);
    return inside(path.join(mainRoot, 'ipc'), destination) ||
      (!inside(retropieRoot, file) && inside(retropieRoot, destination));
  }).map(reference => `${path.relative(mainRoot, file)}: ${reference}`));
  assert.deepEqual(violations, []);
});

test('export IPC depends only on the public export entry point, not concrete strategies or internals', () => {
  const file = path.join(mainRoot, 'ipc', 'export-ipc.ts');
  const references = imports(file).filter(reference => reference.startsWith('.') &&
    inside(exportRoot, path.resolve(path.dirname(file), reference)));
  assert.deepEqual(references, ['../export']);
});
