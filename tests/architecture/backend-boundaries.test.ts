import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const mainRoot = path.resolve(__dirname, '../../../src/main');
const contractsRoot = path.join(mainRoot, 'contracts');
const componentsRoot = path.join(mainRoot, 'components');
const ipcRoot = path.join(mainRoot, 'ipc');
const shared = path.resolve(mainRoot, '../shared');

function inside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

function imports(file: string): string[] {
  return ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles.map((item) => item.fileName);
}

function referenceName(file: string, reference: string): string {
  return `${path.relative(mainRoot, file)}: ${reference}`;
}

function resolvesTo(file: string, reference: string, directory: string): boolean {
  return reference.startsWith('.') && inside(directory, path.resolve(path.dirname(file), reference));
}

function forbiddenExternal(reference: string): boolean {
  return /^(?:electron|better-sqlite3|sqlite3|node:sqlite)(?:\/|$)/.test(reference);
}

test('persistence and identification contracts have no feature or runtime dependencies', () => {
  const files = sourceFiles(contractsRoot);
  assert.ok(files.includes(path.join(contractsRoot, 'identification.ts')));
  assert.ok(files.includes(path.join(contractsRoot, 'persistence.ts')));
  const violations: string[] = [];
  for (const file of files) {
    for (const reference of imports(file)) {
      const target = path.resolve(path.dirname(file), reference);
      if (
        !reference.startsWith('.') ||
        (!inside(contractsRoot, target) && !inside(componentsRoot, target) && target !== shared)
      ) {
        violations.push(referenceName(file, reference));
      }
    }
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
        violations.push(referenceName(file, statement.getText(source)));
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
        violations.push(referenceName(file, statement.getText(source)));
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('backend features and reusable components do not depend on desktop transport or database adapters', () => {
  const packages = [
    'components',
    'contracts',
    'export',
    'identification',
    'metadata',
    'rom',
    'scanner',
    'services'
  ];
  const files = [
    path.join(mainRoot, 'scanner.ts'),
    ...packages.flatMap((name) => sourceFiles(path.join(mainRoot, name)))
  ];
  const forbidden = ['app', 'desktop', 'ipc', 'database', 'main', 'settings/settings-ipc'].map((name) =>
    path.join(mainRoot, name)
  );
  const violations = files.flatMap((file) =>
    imports(file)
      .filter(
        (reference) =>
          forbiddenExternal(reference) ||
          forbidden.some((directory) => resolvesTo(file, reference, directory))
      )
      .map((reference) => referenceName(file, reference))
  );
  assert.deepEqual(violations, []);
});

test('IPC feature dependencies use public package entry points, not persistence or concrete implementations', () => {
  const publicPackages = ['export', 'identification', 'metadata', 'services/library'].map((name) =>
    path.join(mainRoot, name)
  );
  const database = path.join(mainRoot, 'database');
  const violations = sourceFiles(ipcRoot).flatMap((file) =>
    imports(file)
      .filter((reference) => {
        if (!reference.startsWith('.')) {
          return /^(?:better-sqlite3|sqlite3|node:sqlite)(?:\/|$)/.test(reference);
        }
        const target = path.resolve(path.dirname(file), reference);
        return (
          inside(database, target) ||
          inside(contractsRoot, target) ||
          publicPackages.some((directory) => inside(directory, target) && target !== directory)
        );
      })
      .map((reference) => referenceName(file, reference))
  );
  assert.deepEqual(violations, []);
});


test('archive consumers depend only on the public archive API', () => {
  const archivesRoot = path.join(componentsRoot, 'archives');
  const implementationNames = new Set([
    'ArchiveFormatReader',
    'CompositeArchiveReader',
    'ZipArchiveReader',
    'SevenZipArchiveReader',
    'SevenZipProcess',
    'resolveSevenZipExecutable',
    'RETROHANDLER_7ZIP'
  ]);
  const violations: string[] = [];
  const files = sourceFiles(path.dirname(mainRoot)).filter((file) => !inside(archivesRoot, file));
  for (const file of files) {
    for (const reference of imports(file)) {
      const target = path.resolve(path.dirname(file), reference);
      if (resolvesTo(file, reference, archivesRoot) && target !== archivesRoot) {
        violations.push(referenceName(file, reference));
      }
    }
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && implementationNames.has(node.text)) {
        violations.push(referenceName(file, node.text));
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(violations, []);
});
